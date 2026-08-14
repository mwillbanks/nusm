import { afterEach, describe, expect, test } from "bun:test";
import {
  configureNusm,
  createNusmStore,
  type NusmSyncContext,
  type NusmSyncEvent,
  type NusmSyncSource,
} from "../src/index.js";
import { createMemoryAdapter } from "./helpers/memory-adapter.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const validateSyncCandidate = (candidate: unknown, context: NusmSyncContext) =>
  context.source.length > 0 &&
  typeof candidate === "object" &&
  candidate !== null;

const createSource = () => {
  const listeners = new Set<(event: NusmSyncEvent) => void>();
  const published: NusmSyncEvent[] = [];
  let starts = 0;
  const source: NusmSyncSource = {
    publish: (event) => published.push(event),
    start: (listener) => {
      starts += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    emit: (event: NusmSyncEvent) => {
      for (const listener of listeners) listener(event);
    },
    published,
    source,
    get starts() {
      return starts;
    },
  };
};

afterEach(() => configureNusm({}));

describe("synchronization communication", () => {
  test("treats an explicitly empty source list as disabled", async () => {
    const store = createNusmStore({ value: 0 }, { sync: { sources: [] } });

    await store.ready;

    expect(store.isReady).toBe(true);
    expect(store.state).toEqual({ value: 0 });
    await store.dispose();
  });

  test("applies a validated update received during hydration", async () => {
    const source = createSource();
    let resolveHydration!: (value: unknown) => void;
    let markHydrationStarted!: () => void;
    let resolveCallbackPublish!: () => void;
    let markCallbackPublishStarted!: () => void;
    const callbackPublishStarted = new Promise<void>((resolve) => {
      markCallbackPublishStarted = resolve;
    });
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve;
    });
    source.source.publish = (event) => {
      source.published.push(event);
      if (
        event.kind === "update" &&
        (event.state as { value?: number }).value === 45
      ) {
        markCallbackPublishStarted();
        return new Promise<void>((resolve) => {
          resolveCallbackPublish = resolve;
        });
      }
    };
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: {
          getItem: () =>
            new Promise<unknown>((resolve) => {
              resolveHydration = resolve;
              markHydrationStarted();
            }),
          name: "delayed-hydration",
          pacer: false,
          removeItem: () => undefined,
          setItem: () => undefined,
        },
        persist: { strategy: "entire" },
        storeId: "deferred-update",
        sync: { source: source.source, validator: validateSyncCandidate },
      },
    );
    const transitions: number[] = [];
    const unsubscribe = store.subscribe(() => {
      transitions.push(store.state.value);
      if (store.state.value === 42)
        source.emit({
          eventId: "during-replay-newer",
          kind: "update",
          sourceId: "peer",
          state: { value: 43 },
          storeId: "deferred-update",
        });
      if (store.state.value === 43)
        source.emit({
          eventId: "during-replay-newest",
          kind: "update",
          sourceId: "peer",
          state: { value: 44 },
          storeId: "deferred-update",
        });
      if (store.state.value === 44)
        queueMicrotask(() => store.setState(() => ({ value: 45 })));
    });
    await hydrationStarted;
    source.emit({
      eventId: "during-hydration",
      kind: "update",
      sourceId: "peer",
      state: { value: 42 },
      storeId: "deferred-update",
    });
    await Promise.resolve();

    resolveHydration(null);
    let readyResolved = false;
    const ready = store.ready.then(() => {
      readyResolved = true;
    });
    await callbackPublishStarted;
    expect(readyResolved).toBe(false);
    resolveCallbackPublish();
    await ready;

    expect(transitions.slice(-4)).toEqual([42, 43, 44, 45]);
    expect(store.state).toEqual({ value: 45 });
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await store.dispose();
  });

  test("requires validation for every effective remote input", () => {
    const { adapter } = createMemoryAdapter({ withSubscribe: true });
    expect(() =>
      createNusmStore(
        { value: 0 },
        { adapter, persist: { strategy: "entire" }, storeId: "adapter-guard" },
      ),
    ).toThrow("validator");
  });

  test("merges global validators with store-specific sources", async () => {
    const global = createSource();
    const contexts: string[] = [];
    const validator = (_candidate: unknown, context: NusmSyncContext) => {
      contexts.push(context.source);
      return true;
    };
    configureNusm({ sync: { source: global.source, validator } });
    const storeSource = createSource();
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "store-source",
        sync: { source: storeSource.source },
      },
    );
    await store.ready;
    storeSource.emit({
      eventId: "store-source-update",
      kind: "update",
      sourceId: "peer",
      state: { value: 1 },
      storeId: "store-source",
    });
    await settle();
    expect(store.state).toEqual({ value: 1 });
    expect(contexts).toContain("peer");
    await store.dispose();
  });

  test("allows a store validator to override a global source", async () => {
    const global = createSource();
    configureNusm({ sync: { source: global.source, validator: () => false } });
    const contexts: string[] = [];
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "store-validator",
        sync: {
          validator: (_candidate, context) => {
            contexts.push(context.source);
            return true;
          },
        },
      },
    );
    await store.ready;
    global.emit({
      eventId: "global-update",
      kind: "update",
      sourceId: "peer",
      state: { value: 3 },
      storeId: "store-validator",
    });
    await settle();
    expect(store.state).toEqual({ value: 3 });
    expect(contexts).toContain("peer");
    await store.dispose();
  });

  test("auto-enables global sources and supports an explicit opt-out", async () => {
    const global = createSource();
    configureNusm({
      sync: { source: global.source, validator: validateSyncCandidate },
    });
    const enabled = createNusmStore({ value: 0 }, { storeId: "enabled" });
    const disabled = createNusmStore(
      { value: 0 },
      { storeId: "disabled", sync: false },
    );
    await Promise.all([enabled.ready, disabled.ready]);
    enabled.setState({ value: 1 });
    await settle();
    expect(global.published.at(-1)?.state).toEqual({ value: 1 });
    await enabled.dispose();
    await disabled.dispose();
  });

  test("retains the global validator for opted-out adapter events", async () => {
    const memory = createMemoryAdapter({ withSubscribe: true });
    const global = createSource();
    const contexts: NusmSyncContext[] = [];
    const validator = (candidate: unknown, context: NusmSyncContext) => {
      contexts.push(context);
      return (
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { value?: unknown }).value === 1
      );
    };
    configureNusm({ sync: { source: global.source, validator } });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "opted-out-adapter",
        sync: false,
      },
    );
    await store.ready;
    expect(global.starts).toBe(0);
    const key = "nusm:opted-out-adapter:entire";
    memory.store.set(key, { value: 2 });
    memory.emit({ key, type: "set" });
    await settle();
    expect(store.state).toEqual({ value: 0 });
    memory.store.set(key, { value: 1 });
    memory.emit({ key, type: "set" });
    await settle();
    expect(store.state).toEqual({ value: 1 });
    expect(contexts.some((context) => context.kind === "adapter")).toBe(true);
    await store.dispose();
  });

  test("reports adapter validator failures without mutating state", async () => {
    const memory = createMemoryAdapter({ withSubscribe: true });
    const errors: unknown[] = [];
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        onError: (error) => errors.push(error),
        persist: { strategy: "entire" },
        storeId: "adapter-validator-error",
        sync: {
          validator: () => {
            throw new Error("adapter validator failed");
          },
        },
      },
    );
    await store.ready;
    const key = "nusm:adapter-validator-error:entire";
    memory.store.set(key, { value: 1 });
    memory.emit({ key, type: "set" });
    await settle();
    expect(store.state).toEqual({ value: 0 });
    expect(errors).toContainEqual(new Error("adapter validator failed"));
    await store.dispose();
  });

  test("emits an unavailable status when a synchronization source cannot start", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = new EventTarget();
    target.addEventListener("tanstack-connect", () =>
      target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
    );
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail;
      target.dispatchEvent(new CustomEvent(detail.type, { detail }));
    });
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const events: Array<{ type: string }> = [];
    target.addEventListener("nusm:event", (event) => {
      const payload = (event as CustomEvent).detail.payload;
      if (payload?.type) events.push(payload);
    });
    const store = createNusmStore(
      { value: 0 },
      {
        devtools: true,
        storeId: "unavailable-source",
        sync: {
          source: {
            publish: () => undefined,
            start: () => {
              throw new Error("source unavailable");
            },
          },
          validator: () => true,
        },
      },
    );
    await store.ready;
    expect(
      events.some(({ type }) => type === "synchronization_unavailable"),
    ).toBe(true);
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("requires an explicit storeId for persistence and synchronization", () => {
    const { adapter } = createMemoryAdapter();
    const source = createSource();
    expect(() =>
      createNusmStore(
        { value: 0 },
        { adapter, persist: { strategy: "entire" } },
      ),
    ).toThrow("explicit storeId");
    expect(() =>
      createNusmStore(
        { value: 0 },
        {
          sync: { source: source.source, validator: validateSyncCandidate },
        },
      ),
    ).toThrow("explicit storeId");
  });

  test("routes remote source events into memory and persistence once", async () => {
    const source = createSource();
    const memory = createMemoryAdapter({ pacer: false, withSubscribe: true });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "remote",
        sync: { source: source.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    memory.setItemCalls.length = 0;
    let transitions = 0;
    const unsubscribe = store.subscribe(() => {
      transitions += 1;
    });
    const event: NusmSyncEvent = {
      eventId: "remote-1",
      kind: "update",
      sourceId: "peer",
      state: { value: 4 },
      storeId: "remote",
    };
    source.emit(event);
    source.emit({ ...event });
    memory.store.set("nusm:remote:entire", { value: 4 });
    memory.emit({ key: "nusm:remote:entire", type: "set" });
    await settle();
    expect(store.state).toEqual({ value: 4 });
    expect(transitions).toBe(1);
    expect(memory.setItemCalls).toHaveLength(1);
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await store.dispose();
  });

  test("rejects remote candidates before mutation and supports transforms", async () => {
    const source = createSource();
    const seen: Array<{ source: string; kind: string }> = [];
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "validated-remote",
        sync: {
          source: source.source,
          validator: (candidate, context) => {
            seen.push({ kind: context.kind, source: context.source });
            if ((candidate as { value: number }).value < 0) return false;
            return { ok: true, value: { value: 2 } };
          },
        },
      },
    );
    await store.ready;
    source.emit({
      eventId: "reject",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: -1 },
      storeId: "validated-remote",
    });
    await settle();
    expect(store.state).toEqual({ value: 0 });
    expect(source.published.some((event) => event.eventId === "reject")).toBe(
      false,
    );
    source.emit({
      eventId: "transform",
      kind: "update",
      revision: { counter: 2, senderId: "peer" },
      sourceId: "peer",
      state: { value: 1 },
      storeId: "validated-remote",
    });
    await settle();
    expect(store.state).toEqual({ value: 2 });
    expect(seen).toContainEqual({ kind: "update", source: "peer" });
    await store.dispose();
  });

  test("rejects invalid source state without memory or persistence mutation", async () => {
    const source = createSource();
    const memory = createMemoryAdapter({ pacer: false });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "invalid-source",
        sync: {
          source: source.source,
          validator: (candidate) => (candidate as { value: number }).value >= 0,
        },
      },
    );
    await store.ready;
    memory.setItemCalls.length = 0;
    source.emit({
      eventId: "invalid-source-update",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: -1 },
      storeId: "invalid-source",
    });
    await settle();
    expect(store.state).toEqual({ value: 0 });
    expect(memory.setItemCalls).toHaveLength(0);
    await store.dispose();
  });

  test("throws once, emits bounded rejection metadata, then accepts a valid event", async () => {
    const target = new EventTarget();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    target.addEventListener("tanstack-connect", () =>
      target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
    );
    const source = createSource();
    const errors: unknown[] = [];
    const events: Array<Record<string, unknown>> = [];
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail as {
        type: string;
        payload?: { type?: string; detail?: Record<string, unknown> };
      };
      if (
        detail.type === "nusm:event" &&
        detail.payload?.type === "synchronization_rejected"
      )
        events.push(detail.payload.detail ?? {});
    });
    let attempts = 0;
    const store = createNusmStore(
      { value: 0 },
      {
        devtools: true,
        onError: (error) => errors.push(error),
        storeId: "throwing-validator",
        sync: {
          source: source.source,
          validator: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("validator exploded");
            return true;
          },
        },
      },
    );
    await store.ready;
    source.emit({
      eventId: "throwing-update",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: 1 },
      storeId: "throwing-validator",
    });
    await settle();
    expect(store.state).toEqual({ value: 0 });
    source.emit({
      eventId: "valid-update",
      kind: "update",
      revision: { counter: 2, senderId: "peer" },
      sourceId: "peer",
      state: { value: 2 },
      storeId: "throwing-validator",
    });
    await settle();
    expect(store.state).toEqual({ value: 2 });
    expect(errors).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("state");
    expect(events[0].error).toBe("validator exploded");
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("persists transformed remote state", async () => {
    const source = createSource();
    const memory = createMemoryAdapter({ pacer: false });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "transformed-persist",
        sync: {
          source: source.source,
          validator: (candidate) => ({
            ok: true,
            value: { value: (candidate as { value: number }).value + 10 },
          }),
        },
      },
    );
    await store.ready;
    memory.setItemCalls.length = 0;
    source.emit({
      eventId: "transformed-persist-update",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: 2 },
      storeId: "transformed-persist",
    });
    await settle();
    expect(store.state).toEqual({ value: 12 });
    expect(memory.setItemCalls.at(-1)?.value).toEqual({ value: 12 });
    await store.dispose();
  });

  test("recovers revision progression after an accepted and rejected update", async () => {
    const source = createSource();
    let reject = false;
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "revision-recovery",
        sync: {
          source: source.source,
          validator: (candidate) =>
            !reject && (candidate as { value: number }).value !== 2,
        },
      },
    );
    await store.ready;
    source.emit({
      eventId: "accepted",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: 1 },
      storeId: "revision-recovery",
    });
    await settle();
    reject = true;
    source.emit({
      eventId: "rejected",
      kind: "update",
      revision: { counter: 2, senderId: "peer" },
      sourceId: "peer",
      state: { value: 2 },
      storeId: "revision-recovery",
    });
    await settle();
    reject = false;
    source.emit({
      eventId: "recovered",
      kind: "update",
      revision: { counter: 3, senderId: "peer" },
      sourceId: "peer",
      state: { value: 3 },
      storeId: "revision-recovery",
    });
    await settle();
    expect(store.state).toEqual({ value: 3 });
    await store.dispose();
  });

  test("persists only semantically changed object and array slices", async () => {
    const source = createSource();
    const memory = createMemoryAdapter({ pacer: false });
    const store = createNusmStore(
      { items: [{ id: 1 }], object: { enabled: false } },
      {
        adapter: memory.adapter,
        persist: {
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                object: value as { enabled: boolean },
              }),
              key: "object",
              select: (state) => state.object,
            },
            {
              apply: (state, value) => ({
                ...state,
                items: value as Array<{ id: number }>,
              }),
              key: "items",
              select: (state) => state.items,
            },
          ],
          strategy: "slices",
        },
        storeId: "semantic-slices",
        sync: { source: source.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    memory.setItemCalls.length = 0;
    source.emit({
      changedKeys: ["nusm:semantic-slices:slice:object"],
      eventId: "semantic-slices-update",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { items: [{ id: 1 }], object: { enabled: true } },
      storeId: "semantic-slices",
    });
    await settle();
    expect(store.state).toEqual({
      items: [{ id: 1 }],
      object: { enabled: true },
    });
    expect(memory.setItemCalls.map(({ key }) => key)).toEqual([
      "nusm:semantic-slices:slice:object",
    ]);
    await store.dispose();
  });

  test("snapshot application compares every configured slice before persistence", async () => {
    const listeners = new Set<(event: NusmSyncEvent) => void>();
    const source: NusmSyncSource = {
      publish: (event) => {
        for (const listener of listeners) queueMicrotask(() => listener(event));
      },
      sourceId: "snapshot-source",
      start: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const makeAdapter = (storeId: string, object: unknown, items: unknown) => {
      const values = new Map([
        [`nusm:${storeId}:slice:object`, object],
        [`nusm:${storeId}:slice:items`, items],
      ]);
      const calls: string[] = [];
      return {
        adapter: {
          getItem: (key: string) => values.get(key) ?? null,
          name: `snapshot-${storeId}`,
          removeItem: (key: string) => values.delete(key),
          setItem: (key: string, value: unknown) => {
            values.set(key, value);
            calls.push(key);
          },
        },
        calls,
      };
    };
    const leaderAdapter = makeAdapter("snapshot-slices", { enabled: true }, [
      { id: 1 },
    ]);
    const followerAdapter = makeAdapter("snapshot-slices", { enabled: false }, [
      { id: 1 },
    ]);
    const slices = [
      {
        apply: (
          state: { object: unknown; items: unknown[] },
          value: unknown,
        ) => ({
          ...state,
          object: value,
        }),
        key: "object",
        select: (state: { object: unknown }) => state.object,
      },
      {
        apply: (
          state: { object: unknown; items: unknown[] },
          value: unknown,
        ) => ({
          ...state,
          items: value as unknown[],
        }),
        key: "items",
        select: (state: { items: unknown[] }) => state.items,
      },
    ];
    const leader = createNusmStore(
      { items: [{ id: 1 }], object: { enabled: false } },
      {
        adapter: leaderAdapter.adapter,
        persist: { slices, strategy: "slices" },
        storeId: "snapshot-slices",
        sync: { source, validator: validateSyncCandidate },
      },
    );
    await leader.ready;
    const follower = createNusmStore(
      { items: [{ id: 1 }], object: { enabled: false } },
      {
        adapter: followerAdapter.adapter,
        persist: { slices, strategy: "slices" },
        storeId: "snapshot-slices",
        sync: { source, validator: validateSyncCandidate },
      },
    );
    await follower.ready;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(follower.state.object).toEqual({ enabled: true });
    expect(follower.state.items).toEqual([{ id: 1 }]);
    expect(followerAdapter.calls).toEqual([
      "nusm:snapshot-slices:slice:object",
    ]);
    await follower.dispose();
    await leader.dispose();
  });

  test("publishes resolved persistence keys on local events", async () => {
    const source = createSource();
    const { adapter } = createMemoryAdapter({ pacer: false });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "local-keys",
        sync: { source: source.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    source.published.length = 0;
    store.setState({ value: 3 });
    await settle();
    expect(source.published.at(-1)?.changedKeys).toEqual([
      "nusm:local-keys:entire",
    ]);
    await store.dispose();
  });
});
