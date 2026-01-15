import superjson from "superjson";
import type { IndexDbAdapterOptions, NusmAdapter } from "../types";

const openIndexDb = (
  dbName: string,
  storeName: string,
  version: number,
): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const withStore = async <T>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openIndexDb(dbName, storeName, 1);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
};

const defaultResolveKey = (params: {
  storeId: string;
  sliceKey?: string;
  kind: "entire" | "slice";
}): string => {
  if (params.kind === "entire") {
    return `nusm:${params.storeId}:entire`;
  }
  return `nusm:${params.storeId}:slice:${params.sliceKey}`;
};

export const createIndexDbAdapter = (
  options?: IndexDbAdapterOptions,
): NusmAdapter => {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexDB adapter requires a browser environment.");
  }

  const dbName = options?.dbName ?? "nusm";
  const storeName = options?.storeName ?? "nusm";
  const serialize =
    options?.serialize ?? ((value) => superjson.stringify(value));
  const deserialize = options?.deserialize ?? ((raw) => superjson.parse(raw));

  return {
    clear: () =>
      withStore(dbName, storeName, "readwrite", (store) => store.clear()).then(
        () => undefined,
      ),
    getAllKeys: async () => {
      const keys = await withStore(dbName, storeName, "readonly", (store) =>
        store.getAllKeys(),
      );
      return keys.map((key) => String(key));
    },
    getItem: (key) =>
      withStore(dbName, storeName, "readonly", (store) => store.get(key)).then(
        (raw) => (raw == null ? null : deserialize(String(raw))),
      ),
    name: "indexdb",
    pacer: options?.pacer ?? { trailing: true, wait: 100 },
    removeItem: (key) =>
      withStore(dbName, storeName, "readwrite", (store) =>
        store.delete(key),
      ).then(() => undefined),
    resolveKey: defaultResolveKey,
    setItem: (key, value) =>
      withStore(dbName, storeName, "readwrite", (store) =>
        store.put(serialize(value), key),
      ).then(() => undefined),
  };
};
