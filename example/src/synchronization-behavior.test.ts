import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import {
  createBroadcastChannelSyncSource,
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
  type NusmAdapter,
  type NusmSyncContext,
} from "nusm";

const validateExampleCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  context.source.length > 0 &&
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate) &&
  typeof (candidate as { value?: unknown }).value === "number";

const createExampleSyncSource = (key = 17) =>
  createBroadcastChannelSyncSource({
    key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + key)),
    namespace: "nusm-example-tests",
  });

const verifyAdapter = async (
  name: string,
  createAdapter?: () => NusmAdapter,
) => {
  const storeId = `example-${name}`;
  const firstSync = createExampleSyncSource();
  const secondSync = createExampleSyncSource();
  const first = createNusmStore(
    { value: 0 },
    {
      adapter: createAdapter?.(),
      storeId,
      sync: { source: firstSync, validator: validateExampleCandidate },
    },
  );
  const second = createNusmStore(
    { value: 0 },
    {
      adapter: createAdapter?.(),
      storeId,
      sync: { source: secondSync, validator: validateExampleCandidate },
    },
  );
  await Promise.all([first.ready, second.ready]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  first.setState((state) => ({ value: state.value + 1 }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(second.state).toEqual({ value: 1 });
  await Promise.all([first.dispose(), second.dispose()]);
};

describe("example authenticated synchronization", () => {
  test("synchronizes memory and every built-in browser adapter", async () => {
    localStorage.clear();
    sessionStorage.clear();
    await verifyAdapter("memory");
    await verifyAdapter("local", () => createLocalStorageAdapter());
    await verifyAdapter("session", () => createSessionStorageAdapter());
    await verifyAdapter("indexed", () =>
      createIndexDbAdapter({ dbName: "nusm-synchronization-example" }),
    );
  });

  test("rejects a peer provisioned with the wrong runtime key", async () => {
    const trusted = createExampleSyncSource(17);
    const outsider = createExampleSyncSource(99);
    const received: unknown[] = [];
    await trusted.start((event) => received.push(event.state), {
      storeId: "authenticated-proof",
    });
    await outsider.start(() => undefined, { storeId: "authenticated-proof" });
    await outsider.publish({
      eventId: "wrong-key",
      kind: "update",
      sourceId: "outsider",
      state: { value: 99 },
      storeId: "authenticated-proof",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(received).toHaveLength(0);
    await trusted.dispose?.({ storeId: "authenticated-proof" });
    await outsider.dispose?.({ storeId: "authenticated-proof" });
  });
});
