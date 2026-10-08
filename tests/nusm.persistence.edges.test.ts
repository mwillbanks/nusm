import { afterEach, describe, expect, jest, test } from "bun:test";
import type {
  AdapterEvent,
  NusmAdapter,
  NusmDevtoolsSnapshot,
  PersistSlice,
} from "../src";
import { createNusmStore } from "../src";
import { setValueAtPath } from "../src/devtools/path";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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
const command = (target: EventTarget, payload: Record<string, unknown>) =>
  target.dispatchEvent(
    new CustomEvent("nusm:command", { detail: { payload } }),
  );

afterEach(() => jest.restoreAllMocks());

describe("nusm persistence edges", () => {
  test("marks hydration as failed when the adapter read rejects", async () => {
    const errors: unknown[] = [];
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: () => Promise.reject(new Error("read failed")),
          name: "read-failure",
          pacer: false,
          removeItem: () => undefined,
          setItem: () => undefined,
        },
        onError: (error) => errors.push(error),
        persist: { strategy: "entire" },
        storeId: "read-failure",
      },
    );
    await store.ready;
    expect(store.hydration.overall).toBe("error");
    expect(errors).toHaveLength(1);
  });

  test("continues queued adapter reads after a rejected read", async () => {
    let reads = 0;
    const errors: unknown[] = [];
    let notify: ((event: AdapterEvent) => void) | undefined;
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: () => {
            reads += 1;
            return reads === 2
              ? Promise.reject(new Error("first event failed"))
              : { value: reads >= 3 ? 2 : 1 };
          },
          name: "queued-read-recovery",
          pacer: false,
          removeItem: () => undefined,
          setItem: () => undefined,
          subscribe: (listener) => {
            notify = listener;
            return () => {
              notify = undefined;
            };
          },
        },
        onError: (error) => errors.push(error),
        persist: { strategy: "entire" },
        storeId: "queued-read-recovery",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await store.ready;
    const key = "nusm:queued-read-recovery:entire";
    notify?.({ key, type: "set" });
    await tick();
    notify?.({ key, type: "set" });
    await tick();
    expect(reads).toBe(3);
    expect(store.state).toEqual({ value: 2 });
    expect(errors).toHaveLength(1);
    await store.dispose();
  });

  test("isolates a throwing error reporter during persistence flush", async () => {
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: () => ({ value: 1 }),
          name: "throwing-flush-reporter",
          pacer: false,
          removeItem: () => undefined,
          setItem: () => Promise.reject(new Error("write failed")),
        },
        onError: () => {
          throw new Error("reporter failed");
        },
        persist: { strategy: "entire" },
        storeId: "throwing-flush-reporter",
      },
    );
    await store.ready;
    store.setState({ value: 2 });
    await tick();
    expect(store.state).toEqual({ value: 2 });
    await store.dispose();
  });

  test("recovers the serialized flush queue after disposal failure", async () => {
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: () => ({ value: 1 }),
          name: "serialized-flush-failure",
          pacer: { wait: 1_000 },
          removeItem: () => undefined,
          setItem: () => Promise.reject(new Error("dispose write failed")),
        },
        persist: { strategy: "entire" },
        storeId: "serialized-flush-failure",
      },
    );
    await store.ready;
    store.setState({ value: 2 });
    await expect(store.dispose()).rejects.toThrow("Store disposal failed");
  });

  test("hydrates array state through the published store entry", async () => {
    const store = createNusmStore(
      { items: [1] },
      {
        adapter: {
          getItem: () => ({ items: [2, 3] }),
          name: "array-hydration",
          pacer: false,
          removeItem: () => undefined,
          setItem: () => undefined,
        },
        persist: { strategy: "entire" },
        storeId: "array-hydration",
      },
    );
    await store.ready;
    expect(store.state).toEqual({ items: [2, 3] });
  });

  test("removes nested persisted slice values through the public command surface", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const key = "nusm:nested-remove:slice:settings";
    const values = new Map<string, unknown>([
      [key, { theme: { contrast: true, label: "dark" } }],
    ]);
    const settings: PersistSlice<{ settings: unknown }> = {
      apply: (state, value) => ({ ...state, settings: value }),
      key: "settings",
      select: (state) => state.settings,
    };
    const store = createNusmStore(
      { settings: { theme: { contrast: true, label: "dark" } } },
      {
        adapter: {
          getItem: (storageKey) => values.get(storageKey) ?? null,
          name: "nested-remove",
          pacer: false,
          removeItem: (storageKey) => values.delete(storageKey),
          setItem: (storageKey, value) => values.set(storageKey, value),
        },
        devtools: true,
        persist: { slices: [settings], strategy: "slices" },
        storeId: "nested-remove",
      },
    );
    await store.ready;
    command(target, {
      action: "remove_path",
      commandId: "remove-nested",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["settings", "theme", "label"],
      storeId: "nested-remove",
    });
    await tick();
    await tick();
    expect(values.get(key)).toEqual({ theme: { contrast: true } });
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("keeps delayed set and remove notifications isolated while writes are in flight", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const listeners = new Set<(event: AdapterEvent) => void>();
    const values = new Map<string, unknown>([
      ["nusm:slow-entire:entire", { count: 1 }],
      ["nusm:slow-slice:slice:piece", 1],
    ]);
    let releaseWrite: (() => void) | undefined;
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "slow-custom",
      pacer: false,
      removeItem: (key) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            values.delete(key);
            for (const listener of listeners) listener({ key, type: "remove" });
            resolve();
          };
        }),
      setItem: (key, value) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            values.set(key, value);
            for (const listener of listeners) listener({ key, type: "set" });
            resolve();
          };
        }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const entire = createNusmStore(
      { count: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "slow-entire",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await entire.ready;
    command(target, {
      action: "set_path",
      commandId: "slow-set",
      instanceId: entire.devtoolsInstanceId,
      location: "persisted",
      path: ["count"],
      storeId: "slow-entire",
      value: 9,
    });
    await tick();
    now = 2_000;
    expect(releaseWrite).toBeFunction();
    releaseWrite?.();
    await tick();
    expect(entire.state).toEqual({ count: 1 });

    const slice: PersistSlice<{ piece: number }> = {
      apply: (state, value) => ({ ...state, piece: value as number }),
      key: "piece",
      select: (state) => state.piece,
    };
    const sliced = createNusmStore(
      { piece: 1 },
      {
        adapter,
        devtools: true,
        persist: { slices: [slice], strategy: "slices" },
        storeId: "slow-slice",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await sliced.ready;
    command(target, {
      action: "remove_path",
      commandId: "slow-remove",
      instanceId: sliced.devtoolsInstanceId,
      location: "persisted",
      path: ["piece"],
      storeId: "slow-slice",
    });
    await tick();
    now = 4_000;
    releaseWrite?.();
    await tick();
    expect(sliced.state).toEqual({ piece: 1 });
    expect(values.has("nusm:slow-slice:slice:piece")).toBe(false);
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("superseded persisted edits discard queued state writes", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const key = "nusm:queued:entire";
    const values = new Map<string, unknown>([[key, { count: 0 }]]);
    const writes: unknown[] = [];
    const adapter: NusmAdapter = {
      getItem: (storageKey) => values.get(storageKey) ?? null,
      name: "queued-persistence",
      pacer: { wait: 40 },
      removeItem: (storageKey) => values.delete(storageKey),
      setItem: (storageKey, value) => {
        writes.push(value);
        values.set(storageKey, value);
      },
    };
    const store = createNusmStore(
      { count: 0 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "queued",
      },
    );
    await store.ready;

    store.setState({ count: 1 });
    command(target, {
      action: "replace_persisted",
      commandId: "supersede-queued",
      instanceId: store.devtoolsInstanceId,
      storeId: "queued",
      value: { count: 9 },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(values.get(key)).toEqual({ count: 9 });
    expect(writes).toEqual([{ count: 9 }]);
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("defines object and array edits as own properties without inherited setters", () => {
    let objectSetterCalls = 0;
    Object.defineProperty(Object.prototype, "reviewOwnKey", {
      configurable: true,
      set: () => {
        objectSetterCalls += 1;
      },
    });
    let arraySetterCalls = 0;
    Object.defineProperty(Array.prototype, "1777", {
      configurable: true,
      set: () => {
        arraySetterCalls += 1;
      },
    });
    try {
      const objectResult = setValueAtPath(
        {},
        ["reviewOwnKey"],
        "safe",
      ) as Record<string, unknown>;
      expect(objectSetterCalls).toBe(0);
      expect(Object.hasOwn(objectResult, "reviewOwnKey")).toBe(true);
      expect(objectResult.reviewOwnKey).toBe("safe");

      const sparse: unknown[] = [];
      sparse.length = 1_777;
      const arrayResult = setValueAtPath(sparse, [1_777], "safe") as unknown[];
      expect(arraySetterCalls).toBe(0);
      expect(Object.hasOwn(arrayResult, 1_777)).toBe(true);
      expect(arrayResult[1_777]).toBe("safe");
    } finally {
      delete (Object.prototype as Record<string, unknown>).reviewOwnKey;
      delete (Array.prototype as unknown as Record<string, unknown>)["1777"];
    }
  });

  test("rejects Proxy mutations without changing state and reports the unsupported boundary", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    let traps = 0;
    const proxied = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor: (source, key) => {
          traps += 1;
          return Reflect.getOwnPropertyDescriptor(source, key);
        },
        ownKeys: (source) => {
          traps += 1;
          return Reflect.ownKeys(source);
        },
      },
    );
    const results: Array<{ error?: string; status: string }> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(proxied, {
      devtools: true,
      storeId: "proxy",
    });
    await store.ready;
    command(target, {
      action: "set_path",
      commandId: "proxy-edit",
      instanceId: store.devtoolsInstanceId,
      location: "memory",
      path: ["value"],
      storeId: "proxy",
      value: 2,
    });
    await tick();
    expect(traps).toBeGreaterThan(0);
    expect(store.state.value).toBe(1);
    expect(results.at(-1)).toMatchObject({
      error: "Devtools mutations do not support Proxy values.",
      status: "error",
    });
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("preserves hostile slice names in hydration, snapshots, and raw replacement", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const key = "nusm:hostile-slice:slice:__proto__";
    const values = new Map<string, unknown>([[key, 7]]);
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: (storageKey) => values.get(storageKey) ?? null,
      name: "hostile-keys",
      pacer: false,
      removeItem: (storageKey) => values.delete(storageKey),
      setItem: (storageKey, value) => values.set(storageKey, value),
    };
    const hostileSlice: PersistSlice<{ value: number }> = {
      apply: (_state, value) => ({ value: value as number }),
      key: "__proto__",
      select: (state) => state.value,
    };
    const store = createNusmStore(
      { value: 1 },
      {
        adapter,
        devtools: true,
        persist: { slices: [hostileSlice], strategy: "slices" },
        storeId: "hostile-slice",
      },
    );
    await store.ready;
    await tick();
    expect(store.state.value).toBe(7);
    expect(Object.hasOwn(store.hydration.byKey, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(store.hydration.byKey, "__proto__")
        ?.value,
    ).toBe("hydrated");
    expect(
      Object.hasOwn(snapshots.at(-1)?.persisted as object, "__proto__"),
    ).toBe(true);

    const replacement: Record<string, unknown> = Object.create(null);
    Object.defineProperty(replacement, "__proto__", {
      enumerable: true,
      value: 11,
    });
    command(target, {
      action: "replace_persisted",
      commandId: "hostile-raw",
      instanceId: store.devtoolsInstanceId,
      storeId: "hostile-slice",
      value: replacement,
    });
    await tick();
    expect(values.get(key)).toBe(11);
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("publishes producer-owned synchronization state", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const values = new Map<string, unknown>([
      ["nusm:sync:entire", { count: 1 }],
    ]);
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "sync-adapter",
      pacer: false,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    const store = createNusmStore(
      { count: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "sync",
      },
    );
    await store.ready;
    store.setState(() => ({ count: 2 }));
    await tick();
    expect(snapshots.at(-1)?.synchronization).toBe("synchronized");
    command(target, {
      action: "set_path",
      commandId: "diverge",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["count"],
      storeId: "sync",
      value: 9,
    });
    await tick();
    expect(snapshots.at(-1)?.synchronization).toBe("diverged");
    command(target, {
      action: "remove_path",
      commandId: "remove-entire",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["count"],
      storeId: "sync",
    });
    await tick();
    await tick();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("returns deeply frozen hydration snapshots instead of the internal ledger", async () => {
    const store = createNusmStore({ value: 1 });
    await store.ready;
    const first = store.hydration;
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.byKey)).toBe(true);
    expect(() => {
      (first as { overall: string }).overall = "error";
    }).toThrow();
    expect(store.hydration.overall).toBe("not_configured");
    expect(store.hydration).not.toBe(first);
  });

  test("reports devtools snapshot read failures and unknown synchronization", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const key = "nusm:snapshot-errors:entire";
    const values = new Map<string, unknown>([[key, { value: 1 }]]);
    let throwOnRead = false;
    let returnUninspectable = false;
    const events: Array<{ type: string }> = [];
    target.addEventListener("nusm:event", (event) => {
      const payload = (event as CustomEvent).detail.payload;
      if (payload?.type) events.push(payload);
    });
    target.addEventListener("tanstack-connect", () =>
      target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
    );
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail;
      target.dispatchEvent(new CustomEvent(detail.type, { detail }));
    });
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: (storageKey) => {
            if (throwOnRead) throw new Error("snapshot denied");
            if (returnUninspectable)
              return new Proxy(
                { value: 1 },
                {
                  ownKeys: () => {
                    throw new Error("snapshot opaque");
                  },
                },
              );
            return values.get(storageKey) ?? null;
          },
          name: "snapshot-errors",
          pacer: false,
          removeItem: (storageKey) => values.delete(storageKey),
          setItem: (storageKey, value) => values.set(storageKey, value),
        },
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "snapshot-errors",
      },
    );
    await store.ready;
    throwOnRead = true;
    target.dispatchEvent(
      new CustomEvent("nusm:command", {
        detail: {
          payload: {
            action: "refresh",
            commandId: "snapshot-refresh",
            instanceId: store.devtoolsInstanceId,
            storeId: "snapshot-errors",
          },
        },
      }),
    );
    await tick();
    expect(events.some(({ type }) => type === "devtools_snapshot_error")).toBe(
      true,
    );
    throwOnRead = false;
    returnUninspectable = true;
    store.setState({ value: 2 });
    await tick();
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("contains synchronization disposal reporter failures", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const store = createNusmStore(
      { value: 1 },
      {
        devtools: true,
        storeId: "dispose-reporting",
        sync: {
          source: { publish: () => undefined, start: () => undefined },
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await store.ready;
    Object.defineProperty(target, "dispatchEvent", {
      configurable: true,
      value: () => {
        throw new Error("disposal reporter denied");
      },
    });
    await store.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });
});
