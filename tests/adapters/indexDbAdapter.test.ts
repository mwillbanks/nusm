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
});
