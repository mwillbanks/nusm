import { afterEach, describe, expect, test } from "bun:test";
import {
  configureNusm,
  createNusmStore,
  type NusmSyncEvent,
  type NusmSyncSource,
} from "../src/index.js";
import { createMemoryAdapter } from "./helpers/memory-adapter.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const createSource = () => {
  const listeners = new Set<(event: NusmSyncEvent) => void>();
  const published: NusmSyncEvent[] = [];
  const source: NusmSyncSource = {
    publish: (event) => published.push(event),
    start: (listener) => {
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
  };
};

afterEach(() => configureNusm({}));

describe("synchronization communication", () => {
  test("auto-enables global sources and supports an explicit opt-out", async () => {
    const global = createSource();
    configureNusm({ sync: { source: global.source } });
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
      createNusmStore({ value: 0 }, { sync: { source: source.source } }),
    ).toThrow("explicit storeId");
  });

  test("routes remote source events into memory and persistence once", async () => {
    const source = createSource();
    const memory = createMemoryAdapter({ pacer: false });
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: memory.adapter,
        persist: { strategy: "entire" },
        storeId: "remote",
        sync: { source: source.source },
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
    await settle();
    expect(store.state).toEqual({ value: 4 });
    expect(transitions).toBe(1);
    expect(memory.setItemCalls).toHaveLength(1);
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await store.dispose();
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
        sync: { source: source.source },
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
