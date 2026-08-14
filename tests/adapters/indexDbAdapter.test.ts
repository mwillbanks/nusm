import { describe, expect, test } from "bun:test";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { createIndexDbAdapter } from "../../src/index";

describe("indexdb adapter", () => {
  test("throws when indexedDB is missing", () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error - test-only global mutation
    delete globalThis.indexedDB;

    expect(() => createIndexDbAdapter()).toThrow();

    globalThis.indexedDB = original;
  });

  test("reads and writes values", async () => {
    const original = globalThis.indexedDB;
    globalThis.indexedDB = fakeIndexedDB;

    const adapter = createIndexDbAdapter({
      dbName: "db",
      storeName: "nusm",
    });

    const key = adapter.resolveKey?.({ kind: "entire", storeId: "store" });
    if (!key) throw new Error("Missing resolved key");
    expect(
      adapter.resolveKey?.({
        kind: "slice",
        sliceKey: "prefs",
        storeId: "store",
      }),
    ).toBe("nusm:store:slice:prefs");

    await adapter.setItem(key, { value: 1 });
    const value = await adapter.getItem(key);
    expect(value).toEqual({ value: 1 });

    const keys = await adapter.getAllKeys?.();
    expect(keys).toEqual([key]);

    await adapter.removeItem(key);
    const empty = await adapter.getItem(key);
    expect(empty).toBeNull();

    await adapter.setItem(key, { value: 2 });
    await adapter.clear?.();
    const cleared = await adapter.getItem(key);
    expect(cleared).toBeNull();

    globalThis.indexedDB = original;
  });

  test("propagates IndexedDB open failures", async () => {
    const original = globalThis.indexedDB;
    const failure = new Error("database unavailable");
    globalThis.indexedDB = {
      open: () => {
        const request = {
          error: failure,
          onerror: undefined as (() => void) | undefined,
          onsuccess: undefined as (() => void) | undefined,
          onupgradeneeded: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const adapter = createIndexDbAdapter();
      await expect(adapter.getItem("broken")).rejects.toThrow(
        "database unavailable",
      );
    } finally {
      globalThis.indexedDB = original;
    }
  });

  test("propagates IndexedDB request failures", async () => {
    const original = globalThis.indexedDB;
    const failure = new Error("request unavailable");
    globalThis.indexedDB = {
      open: () => {
        const request = {
          error: failure,
          onerror: undefined as (() => void) | undefined,
          onsuccess: undefined as (() => void) | undefined,
          onupgradeneeded: undefined as (() => void) | undefined,
          result: {
            objectStoreNames: { contains: () => true },
            transaction: () => ({
              objectStore: () => ({
                get: () => {
                  const operation = {
                    error: failure,
                    onerror: undefined as (() => void) | undefined,
                    onsuccess: undefined as (() => void) | undefined,
                  };
                  queueMicrotask(() => operation.onerror?.());
                  return operation;
                },
              }),
            }),
          },
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const adapter = createIndexDbAdapter();
      await expect(adapter.getItem("broken-request")).rejects.toThrow(
        "request unavailable",
      );
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
