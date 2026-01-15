import superjson from "superjson";
import type {
  AdapterEvent,
  NusmAdapter,
  StorageAdapterOptions,
  StorageLike,
} from "../types";

export const createStorageAdapter = (
  name: string,
  defaultStorage: StorageLike | undefined,
  options?: StorageAdapterOptions,
): NusmAdapter => {
  const storage = options?.storage ?? defaultStorage;
  if (!storage) {
    throw new Error(`${name} adapter requires a storage implementation.`);
  }

  const prefix = options?.prefix ?? "nusm";
  const serialize =
    options?.serialize ?? ((value) => superjson.stringify(value));
  const deserialize = options?.deserialize ?? ((raw) => superjson.parse(raw));

  const resolveKey = (params: {
    storeId: string;
    sliceKey?: string;
    kind: "entire" | "slice";
  }): string => {
    if (params.kind === "entire") {
      return `${prefix}:${params.storeId}:entire`;
    }
    return `${prefix}:${params.storeId}:slice:${params.sliceKey}`;
  };

  const getAllKeys = () => {
    if (typeof storage.length !== "number" || !storage.key) return [];
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  };

  const subscribe = (listener: (event: AdapterEvent) => void) => {
    if (typeof window === "undefined" || !("addEventListener" in window)) {
      return () => undefined;
    }

    const handler = (event: StorageEvent) => {
      if (!event.key) return;
      if (!event.key.startsWith(prefix)) return;
      if (event.newValue === null) {
        listener({ key: event.key, type: "remove" });
        return;
      }
      listener({ key: event.key, type: "set" });
    };

    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  };

  return {
    clear: storage.clear ? () => storage.clear?.() : undefined,
    getAllKeys,
    getItem: (key) => {
      const raw = storage.getItem(key);
      return raw == null ? null : deserialize(raw);
    },
    name,
    pacer: options?.pacer,
    removeItem: (key) => storage.removeItem(key),
    resolveKey,
    setItem: (key, value) => {
      storage.setItem(key, serialize(value));
    },
    subscribe,
  };
};
