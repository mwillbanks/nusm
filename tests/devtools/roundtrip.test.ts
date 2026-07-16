import { expect, test } from "bun:test";
import type { NusmDevtoolsSnapshot } from "../../src";
import { createLocalStorageAdapter, createNusmStore } from "../../src";

const relay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ type: string; payload: unknown }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("round-trips an entire persisted snapshot with a custom resolved key", async () => {
  const original = globalThis.__TANSTACK_EVENT_TARGET__;
  const target = relay();
  globalThis.__TANSTACK_EVENT_TARGET__ = target;
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  };
  const snapshots: NusmDevtoolsSnapshot[] = [];
  const results: Array<{ status: string }> = [];
  target.addEventListener("nusm:snapshot", (event) =>
    snapshots.push((event as CustomEvent).detail.payload),
  );
  target.addEventListener("nusm:commandResult", (event) =>
    results.push((event as CustomEvent).detail.payload),
  );
  const store = createNusmStore(
    { count: 1 },
    {
      adapter: createLocalStorageAdapter({
        pacer: false,
        prefix: "roundtrip",
        storage,
      }),
      devtools: true,
      persist: { strategy: "entire" },
      storeId: "counter",
    },
  );
  await store.ready;
  store.setState(() => ({ count: 4 }));
  await tick();
  target.dispatchEvent(
    new CustomEvent("nusm:command", {
      detail: {
        payload: {
          action: "replace_persisted",
          commandId: "entire",
          instanceId: store.devtoolsInstanceId,
          storeId: "counter",
          value: snapshots.at(-1)?.persisted,
        },
      },
    }),
  );
  await tick();
  expect(results.at(-1)?.status).toBe("success");
  expect(snapshots.at(-1)?.persisted).toEqual({ count: 4 });
  globalThis.__TANSTACK_EVENT_TARGET__ = original;
});

test("normalizes fractional, non-finite, zero, and extreme event caps", async () => {
  const original = globalThis.__TANSTACK_EVENT_TARGET__;
  const target = relay();
  globalThis.__TANSTACK_EVENT_TARGET__ = target;
  const snapshots: NusmDevtoolsSnapshot[] = [];
  target.addEventListener("nusm:snapshot", (event) =>
    snapshots.push((event as CustomEvent).detail.payload),
  );
  const stores = [2, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 999_999].map(
    (eventLogCap, index) =>
      createNusmStore({}, { devtools: { eventLogCap, name: `cap-${index}` } }),
  );
  await Promise.all(stores.map((store) => store.ready));
  await tick();
  expect(
    snapshots.map((snapshot) => snapshot.eventLogCap).sort((a, b) => a - b),
  ).toEqual([2, 100, 100, 100, 100, 10_000]);
  globalThis.__TANSTACK_EVENT_TARGET__ = original;
});
