import type { NusmAdapter, NusmPacerConfig } from "../../src";

type MemoryAdapterOptions = {
  delayGetMs?: number;
  errorKeys?: string[];
  pacer?: NusmPacerConfig;
  setItemErrorKeys?: string[];
  withGetAllKeys?: boolean;
  withResolveKey?: boolean;
};

const resolveMemoryKey = (params: {
  kind: "entire" | "slice";
  sliceKey?: string;
  storeId: string;
}) =>
  params.kind === "entire"
    ? `nusm:${params.storeId}:entire`
    : `nusm:${params.storeId}:slice:${params.sliceKey}`;

const waitForRead = async (delayGetMs?: number) => {
  if (delayGetMs)
    await new Promise((resolve) => setTimeout(resolve, delayGetMs));
};

const readMemoryValue = async (
  key: string,
  values: Map<string, unknown>,
  errorKeys: ReadonlySet<string>,
  delayGetMs?: number,
) => {
  await waitForRead(delayGetMs);
  if (errorKeys.has(key)) throw new Error("getItem failed");
  return values.get(key) ?? null;
};

const writeMemoryValue = (
  key: string,
  value: unknown,
  values: Map<string, unknown>,
  errors: ReadonlySet<string>,
  calls: Array<{ key: string; value: unknown }>,
) => {
  if (errors.has(key)) throw new Error("setItem failed");
  values.set(key, value);
  calls.push({ key, value });
};

export const createMemoryAdapter = (options?: MemoryAdapterOptions) => {
  const store = new Map<string, unknown>();
  const listeners = new Set<
    (event: { key?: string; type: "set" | "remove" | "clear" }) => void
  >();
  const setItemCalls: Array<{ key: string; value: unknown }> = [];
  const errorKeys = new Set(options?.errorKeys ?? []);
  const setItemErrorKeys = new Set(options?.setItemErrorKeys ?? []);

  const adapter: NusmAdapter = {
    getAllKeys:
      options?.withGetAllKeys === false
        ? undefined
        : async () => Array.from(store.keys()),
    getItem: (key) =>
      readMemoryValue(key, store, errorKeys, options?.delayGetMs),
    name: "memory",
    pacer: options?.pacer,
    removeItem: (key) => {
      store.delete(key);
    },
    resolveKey:
      options?.withResolveKey === false ? undefined : resolveMemoryKey,
    setItem: (key, value) =>
      writeMemoryValue(key, value, store, setItemErrorKeys, setItemCalls),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    adapter,
    emit: (event: { key?: string; type: "set" | "remove" | "clear" }) => {
      for (const listener of listeners) listener(event);
    },
    setItemCalls,
    store,
  };
};
