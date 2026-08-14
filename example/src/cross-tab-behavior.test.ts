import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
  type NusmAdapter,
  type NusmSyncSource,
} from "nusm";

const createExampleSyncSource = (): NusmSyncSource => {
  const listeners = new Set<Parameters<NusmSyncSource["start"]>[0]>();
  return {
    publish: (event) => {
      const value = structuredClone(event);
      for (const listener of listeners) queueMicrotask(() => listener(value));
    },
    start: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const verifyAdapter = async (
  name: string,
  createAdapter?: () => NusmAdapter,
) => {
  const storeId = `example-${name}`;
  const sync = createExampleSyncSource();
  const first = createNusmStore(
    { value: 0 },
    { adapter: createAdapter?.(), storeId, sync: { source: sync } },
  );
  const second = createNusmStore(
    { value: 0 },
    { adapter: createAdapter?.(), storeId, sync: { source: sync } },
  );
  await Promise.all([first.ready, second.ready]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  first.setState((state) => ({ value: state.value + 1 }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(second.state).toEqual({ value: 1 });
  await Promise.all([first.dispose(), second.dispose()]);
};

describe("example cross-tab behavior", () => {
  test("synchronizes memory and every built-in browser adapter", async () => {
    localStorage.clear();
    sessionStorage.clear();
    await verifyAdapter("memory");
    await verifyAdapter("local", () => createLocalStorageAdapter());
    await verifyAdapter("session", () => createSessionStorageAdapter());
    await verifyAdapter("indexed", () =>
      createIndexDbAdapter({ dbName: "nusm-cross-tab-example" }),
    );
  });
});
