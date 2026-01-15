import { describe, expect, test } from "bun:test";
import {
  createLocalStorageAdapter,
  createSessionStorageAdapter,
  type StorageLike,
} from "../../src/index";

type MemoryStorage = StorageLike & { data: Map<string, string> };

const createMemoryStorage = (): MemoryStorage => {
  const data = new Map<string, string>();
  return {
    clear: () => {
      data.clear();
    },
    data,
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe("storage adapters", () => {
  test("throws when no storage available", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error - test-only global mutation
    delete globalThis.window;

    expect(() => createLocalStorageAdapter()).toThrow();

    globalThis.window = originalWindow;
  });

  test("local storage adapter serializes and deserializes", async () => {
    const storage = createMemoryStorage();
    const adapter = createLocalStorageAdapter({
      deserialize: (raw) => JSON.parse(raw.slice(2)),
      serialize: (value) => `x:${JSON.stringify(value)}`,
      storage,
    });

    const key = adapter.resolveKey?.({ kind: "entire", storeId: "store" });
    expect(key).toBe("nusm:store:entire");
    if (!key) throw new Error("Missing resolved key");

    const sliceKey = adapter.resolveKey?.({
      kind: "slice",
      sliceKey: "prefs",
      storeId: "store",
    });
    expect(sliceKey).toBe("nusm:store:slice:prefs");

    await adapter.setItem(key, { count: 2 });
    expect(storage.data.get(key)).toBe('x:{"count":2}');

    const value = await adapter.getItem(key);
    expect(value).toEqual({ count: 2 });
  });

  test("session storage adapter uses custom prefix", async () => {
    const storage = createMemoryStorage();
    const adapter = createSessionStorageAdapter({
      prefix: "custom",
      storage,
    });

    const key = adapter.resolveKey?.({ kind: "entire", storeId: "store" });
    expect(key).toBe("custom:store:entire");
    if (!key) throw new Error("Missing resolved key");

    await adapter.setItem(key, { enabled: true });
    const value = await adapter.getItem(key);
    expect(value).toEqual({ enabled: true });
  });

  test("getAllKeys iterates over storage keys", async () => {
    const storage = createMemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");

    const adapter = createLocalStorageAdapter({ storage });
    const keys = await adapter.getAllKeys?.();
    expect(keys?.sort()).toEqual(["a", "b"]);
  });

  test("storage event handlers map to adapter events", () => {
    const storage = createMemoryStorage();
    const adapter = createLocalStorageAdapter({ storage });

    const events: Array<{ type: string; key?: string }> = [];
    const unsubscribe = adapter.subscribe?.((event) => events.push(event));

    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: "other:store" }));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "nusm:store:entire", newValue: null }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "nusm:store:entire",
        newValue: "value",
      }),
    );

    expect(events).toEqual([
      { key: "nusm:store:entire", type: "remove" },
      { key: "nusm:store:entire", type: "set" },
    ]);

    unsubscribe?.();
  });

  test("clear removes stored values", async () => {
    const storage = createMemoryStorage();
    const adapter = createLocalStorageAdapter({ storage });
    storage.setItem("nusm:test:entire", "1");

    await adapter.clear?.();
    expect(storage.length).toBe(0);
  });

  test("getAllKeys returns empty when storage metadata missing", async () => {
    const storage: StorageLike = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    };
    const adapter = createLocalStorageAdapter({ storage });
    const keys = await adapter.getAllKeys?.();
    expect(keys).toEqual([]);
  });

  test("subscribe returns noop when window is missing", () => {
    const storage = createMemoryStorage();
    const originalWindow = globalThis.window;
    // @ts-expect-error - test-only global mutation
    delete globalThis.window;

    const adapter = createLocalStorageAdapter({ storage });
    const unsubscribe = adapter.subscribe?.(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe?.();

    globalThis.window = originalWindow;
  });
});
