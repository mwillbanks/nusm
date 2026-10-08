import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configureNusm,
  createBroadcastChannelSyncSource,
  createNusmStore,
  type NusmSyncEvent,
} from "../../src/index.js";
import { createHmacKey, signEnvelope } from "../../src/sync/protocol.js";
import { FakeBroadcastChannel as TestBroadcastChannel } from "../helpers/fake-broadcast-channel.js";
import { createMemoryAdapter } from "../helpers/memory-adapter.js";

const key = () =>
  new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
const disposeSource = async (
  source: { dispose?: (context?: { storeId: string }) => Promise<void> },
  storeId: string,
) => source.dispose?.({ storeId });
const latestMessage = () => {
  const latest = TestBroadcastChannel.messages.at(-1);
  if (!latest) throw new Error("Expected a broadcast message.");
  return latest;
};

beforeEach(() => {
  (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
    TestBroadcastChannel;
  TestBroadcastChannel.reset();
});

afterEach(() => configureNusm({}));

describe.serial("authenticated BroadcastChannel synchronization", () => {
  test("applies one BroadcastChannel update and matching adapter observation once", async () => {
    const storeId = "broadcast-adapter-once";
    const sharedKey = key();
    const source = createBroadcastChannelSyncSource({
      key: sharedKey,
      namespace: storeId,
    });
    const peer = createBroadcastChannelSyncSource({
      key: sharedKey,
      namespace: storeId,
    });
    const memory = createMemoryAdapter({ pacer: false, withSubscribe: true });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          source,
          validator: (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            typeof (candidate as { value?: unknown }).value === "number",
        },
      },
    );
    await store.ready;
    await peer.start(() => undefined, { storeId });
    memory.setItemCalls.length = 0;
    let transitions = 0;
    const unsubscribe = store.subscribe(() => {
      transitions += 1;
    });
    const keyName = `nusm:${storeId}:entire`;
    await peer.publish({
      eventId: "broadcast-adapter-once",
      kind: "update",
      revision: { counter: 1, senderId: "broadcast-peer" },
      sourceId: "broadcast-peer",
      state: { value: 4 },
      storeId,
    });
    await wait();
    memory.store.set(keyName, { value: 4 });
    memory.emit({ key: keyName, type: "set" });
    await wait();
    expect(store.state).toEqual({ value: 4 });
    expect(transitions).toBe(1);
    expect(memory.setItemCalls).toHaveLength(1);
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await store.dispose();
    await peer.dispose?.({ storeId });
  });

  test("single-flights concurrent starts for one store", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "single-flight",
    });
    const first: unknown[] = [];
    const second: unknown[] = [];
    await Promise.all([
      source.start((event) => first.push(event.state), {
        storeId: "single-flight",
      }),
      source.start((event) => second.push(event.state), {
        storeId: "single-flight",
      }),
    ]);
    expect(
      [...TestBroadcastChannel.channels.values()].filter(
        (channels) => channels.size > 0,
      ),
    ).toHaveLength(1);
    const peer = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "single-flight",
    });
    await peer.start(() => undefined, { storeId: "single-flight" });
    await peer.publish({
      eventId: "peer",
      kind: "update",
      sourceId: "peer",
      state: { value: 1 },
      storeId: "single-flight",
    });
    await wait();
    expect(first).toEqual([{ value: 1 }]);
    expect(second).toEqual([{ value: 1 }]);
    await source.dispose?.({ storeId: "single-flight" });
    await peer.dispose?.({ storeId: "single-flight" });
  });

  test("contextual disposal cannot cancel another pending listener", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "pending-dispose",
    });
    const first: unknown[] = [];
    const second: unknown[] = [];
    const starts = Promise.all([
      source.start((event) => first.push(event.state), {
        instanceId: "first",
        storeId: "pending-dispose",
      }),
      source.start((event) => second.push(event.state), {
        instanceId: "second",
        storeId: "pending-dispose",
      }),
    ]);
    await source.dispose?.({
      instanceId: "first",
      storeId: "pending-dispose",
    });
    await starts;
    const peer = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "pending-dispose",
    });
    await peer.start(() => undefined, { storeId: "pending-dispose" });
    await peer.publish({
      eventId: "pending",
      kind: "update",
      sourceId: "peer",
      state: { value: 2 },
      storeId: "pending-dispose",
    });
    await wait();
    expect(first).toHaveLength(0);
    expect(second).toEqual([{ value: 2 }]);
    await source.dispose?.({ storeId: "pending-dispose" });
    await peer.dispose?.({ storeId: "pending-dispose" });
  });

  test("disposes a channel created concurrently with its first listener", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "creation-dispose-race",
    });
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    let releaseImport: (() => void) | undefined;
    Object.defineProperty(crypto.subtle, "importKey", {
      configurable: true,
      value: (...args: Parameters<SubtleCrypto["importKey"]>) =>
        new Promise<CryptoKey>((resolve, reject) => {
          releaseImport = () => {
            originalImport(...args).then(resolve, reject);
          };
        }),
    });
    try {
      const started = source.start(() => undefined, {
        storeId: "creation-dispose-race",
      });
      await Promise.resolve();
      const disposed = source.dispose?.();
      releaseImport?.();
      await expect(started).rejects.toThrow("disposed");
      await disposed;
    } finally {
      Object.defineProperty(crypto.subtle, "importKey", {
        configurable: true,
        value: originalImport,
      });
    }
  });

  test("delivers authenticated arrivals in broadcast order", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "ordered-arrivals",
    });
    const sender = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "ordered-arrivals",
    });
    const received: number[] = [];
    await source.start(
      (event) => received.push((event.state as { value: number }).value),
      { storeId: "ordered-arrivals" },
    );
    await sender.start(() => undefined, { storeId: "ordered-arrivals" });
    const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    let delayed = true;
    crypto.subtle.verify = async (...args) => {
      if (delayed) {
        delayed = false;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return originalVerify(...args);
    };
    try {
      await sender.publish({
        eventId: "first",
        kind: "update",
        sourceId: "sender",
        state: { value: 1 },
        storeId: "ordered-arrivals",
      });
      await sender.publish({
        eventId: "second",
        kind: "update",
        sourceId: "sender",
        state: { value: 2 },
        storeId: "ordered-arrivals",
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    } finally {
      crypto.subtle.verify = originalVerify;
    }
    expect(received).toEqual([1, 2]);
    await source.dispose?.({ storeId: "ordered-arrivals" });
    await sender.dispose?.({ storeId: "ordered-arrivals" });
  });

  test("isolates a rejected signature verification and recovers on later messages", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "verify-recovery",
    });
    const sender = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "verify-recovery",
    });
    const received: number[] = [];
    await source.start(
      (event) => received.push((event.state as { value: number }).value),
      { storeId: "verify-recovery" },
    );
    await sender.start(() => undefined, { storeId: "verify-recovery" });
    const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    let verifyCalls = 0;
    crypto.subtle.verify = async (...args) => {
      if (verifyCalls++ === 0) throw new Error("verification unavailable");
      return originalVerify(...args);
    };
    try {
      await sender.publish({
        eventId: "rejected",
        kind: "update",
        sourceId: "sender",
        state: { value: 1 },
        storeId: "verify-recovery",
      });
      await sender.publish({
        eventId: "recovered",
        kind: "update",
        sourceId: "sender",
        state: { value: 2 },
        storeId: "verify-recovery",
      });
      await wait();
    } finally {
      crypto.subtle.verify = originalVerify;
    }
    expect(received).toEqual([2]);
    await source.dispose?.({ storeId: "verify-recovery" });
    await sender.dispose?.({ storeId: "verify-recovery" });
  });

  test("contextual disposal settles a rejected pending channel creation", async () => {
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    Object.defineProperty(crypto.subtle, "importKey", {
      configurable: true,
      value: (..._args: Parameters<SubtleCrypto["importKey"]>) =>
        Promise.reject(new Error("key import denied")),
    });
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "pending-rejection",
    });
    try {
      const started = source.start(() => undefined, {
        storeId: "pending-rejection",
      });
      await Promise.resolve();
      await source.dispose?.({ storeId: "pending-rejection" });
      await expect(started).rejects.toThrow("key import denied");
    } finally {
      Object.defineProperty(crypto.subtle, "importKey", {
        configurable: true,
        value: originalImport,
      });
    }
  });

  test("shares authenticated SuperJSON values between identified stores", async () => {
    const left = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tests",
    });
    const right = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tests",
    });
    const received: unknown[] = [];
    await left.start(() => undefined, {
      instanceId: "left",
      storeId: "round-trip",
    });
    await right.start((event) => received.push(event.state), {
      instanceId: "right",
      storeId: "round-trip",
    });

    await left.publish({
      eventId: "local",
      kind: "update",
      sourceId: "local",
      state: {
        array: [1, 2],
        bigint: 42n,
        date: new Date("2026-08-14T00:00:00.000Z"),
        map: new Map([["key", "value"]]),
        object: { nested: true },
        set: new Set(["value"]),
      },
      storeId: "round-trip",
    });
    await wait();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      array: [1, 2],
      bigint: 42n,
      date: new Date("2026-08-14T00:00:00.000Z"),
      map: new Map([["key", "value"]]),
      object: { nested: true },
      set: new Set(["value"]),
    });
    await left.dispose?.({ storeId: "round-trip" });
    await right.dispose?.({ storeId: "round-trip" });
  });

  test("rejects short keys and non-HMAC or extractable keys", async () => {
    expect(() =>
      createBroadcastChannelSyncSource({
        key: new Uint8Array(31),
        namespace: "tests",
      }),
    ).toThrow("at least 32");
    const extractable = await crypto.subtle.generateKey(
      { hash: "SHA-256", name: "HMAC" },
      true,
      ["sign", "verify"],
    );
    expect(() =>
      createBroadcastChannelSyncSource({
        key: extractable as CryptoKey,
        namespace: "tests",
      }),
    ).toThrow("non-extractable");
    const aes = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    expect(() =>
      createBroadcastChannelSyncSource({
        key: aes as CryptoKey,
        namespace: "tests",
      }),
    ).toThrow("HMAC-SHA-256");
    const signOnly = await crypto.subtle.importKey(
      "raw",
      key(),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    expect(() =>
      createBroadcastChannelSyncSource({
        key: signOnly,
        namespace: "tests",
      }),
    ).toThrow("signing key");
    const imported = await crypto.subtle.importKey(
      "raw",
      key(),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"],
    );
    const source = createBroadcastChannelSyncSource({
      key: imported,
      namespace: "tests",
    });
    await source.start(() => undefined, { storeId: "crypto-key" });
    await source.dispose?.({ storeId: "crypto-key" });
  });

  test("uses Web Crypto random bytes when randomUUID is unavailable", async () => {
    const randomUuid = crypto.randomUUID;
    const randomValues = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: <T extends ArrayBufferView | null>(array: T) => {
        if (array instanceof Uint8Array) array.fill(7);
        return array;
      },
    });
    try {
      const source = createBroadcastChannelSyncSource({
        key: key(),
        namespace: "random-bytes",
      });
      await source.start(() => undefined, { storeId: "random-bytes" });
      expect(source.sourceId).toBe("07070707070707070707070707070707");
      await source.dispose?.({ storeId: "random-bytes" });
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: randomUuid,
      });
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: randomValues,
      });
    }
  });

  test("rejects synchronization when Web Crypto identity generation is unavailable", async () => {
    const randomUuid = crypto.randomUUID;
    const randomValues = crypto.getRandomValues;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: undefined,
    });
    try {
      const source = createBroadcastChannelSyncSource({
        key: key(),
        namespace: "no-identity",
      });
      await expect(
        source.start(() => undefined, { storeId: "no-identity" }),
      ).rejects.toThrow("Web Crypto is required");
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: randomUuid,
      });
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: randomValues,
      });
    }
  });

  test("rejects tampered payloads and preserves valid updates", async () => {
    const reported: Error[] = [];
    const left = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tamper",
    });
    const right = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tamper",
    });
    const received: NusmSyncEvent[] = [];
    await left.start(() => undefined, {
      instanceId: "left",
      storeId: "tamper",
    });
    await right.start((event) => received.push(event), {
      instanceId: "right",
      onError: (error) => reported.push(error as Error),
      storeId: "tamper",
    });
    await left.publish({
      eventId: "first",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "tamper",
    });
    await wait();
    const raw = latestMessage();
    expect(raw).toBeDefined();
    const tampered = {
      ...(raw?.message as Record<string, unknown>),
      payload: "{value:2}",
    };
    const malformedSignature = {
      ...(raw?.message as Record<string, unknown>),
      signature: "!",
    };
    TestBroadcastChannel.postRaw(raw.name, tampered);
    TestBroadcastChannel.postRaw(raw.name, malformedSignature);
    TestBroadcastChannel.postRaw(raw.name, raw.message);
    await wait();
    expect(received).toHaveLength(1);
    expect(reported.length).toBeGreaterThan(0);
    await disposeSource(left, "tamper");
    await disposeSource(right, "tamper");
  });

  test("rejects tampered signed headers", async () => {
    const reported: Error[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tamper-header",
    });
    await source.start(() => undefined, { storeId: "tamper-header" });
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "tamper-header",
    });
    await receiver.start(() => undefined, {
      onError: (error) => reported.push(error as Error),
      storeId: "tamper-header",
    });
    await source.publish({
      eventId: "header",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "tamper-header",
    });
    await wait();
    const raw = latestMessage();
    const tamperedHeader = {
      ...(raw?.message as Record<string, unknown>),
      kind: "ready",
    };
    TestBroadcastChannel.postRaw(raw.name, tamperedHeader);
    await wait();
    expect(reported.length).toBeGreaterThan(0);
    await disposeSource(source, "tamper-header");
    await disposeSource(receiver, "tamper-header");
  });

  test("isolates hostile envelope access and recovers the inbound queue", async () => {
    const reported: Error[] = [];
    const sender = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "hostile-envelope",
    });
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "hostile-envelope",
    });
    const received: number[] = [];
    await sender.start(() => undefined, { storeId: "hostile-envelope" });
    await receiver.start(
      (event) => received.push((event.state as { value: number }).value),
      {
        onError: (error) => reported.push(error as Error),
        storeId: "hostile-envelope",
      },
    );
    await sender.publish({
      eventId: "hostile-seed",
      kind: "update",
      sourceId: "sender",
      state: { value: 1 },
      storeId: "hostile-envelope",
    });
    await wait();
    const raw = latestMessage();
    const hostile = { ...(raw.message as Record<string, unknown>) };
    let versionReads = 0;
    Object.defineProperty(hostile, "version", {
      configurable: true,
      enumerable: true,
      get: () => {
        if (versionReads++ === 0) return 1;
        throw new Error("hostile version access");
      },
    });
    TestBroadcastChannel.postRaw(raw.name, hostile);
    await sender.publish({
      eventId: "hostile-recovery",
      kind: "update",
      sourceId: "sender",
      state: { value: 2 },
      storeId: "hostile-envelope",
    });
    await wait();
    expect(received).toEqual([1, 2]);
    expect(reported.length).toBeGreaterThan(0);
    await disposeSource(sender, "hostile-envelope");
    await disposeSource(receiver, "hostile-envelope");
  });

  test("rejects an authenticated envelope with an invalid payload", async () => {
    const reported: Error[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "invalid-payload",
    });
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "invalid-payload",
    });
    await source.start(() => undefined, { storeId: "invalid-payload" });
    await receiver.start(() => undefined, {
      onError: (error) => reported.push(error as Error),
      storeId: "invalid-payload",
    });
    await source.publish({
      eventId: "invalid",
      kind: "update",
      sourceId: "source",
      state: { valid: true },
      storeId: "invalid-payload",
    });
    await wait();
    const raw = latestMessage();
    const original = raw.message as Record<string, unknown>;
    const { signature: _signature, ...unsigned } = original;
    const signed = await signEnvelope(await createHmacKey(key()), {
      ...unsigned,
      messageId: "source:2",
      payload: "not-superjson",
    } as never);
    TestBroadcastChannel.postRaw(raw.name, signed);
    await wait();
    expect(reported.length).toBeGreaterThan(0);
    await disposeSource(source, "invalid-payload");
    await disposeSource(receiver, "invalid-payload");
  });

  test("reports cyclic and non-serializable state without sending it", async () => {
    const reported: Error[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "serialization",
    });
    await source.start(() => undefined, {
      onError: (error) => reported.push(error as Error),
      storeId: "serialization",
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await source.publish({
      eventId: "cyclic",
      kind: "update",
      sourceId: "local",
      state: cyclic,
      storeId: "serialization",
    });
    await source.publish({
      eventId: "function",
      kind: "update",
      sourceId: "local",
      state: { callback: () => undefined },
      storeId: "serialization",
    });
    const hidden = {} as Record<string | symbol, unknown>;
    Object.defineProperty(hidden, "callback", {
      configurable: true,
      enumerable: false,
      value: () => undefined,
    });
    const symbolState = {} as Record<string | symbol, unknown>;
    Object.defineProperty(symbolState, Symbol("callback"), {
      configurable: true,
      enumerable: true,
      value: 1,
    });
    const accessorState = {} as Record<string | symbol, unknown>;
    Object.defineProperty(accessorState, "lazy", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("accessor invoked");
      },
    });
    await source.publish({
      eventId: "hidden",
      kind: "update",
      sourceId: "local",
      state: hidden,
      storeId: "serialization",
    });
    await source.publish({
      eventId: "symbol",
      kind: "update",
      sourceId: "local",
      state: symbolState,
      storeId: "serialization",
    });
    await source.publish({
      eventId: "accessor",
      kind: "update",
      sourceId: "local",
      state: accessorState,
      storeId: "serialization",
    });
    expect(reported).toHaveLength(5);
    expect(TestBroadcastChannel.messages).toHaveLength(0);
    await source.dispose?.({ storeId: "serialization" });
  });
});

describe.serial("authenticated BroadcastChannel limits", () => {
  test("validates positive limit overrides", () => {
    expect(() =>
      createBroadcastChannelSyncSource({
        key: key(),
        limits: { maxPeers: 0 },
        namespace: "limits",
      }),
    ).toThrow("positive integer");
    expect(() =>
      createBroadcastChannelSyncSource({
        key: key(),
        limits: { maxPeers: Number.POSITIVE_INFINITY },
        namespace: "limits",
      }),
    ).toThrow("positive integer");
    expect(() =>
      createBroadcastChannelSyncSource({
        key: key(),
        limits: { maxPeers: 1_000 },
        namespace: "limits",
      }),
    ).not.toThrow();
    expect(() =>
      createBroadcastChannelSyncSource({ key: key(), namespace: "" }),
    ).toThrow("non-empty");
  });

  test("closes each store on unsubscribe and the whole source on disposal", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "cleanup",
    });
    const unsubscribe = await source.start(() => undefined, {
      storeId: "cleanup-a",
    });
    await source.start(() => undefined, { storeId: "cleanup-b" });
    unsubscribe?.();
    await source.dispose?.();
    expect(
      [...TestBroadcastChannel.channels.values()].every(
        (channels) => channels.size === 0,
      ),
    ).toBe(true);
  });

  test("keeps wrong-key sources on separate opaque channels", async () => {
    const trusted = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "keys",
    });
    const wrong = createBroadcastChannelSyncSource({
      key: new Uint8Array(32).fill(99),
      namespace: "keys",
    });
    const received: unknown[] = [];
    await trusted.start((event) => received.push(event), {
      storeId: "isolated",
    });
    await wrong.start(() => undefined, { storeId: "isolated" });
    await wrong.publish({
      eventId: "wrong",
      kind: "update",
      sourceId: "wrong",
      state: { value: 9 },
      storeId: "isolated",
    });
    await trusted.publish({
      eventId: "trusted",
      kind: "update",
      sourceId: "trusted",
      state: { value: 1 },
      storeId: "isolated",
    });
    await wait();
    expect(received).toHaveLength(0);
    expect(
      new Set(TestBroadcastChannel.messages.map(({ name }) => name)).size,
    ).toBe(2);
    await trusted.dispose?.({ storeId: "isolated" });
    await wrong.dispose?.({ storeId: "isolated" });
  });

  test("bounds protocol reports, quarantines invalid floods, then recovers", async () => {
    const reported: Error[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      limits: { quarantineAfter: 2, quarantineMs: 10 },
      namespace: "limits",
    });
    const received: unknown[] = [];
    await source.start((event) => received.push(event), {
      onError: (error) => reported.push(error as Error),
      storeId: "bounded",
    });
    const channelName = Array.from(TestBroadcastChannel.channels.keys())[0];
    for (let index = 0; index < 10; index++)
      TestBroadcastChannel.postRaw(channelName, { bad: index });
    await wait();
    expect(reported.length).toBeLessThanOrEqual(5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const peer = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "limits",
    });
    await peer.start(() => undefined, { storeId: "bounded" });
    await peer.publish({
      eventId: "valid",
      kind: "update",
      sourceId: "peer",
      state: { ok: true },
      storeId: "bounded",
    });
    await wait();
    expect(received).toHaveLength(1);
    await source.dispose?.({ storeId: "bounded" });
    await peer.dispose?.({ storeId: "bounded" });
  });

  test("rejects payloads when an envelope has no state", async () => {
    const reported: Error[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "empty-state",
    });
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "empty-state",
    });
    await source.start(() => undefined, { storeId: "empty-state" });
    await receiver.start(() => undefined, {
      onError: (error) => reported.push(error as Error),
      storeId: "empty-state",
    });
    await source.publish({
      eventId: "ack",
      kind: "ack",
      sourceId: "source",
      storeId: "empty-state",
    });
    await wait();
    const raw = TestBroadcastChannel.messages.at(-1);
    TestBroadcastChannel.postRaw(raw?.name ?? "", {
      ...(raw?.message as Record<string, unknown>),
      payload: "unexpected",
    });
    await wait();
    expect(reported.length).toBeGreaterThan(0);
    await source.dispose?.({ storeId: "empty-state" });
    await receiver.dispose?.({ storeId: "empty-state" });
  });

  test("rejects oversized state, identifiers, changed keys, and raw envelopes", async () => {
    const reported: Error[] = [];
    const received: unknown[] = [];
    const source = createBroadcastChannelSyncSource({
      key: key(),
      limits: { maxStateBytes: 32 },
      namespace: "bounds",
    });
    await source.start((event) => received.push(event.state), {
      onError: (error) => reported.push(error as Error),
      storeId: "bounds",
    });
    const invalidStart = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "bounds",
    });
    await expect(
      invalidStart.start(() => undefined, { storeId: "x".repeat(129) }),
    ).rejects.toThrow("storeId exceeds");
    expect(
      [...TestBroadcastChannel.channels.values()].filter(
        (channels) => channels.size > 0,
      ),
    ).toHaveLength(1);
    await source.publish({
      eventId: "large-state",
      kind: "update",
      sourceId: "local",
      state: { value: "x".repeat(100) },
      storeId: "bounds",
    });
    await source.publish({
      eventId: "large-id",
      kind: "update",
      sourceId: "local",
      state: { ok: true },
      storeId: "x".repeat(129),
    });
    await source.publish({
      changedKeys: ["k".repeat(129)],
      eventId: "large-key",
      kind: "update",
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
    });
    await source.publish({
      eventId: "large-target",
      kind: "update",
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
      targetId: "t".repeat(129),
    });
    await source.publish({
      eventId: "large-key-field",
      key: "k".repeat(129),
      kind: "update",
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
    });
    await source.publish({
      eventId: "large-revision-sender",
      kind: "update",
      revision: { counter: 1, senderId: "r".repeat(129) },
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
    });
    await source.publish({
      causalRevision: { counter: 1, senderId: "c".repeat(129) },
      eventId: "large-causal-sender",
      kind: "update",
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
    });
    await source.publish({
      eventId: "adapter-kind",
      kind: "adapter" as NusmSyncEvent["kind"],
      sourceId: "local",
      state: { ok: true },
      storeId: "bounds",
    });
    const channelName = Array.from(TestBroadcastChannel.channels.keys()).find(
      (name) => TestBroadcastChannel.channels.get(name)?.size,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    TestBroadcastChannel.postRaw(channelName ?? "", {
      payload: "x".repeat(600_000),
    });
    TestBroadcastChannel.postRaw(channelName ?? "", cyclic);
    await wait();
    expect(reported.length).toBeGreaterThanOrEqual(1);
    expect(reported.length).toBeLessThanOrEqual(5);
    expect(TestBroadcastChannel.messages).toHaveLength(0);
    const peer = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "bounds",
    });
    await peer.start(() => undefined, { storeId: "bounds" });
    await peer.publish({
      eventId: "recovered",
      kind: "update",
      sourceId: "peer",
      state: { recovered: true },
      storeId: "bounds",
    });
    await wait();
    expect(received).toEqual([{ recovered: true }]);
    await source.dispose?.({ storeId: "bounds" });
    await peer.dispose?.({ storeId: "bounds" });
  });

  test("rejects malformed changed keys and mismatched store identity", async () => {
    const reported: Error[] = [];
    const sender = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "schema",
    });
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "schema",
    });
    await sender.start(() => undefined, { storeId: "schema" });
    await receiver.start(() => undefined, {
      onError: (error) => reported.push(error as Error),
      storeId: "schema",
    });
    await sender.publish({
      eventId: "schema",
      kind: "update",
      sourceId: "sender",
      state: { ok: true },
      storeId: "schema",
    });
    await wait();
    const raw = TestBroadcastChannel.messages.at(-1);
    TestBroadcastChannel.postRaw(raw?.name ?? "", {
      ...(raw?.message as Record<string, unknown>),
      changedKeys: [123],
    });
    TestBroadcastChannel.postRaw(raw?.name ?? "", {
      ...(raw?.message as Record<string, unknown>),
      storeId: "other",
    });
    await wait();
    expect(reported.length).toBeGreaterThanOrEqual(2);
    await sender.dispose?.({ storeId: "schema" });
    await receiver.dispose?.({ storeId: "schema" });
  });

  test("isolates throwing reporters and distinguishes same message IDs by sender", async () => {
    const source = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "reporters",
    });
    const peerA = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "reporters",
    });
    const peerB = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "reporters",
    });
    const received: unknown[] = [];
    await source.start((event) => received.push(event), {
      onError: () => {
        throw new Error("reporter failed");
      },
      storeId: "reporters",
    });
    await peerA.start(() => undefined, { storeId: "reporters" });
    await peerB.start(() => undefined, { storeId: "reporters" });
    await peerA.publish({
      eventId: "same",
      kind: "update",
      sourceId: "a",
      state: { a: 1 },
      storeId: "reporters",
    });
    await peerB.publish({
      eventId: "same",
      kind: "update",
      sourceId: "b",
      state: { b: 1 },
      storeId: "reporters",
    });
    TestBroadcastChannel.postRaw(
      Array.from(TestBroadcastChannel.channels.keys()).find(
        (name) => TestBroadcastChannel.channels.get(name)?.size,
      ) ?? "",
      { bad: true },
    );
    await wait();
    expect(received).toHaveLength(2);
    await source.dispose?.({ storeId: "reporters" });
    await peerA.dispose?.({ storeId: "reporters" });
    await peerB.dispose?.({ storeId: "reporters" });
  });
});

describe.serial("authenticated BroadcastChannel lifecycle", () => {
  test("bounds peers and identities and disposes one shared store independently", async () => {
    const receiver = createBroadcastChannelSyncSource({
      key: key(),
      limits: { maxIdentitiesPerPeer: 1, maxPeers: 1 },
      namespace: "caps",
    });
    const peerA = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "caps",
    });
    const peerB = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "caps",
    });
    const received: unknown[] = [];
    await receiver.start((event) => received.push(event), {
      storeId: "caps",
    });
    await peerA.start(() => undefined, { storeId: "caps" });
    await peerB.start(() => undefined, { storeId: "caps" });
    await peerA.publish({
      eventId: "one",
      kind: "update",
      sourceId: "a",
      state: { one: true },
      storeId: "caps",
    });
    await peerA.publish({
      eventId: "two",
      kind: "update",
      sourceId: "a",
      state: { two: true },
      storeId: "caps",
    });
    await peerB.publish({
      eventId: "three",
      kind: "update",
      sourceId: "b",
      state: { three: true },
      storeId: "caps",
    });
    await wait();
    expect(received).toHaveLength(2);
    await receiver.dispose?.({ storeId: "caps" });
    await peerA.dispose?.({ storeId: "caps" });
    await peerB.dispose?.({ storeId: "caps" });

    const shared = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "shared",
    });
    const sharedEvents: unknown[] = [];
    await shared.start(() => undefined, { storeId: "store-a" });
    await shared.start((event) => sharedEvents.push(event), {
      storeId: "store-b",
    });
    await shared.dispose?.({ storeId: "store-a" });
    const peer = createBroadcastChannelSyncSource({
      key: key(),
      namespace: "shared",
    });
    await peer.start(() => undefined, { storeId: "store-b" });
    await peer.publish({
      eventId: "still-open",
      kind: "update",
      sourceId: "peer",
      state: { alive: true },
      storeId: "store-b",
    });
    await wait();
    expect(sharedEvents).toHaveLength(1);
    await shared.dispose?.({ storeId: "store-b" });
    await peer.dispose?.({ storeId: "store-b" });
  });

  test("does not activate transport for a synthetic SSR window", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          createElement: () => ({}),
          defaultView: globalThis,
          nodeType: 8,
        },
      });
      const source = createBroadcastChannelSyncSource({
        key: key(),
        namespace: "ssr",
      });
      await expect(
        source.start(() => undefined, { storeId: "ssr" }),
      ).rejects.toThrow("browser Web Crypto");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
