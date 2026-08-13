import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configureNusm,
  createNusmStore,
  type NusmDevtoolsSnapshot,
  type NusmEvent,
} from "../src";
import {
  FakeBroadcastChannel,
  installFakeBroadcastChannel,
} from "./helpers/fake-broadcast-channel";
import { createMemoryAdapter } from "./helpers/memory-adapter";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const createDevtoolsRelay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ payload: unknown; type: string }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};

describe("cross-tab communication", () => {
  let restoreBroadcastChannel: () => void;

  beforeEach(() => {
    configureNusm({ crossTab: false });
    restoreBroadcastChannel = installFakeBroadcastChannel();
  });

  afterEach(() => {
    configureNusm({ crossTab: false });
    restoreBroadcastChannel();
  });

  test("defaults BroadcastChannel off while preserving adapter events", async () => {
    const memory = createMemoryAdapter();
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "default-off",
      },
    );
    await store.ready;

    expect(FakeBroadcastChannel.channels.size).toBe(0);
    expect(memory.listenerCount).toBe(1);
  });

  test("uses a creation-time global default with store overrides", async () => {
    configureNusm({ crossTab: true });
    const enabled = createNusmStore({ value: 0 }, { storeId: "enabled" });
    const disabled = createNusmStore(
      { value: 0 },
      { crossTab: false, storeId: "disabled" },
    );
    configureNusm({ crossTab: false });
    const stillEnabled = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "explicit-enabled" },
    );
    const laterDisabled = createNusmStore(
      { value: 0 },
      { storeId: "later-disabled" },
    );
    await Promise.all([
      enabled.ready,
      disabled.ready,
      stillEnabled.ready,
      laterDisabled.ready,
    ]);

    expect(Array.from(FakeBroadcastChannel.channels.keys()).sort()).toEqual([
      "nusm:cross-tab:v1:enabled",
      "nusm:cross-tab:v1:explicit-enabled",
    ]);
  });

  test("skips globally enabled unnamed stores and rejects explicit opt-in", async () => {
    configureNusm({ crossTab: true });
    const unnamed = createNusmStore({ value: 0 });
    await unnamed.ready;
    expect(FakeBroadcastChannel.channels.size).toBe(0);
    expect(() => createNusmStore({ value: 0 }, { crossTab: true })).toThrow(
      "stable storeId or Devtools name",
    );
  });

  test("handshakes and synchronizes in-memory stores", async () => {
    const first = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "handshake" },
    );
    await first.ready;
    first.setState(() => ({ value: 3 }));

    const second = createNusmStore(
      { value: -1 },
      { crossTab: true, storeId: "handshake" },
    );
    await second.ready;
    await settle();
    expect(second.state).toEqual({ value: 3 });

    second.setState(() => ({ value: 4 }));
    await settle();
    expect(first.state).toEqual({ value: 4 });
  });

  test("converges deterministic concurrent updates", async () => {
    const first = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "concurrent" },
    );
    const second = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "concurrent" },
    );
    await Promise.all([first.ready, second.ready]);
    await settle();

    first.setState(() => ({ value: 1 }));
    second.setState(() => ({ value: 2 }));
    await settle();
    expect(first.state).toEqual(second.state);
  });

  test("does not let a late handshake overwrite an immediate local update", async () => {
    const first = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "handshake-race" },
    );
    const second = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "handshake-race" },
    );
    await Promise.all([first.ready, second.ready]);
    first.setState(() => ({ value: 1 }));
    await settle();
    expect(first.state).toEqual({ value: 1 });
    expect(second.state).toEqual({ value: 1 });
  });

  test("hydrates before joining and requests the newest snapshot", async () => {
    const first = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "hydrate-before-handshake" },
    );
    await first.ready;
    first.setState(() => ({ value: 9 }));

    let finishHydration: ((value: unknown) => void) | undefined;
    const persisted = new Promise<unknown>((resolve) => {
      finishHydration = resolve;
    });
    const second = createNusmStore(
      { value: 0 },
      {
        adapter: {
          getItem: () => persisted,
          name: "delayed",
          removeItem: () => {},
          setItem: () => {},
        },
        crossTab: true,
        persist: { strategy: "entire" },
        storeId: "hydrate-before-handshake",
      },
    );
    expect(
      FakeBroadcastChannel.channels.get(
        "nusm:cross-tab:v1:hydrate-before-handshake",
      )?.size,
    ).toBe(1);
    finishHydration?.({ value: 1 });
    await second.ready;
    await settle();
    expect(second.state).toEqual({ value: 9 });
  });

  test("rejects self, duplicate, stale, and wrong-store messages", async () => {
    const errors: unknown[] = [];
    const store = createNusmStore(
      { value: 0 },
      {
        crossTab: true,
        onError: (error) => errors.push(error),
        storeId: "message-validation",
      },
    );
    await store.ready;
    await settle();
    const channelName = "nusm:cross-tab:v1:message-validation";
    const request = FakeBroadcastChannel.messages.find(
      (entry) => entry.name === channelName,
    )?.message as { senderId?: string } | undefined;
    expect(typeof request?.senderId).toBe("string");
    const envelope = (
      messageId: string,
      counter: number,
      value: number,
      senderId = "peer",
      storeId = "message-validation",
    ) => ({
      kind: "update",
      messageId,
      revision: { counter, senderId },
      senderId,
      state: { value },
      storeId,
      version: 1,
    });

    FakeBroadcastChannel.postRaw(
      channelName,
      envelope("self", 99, 99, request?.senderId),
    );
    FakeBroadcastChannel.postRaw(channelName, envelope("newest", 2, 2));
    FakeBroadcastChannel.postRaw(channelName, envelope("newest", 3, 3));
    FakeBroadcastChannel.postRaw(channelName, envelope("stale", 1, 1));
    FakeBroadcastChannel.postRaw(
      channelName,
      envelope("wrong-store", 4, 4, "peer", "another-store"),
    );
    await settle();
    expect(store.state).toEqual({ value: 2 });
    expect(errors).toHaveLength(1);
  });

  test("persists remote entire-store updates without echo loops", async () => {
    const firstAdapter = createMemoryAdapter({ pacer: false });
    const secondAdapter = createMemoryAdapter({ pacer: false });
    const first = createNusmStore(
      { value: 0 },
      {
        adapter: firstAdapter.adapter,
        crossTab: true,
        persist: { strategy: "entire" },
        storeId: "persist-entire",
      },
    );
    const second = createNusmStore(
      { value: 0 },
      {
        adapter: secondAdapter.adapter,
        crossTab: true,
        persist: { strategy: "entire" },
        storeId: "persist-entire",
      },
    );
    await Promise.all([first.ready, second.ready]);
    await settle();
    firstAdapter.setItemCalls.length = 0;
    secondAdapter.setItemCalls.length = 0;

    first.setState(() => ({ value: 7 }));
    await settle();
    expect(second.state).toEqual({ value: 7 });
    expect(secondAdapter.setItemCalls.at(-1)?.value).toEqual({ value: 7 });
    expect(firstAdapter.setItemCalls).toHaveLength(1);
  });

  test("persists only changed slices after a remote update", async () => {
    type State = { local: string; one: number; two: number };
    const makeOptions = (
      adapter: ReturnType<typeof createMemoryAdapter>["adapter"],
    ) => ({
      adapter,
      crossTab: true,
      persist: {
        slices: [
          {
            apply: (state: State, value: unknown) => ({
              ...state,
              one: value as number,
            }),
            key: "one",
            select: (state: State) => state.one,
          },
          {
            apply: (state: State, value: unknown) => ({
              ...state,
              two: value as number,
            }),
            key: "two",
            select: (state: State) => state.two,
          },
        ],
        strategy: "slices" as const,
      },
      storeId: "persist-slices",
    });
    const firstAdapter = createMemoryAdapter({ pacer: false });
    const secondAdapter = createMemoryAdapter({ pacer: false });
    const first = createNusmStore<State>(
      { local: "first", one: 0, two: 0 },
      makeOptions(firstAdapter.adapter),
    );
    const second = createNusmStore<State>(
      { local: "second", one: 0, two: 0 },
      makeOptions(secondAdapter.adapter),
    );
    await Promise.all([first.ready, second.ready]);
    await settle();
    secondAdapter.setItemCalls.length = 0;

    first.setState((state) => ({ ...state, local: "remote", one: 1 }));
    await settle();
    expect(second.state).toEqual({ local: "remote", one: 1, two: 0 });
    expect(secondAdapter.setItemCalls.map((call) => call.key)).toEqual([
      "nusm:persist-slices:slice:one",
    ]);
  });

  test("reports unavailable and malformed transports through Devtools", async () => {
    restoreBroadcastChannel();
    const browserTarget = window as unknown as { BroadcastChannel?: unknown };
    const originalBroadcastChannel = browserTarget.BroadcastChannel;
    delete browserTarget.BroadcastChannel;
    restoreBroadcastChannel = () => {
      browserTarget.BroadcastChannel = originalBroadcastChannel;
    };
    const snapshots: NusmDevtoolsSnapshot[] = [];
    const events: NusmEvent[] = [];
    const target = createDevtoolsRelay();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    target.addEventListener("nusm:event", (event) =>
      events.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(
      { value: 0 },
      { crossTab: true, devtools: true, storeId: "unavailable" },
    );
    await store.ready;
    await settle();
    expect(snapshots.at(-1)?.crossTab).toBe("unavailable");
    expect(events.some((event) => event.type === "cross_tab_unavailable")).toBe(
      true,
    );
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("reports protocol and structured-clone failures without stopping local state", async () => {
    const errors: unknown[] = [];
    const store = createNusmStore(
      { value: 0 as unknown },
      {
        crossTab: true,
        onError: (error) => errors.push(error),
        storeId: "failures",
      },
    );
    await store.ready;
    FakeBroadcastChannel.postRaw("nusm:cross-tab:v1:failures", {
      invalid: true,
    });
    store.setState(() => ({ value: () => "not cloneable" }));
    await settle();
    expect(errors).toHaveLength(2);
    expect(typeof store.state.value).toBe("function");
  });

  test("dispose flushes persistence and stops communication", async () => {
    const firstAdapter = createMemoryAdapter({ pacer: { wait: 100 } });
    const first = createNusmStore(
      { value: 0 },
      {
        adapter: firstAdapter.adapter,
        crossTab: true,
        persist: { strategy: "entire" },
        storeId: "dispose",
      },
    );
    const second = createNusmStore(
      { value: 0 },
      { crossTab: true, storeId: "dispose" },
    );
    await Promise.all([first.ready, second.ready]);
    await settle();
    firstAdapter.setItemCalls.length = 0;
    first.setState(() => ({ value: 1 }));
    const firstDisposal = first.dispose();
    expect(first.dispose()).toBe(firstDisposal);
    await firstDisposal;
    expect(firstAdapter.setItemCalls.at(-1)?.value).toEqual({ value: 1 });

    second.setState(() => ({ value: 2 }));
    await settle();
    expect(first.state).toEqual({ value: 1 });
  });
});
