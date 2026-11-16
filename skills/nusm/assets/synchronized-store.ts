import {
  createBroadcastChannelSyncSource,
  type BroadcastChannelSyncSourceOptions,
  createNusmStore,
  type NusmStore,
} from "nusm";

type Counter = { count: number };

export function createSharedCounter(
  namespace: string,
  key: BroadcastChannelSyncSourceOptions["key"],
): NusmStore<Counter> {
  return createNusmStore<Counter>(
    { count: 0 },
    {
      storeId: "shared-counter",
      sync: {
        source: createBroadcastChannelSyncSource({ namespace, key }),
        validator: (candidate) =>
          candidate !== null &&
          typeof candidate === "object" &&
          "count" in candidate &&
          typeof candidate.count === "number" &&
          Number.isSafeInteger(candidate.count),
      },
    },
  );
}
