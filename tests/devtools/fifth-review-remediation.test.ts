import { afterEach, describe, expect, jest, test } from "bun:test";
import type {
  AdapterEvent,
  NusmAdapter,
  NusmDevtoolsSnapshot,
  PersistSlice,
} from "../../src";
import { createNusmStore } from "../../src";
import { setValueAtPath } from "../../src/devtools/path";

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

describe("fifth semantic review remediations", () => {
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

      const arrayResult = setValueAtPath(
        new Array(1_777),
        [1_777],
        "safe",
      ) as unknown[];
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
});
