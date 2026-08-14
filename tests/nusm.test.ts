import { describe, expect, test } from "bun:test";
import {
  createNusmStore,
  type NusmAdapter,
  type PersistSlice,
} from "../src/index";
import { createMemoryAdapter } from "./helpers/memory-adapter";

const resolveKey = (params: {
  storeId: string;
  sliceKey?: string;
  kind: "entire" | "slice";
}): string => {
  if (params.kind === "entire") return `nusm:${params.storeId}:entire`;
  return `nusm:${params.storeId}:slice:${params.sliceKey}`;
};

describe("nusm hydration", () => {
  test("entire hydration deep merges initial and persisted", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "entire-merge";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { arr: [9], b: { c: 20 } });

    const nusm = createNusmStore(
      { a: 1, arr: [1, 2], b: { c: 2, d: 3 } },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;

    expect(nusm.state).toEqual({
      a: 1,
      arr: [9],
      b: { c: 20, d: 3 },
    });
  });

  test("entire hydration uses custom merge", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "entire-custom-merge";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { count: 3 });

    const nusm = createNusmStore(
      { count: 0, merged: false },
      {
        adapter,
        persist: {
          hydrate: {
            merge: ({ initial, persisted }) => ({
              ...(initial as { count: number; merged: boolean }),
              ...(persisted as { count: number }),
              merged: true,
            }),
          },
          strategy: "entire",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ count: 3, merged: true });
  });

  test("slices hydration applies slice values", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "slices-merge";
    const todosKey = resolveKey({ kind: "slice", sliceKey: "todos", storeId });
    const settingsKey = resolveKey({
      kind: "slice",
      sliceKey: "settings",
      storeId,
    });

    store.set(todosKey, [{ id: 1, title: "a" }]);
    store.set(settingsKey, { theme: "dark" });

    type State = {
      todos: Array<{ id: number; title: string }>;
      settings: { theme: string };
    };

    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, sliceValue) => ({
          ...state,
          todos: sliceValue as State["todos"],
        }),
        key: "todos",
        select: (state) => state.todos,
      },
      {
        apply: (state, sliceValue) => ({
          ...state,
          settings: sliceValue as State["settings"],
        }),
        key: "settings",
        select: (state) => state.settings,
      },
    ];

    const nusm = createNusmStore<State>(
      { settings: { theme: "light" }, todos: [] },
      {
        adapter,
        persist: {
          slices,
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state.todos).toEqual([{ id: 1, title: "a" }]);
    expect(nusm.state.settings).toEqual({ theme: "dark" });
  });

  test("discardPersisted skips persisted values", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "discarded";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 10 });

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        persist: {
          hydrate: { discardPersisted: true },
          strategy: "entire",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("validate can discard or transform persisted values", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "validate";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: -1 });

    const nusm = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: {
          hydrate: {
            validate: (persisted) => {
              if ((persisted as { value: number }).value < 0) {
                return { ok: true, value: { value: 5 } };
              }
              return { ok: true, value: persisted };
            },
          },
          strategy: "entire",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ value: 5 });
  });

  test("entire hydration records error when adapter fails", async () => {
    const storeId = "entire-error";
    const key = resolveKey({ kind: "entire", storeId });
    const { adapter } = createMemoryAdapter({ errorKeys: [key] });
    const errors: unknown[] = [];

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        onError: (err) => errors.push(err),
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    expect(errors.length).toBe(1);
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("slice hydration marks missing keys as hydrated", async () => {
    type State = { a: number; b: number };
    const { adapter } = createMemoryAdapter();
    const storeId = "slice-missing";

    const nusm = createNusmStore<State>(
      { a: 1, b: 2 },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, value) => ({ ...state, a: value as number }),
              key: "a",
              select: (state) => state.a,
            },
            {
              apply: (state, value) => ({ ...state, b: value as number }),
              key: "b",
              select: (state) => state.b,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ a: 1, b: 2 });
  });

  test("slice hydration discards invalid persisted values", async () => {
    type State = { prefs: { theme: string } };
    const { adapter, store } = createMemoryAdapter();
    const storeId = "slice-discard";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    store.set(key, { theme: "dark" });

    const nusm = createNusmStore<State>(
      { prefs: { theme: "light" } },
      {
        adapter,
        persist: {
          hydrate: {
            validate: () => ({ ok: false }),
          },
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                prefs: value as State["prefs"],
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ prefs: { theme: "light" } });
  });

  test("slice hydration can transform persisted values", async () => {
    type State = { prefs: { theme: string } };
    const { adapter, store } = createMemoryAdapter();
    const storeId = "slice-transform";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    store.set(key, { theme: "dark" });

    const nusm = createNusmStore<State>(
      { prefs: { theme: "light" } },
      {
        adapter,
        persist: {
          hydrate: {
            validate: (persisted) => ({
              ok: true,
              value: { theme: `${(persisted as { theme: string }).theme}!` },
            }),
          },
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                prefs: value as State["prefs"],
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ prefs: { theme: "dark!" } });
  });

  test("slice hydration records error when adapter fails", async () => {
    type State = { prefs: { theme: string } };
    const storeId = "slice-error";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    const { adapter } = createMemoryAdapter({ errorKeys: [key] });
    const errors: unknown[] = [];

    const nusm = createNusmStore<State>(
      { prefs: { theme: "light" } },
      {
        adapter,
        onError: (err) => errors.push(err),
        persist: {
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                prefs: value as State["prefs"],
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(errors.length).toBe(1);
    expect(nusm.state).toEqual({ prefs: { theme: "light" } });
  });
});

describe("nusm persistence scheduling", () => {
  test("debounces persistence and coalesces values", async () => {
    const { adapter, setItemCalls } = createMemoryAdapter({
      pacer: { wait: 20 },
    });

    const nusm = createNusmStore(
      { count: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "debounce",
      },
    );
    await nusm.ready;
    setItemCalls.length = 0;
    nusm.setState((state) => ({ count: state.count + 1 }));
    nusm.setState((state) => ({ count: state.count + 1 }));
    nusm.setState((state) => ({ count: state.count + 1 }));

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(setItemCalls.length).toBe(1);
    const [firstCall] = setItemCalls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.value).toEqual({ count: 3 });
  });

  test("pacer false persists immediately", async () => {
    const { adapter, setItemCalls } = createMemoryAdapter({
      pacer: false,
    });

    const nusm = createNusmStore(
      { count: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "immediate",
      },
    );
    await nusm.ready;
    setItemCalls.length = 0;
    nusm.setState((state) => ({ count: state.count + 1 }));

    expect(setItemCalls.length).toBe(1);
    expect(setItemCalls[0]?.value).toEqual({ count: 1 });
  });

  test("slice persistence schedules only changed slices", async () => {
    type State = { todos: string[]; prefs: { theme: string } };
    const { adapter, setItemCalls } = createMemoryAdapter({ pacer: false });
    const storeId = "slice-persist";

    const nusm = createNusmStore<State>(
      { prefs: { theme: "light" }, todos: [] },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                todos: value as string[],
              }),
              key: "todos",
              select: (state) => state.todos,
            },
            {
              apply: (state, value) => ({
                ...state,
                prefs: value as { theme: string },
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    nusm.setState((state) => ({
      ...state,
      prefs: { theme: "dark" },
    }));

    const sliceKey = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    expect(setItemCalls.some((call) => call.key === sliceKey)).toBe(true);
  });

  test("setItem errors trigger onError", async () => {
    const storeId = "persist-error";
    const key = resolveKey({ kind: "entire", storeId });
    const { adapter } = createMemoryAdapter({
      pacer: false,
      setItemErrorKeys: [key],
    });
    const errors: unknown[] = [];

    const nusm = createNusmStore(
      { count: 0 },
      {
        adapter,
        onError: (err) => errors.push(err),
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await nusm.ready;
    errors.length = 0;
    nusm.setState((state) => ({ count: state.count + 1 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors.length).toBe(1);
  });
});

describe("nusm adapter events", () => {
  test("delayed adapter validation cannot overwrite a newer synchronized different-slice state", async () => {
    const sourceListeners = new Set<
      (event: import("../src").NusmSyncEvent) => void
    >();
    const source = {
      publish: () => undefined,
      start: (listener: (event: import("../src").NusmSyncEvent) => void) => {
        sourceListeners.add(listener);
        return () => sourceListeners.delete(listener);
      },
    };
    const values = new Map<string, unknown>([
      ["nusm:adapter-race:slice:object", { enabled: false }],
      ["nusm:adapter-race:slice:items", [{ id: 1 }]],
    ]);
    const adapter: NusmAdapter = {
      getItem: async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return values.get(key) ?? null;
      },
      name: "adapter-race",
      removeItem: (key) => void values.delete(key),
      setItem: (key, value) => void values.set(key, value),
      subscribe: (listener) => {
        (
          adapter as NusmAdapter & { listener?: (event: AdapterEvent) => void }
        ).listener = listener;
        return () => undefined;
      },
    };
    const slices: PersistSlice<{ object: unknown; items: unknown[] }>[] = [
      {
        apply: (state, value) => ({ ...state, object: value }),
        key: "object",
        select: (state) => state.object,
      },
      {
        apply: (state, value) => ({ ...state, items: value as unknown[] }),
        key: "items",
        select: (state) => state.items,
      },
    ];
    const store = createNusmStore(
      { items: [{ id: 1 }], object: { enabled: false } },
      {
        adapter,
        persist: { slices, strategy: "slices" },
        storeId: "adapter-race",
        sync: {
          source,
          validator: async (candidate, context) => {
            if (context.source === "adapter-race")
              await new Promise((resolve) => setTimeout(resolve, 25));
            return candidate !== null && typeof candidate === "object";
          },
        },
      },
    );
    await store.ready;
    values.set("nusm:adapter-race:slice:object", { enabled: true });
    (
      adapter as NusmAdapter & { listener?: (event: AdapterEvent) => void }
    ).listener?.({
      key: "nusm:adapter-race:slice:object",
      type: "set",
    });
    for (const listener of sourceListeners)
      listener({
        eventId: "adapter-race-sync",
        kind: "update",
        revision: { counter: 1, senderId: "peer" },
        sourceId: "peer",
        state: { items: [{ id: 2 }], object: { enabled: false } },
        storeId: "adapter-race",
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.state).toEqual({
      items: [{ id: 2 }],
      object: { enabled: false },
    });
    await store.dispose();
  });

  test("validates live adapter candidates after merge while hydration validation stays independent", async () => {
    const memory = createMemoryAdapter({ pacer: false, withSubscribe: true });
    const sourceEvents: unknown[] = [];
    const key = resolveKey({ kind: "entire", storeId: "adapter-validation" });
    memory.store.set(key, { value: 2 });
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: memory.adapter,
        persist: {
          hydrate: { validate: () => false },
          strategy: "entire",
        },
        storeId: "adapter-validation",
        sync: {
          source: {
            publish: (event) => sourceEvents.push(event),
            start: () => () => undefined,
          },
          validator: (candidate) =>
            (candidate as { value: number }).value === 3,
        },
      },
    );
    await store.ready;
    expect(store.state).toEqual({ value: 1 });
    memory.setItemCalls.length = 0;
    sourceEvents.length = 0;
    memory.store.set(key, { value: -1 });
    memory.emit({ key, type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 1 });
    expect(memory.setItemCalls).toHaveLength(0);
    expect(sourceEvents).toHaveLength(0);
    memory.store.set(key, { value: 3 });
    memory.emit({ key, type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 3 });
    memory.setItemCalls.length = 0;
    sourceEvents.length = 0;
    memory.emit({ key, type: "remove" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 3 });
    expect(memory.setItemCalls).toHaveLength(0);
    expect(sourceEvents).toHaveLength(0);
    memory.emit({ type: "clear" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 3 });
    expect(memory.setItemCalls).toHaveLength(0);
    expect(sourceEvents).toHaveLength(0);
    await store.dispose();
  });

  test("applies an adapter transformation to an undefined-capable state", async () => {
    const memory = createMemoryAdapter({ pacer: false, withSubscribe: true });
    const key = resolveKey({ kind: "entire", storeId: "adapter-undefined" });
    const store = createNusmStore<string | undefined>("initial", {
      adapter: memory.adapter,
      persist: { strategy: "entire" },
      storeId: "adapter-undefined",
      sync: {
        validator: (candidate) =>
          candidate === "remote" ? { ok: true, value: undefined } : false,
      },
    });
    await store.ready;
    memory.store.set(key, "remote");
    memory.emit({ key, type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toBeUndefined();
    await store.dispose();
  });

  test("external set updates the store after ready", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "external-set";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 1 });

    const nusm = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    store.set(key, { value: 2 });
    emit({ key, type: "set" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ value: 2 });
  });

  test("events before ready are buffered and applied after hydration", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      delayGetMs: 30,
      withSubscribe: true,
    });
    const storeId = "buffered-event";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 1 });

    const nusm = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    store.set(key, { value: 2 });
    emit({ key, type: "set" });

    await nusm.ready;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(nusm.state).toEqual({ value: 2 });
  });

  test("remove event resets to initial state", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "remove-event";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 10 });

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    emit({ key, type: "remove" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("clear event resets slices to initial state", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "clear-event";
    const key = resolveKey({ kind: "slice", sliceKey: "todos", storeId });
    store.set(key, [{ id: 1 }]);

    const nusm = createNusmStore(
      { todos: [] as Array<{ id: number }> },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, sliceValue) => ({
                ...state,
                todos: sliceValue as Array<{ id: number }>,
              }),
              key: "todos",
              select: (state) => state.todos,
            },
          ],
          strategy: "slices",
        },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    emit({ type: "clear" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ todos: [] });
  });

  test("clear event resets entire state", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "clear-entire";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 10 });

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    emit({ type: "clear" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("slice remove resets slice to initial", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "slice-remove";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    store.set(key, { theme: "dark" });

    const nusm = createNusmStore(
      { prefs: { theme: "light" } },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, sliceValue) => ({
                ...state,
                prefs: sliceValue as { theme: string },
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    emit({ key, type: "remove" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ prefs: { theme: "light" } });
  });

  test("slice set ignores missing persisted value", async () => {
    const { adapter, emit } = createMemoryAdapter({ withSubscribe: true });
    const storeId = "slice-null";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });

    const nusm = createNusmStore(
      { prefs: { theme: "light" } },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, sliceValue) => ({
                ...state,
                prefs: sliceValue as { theme: string },
              }),
              key: "prefs",
              select: (state) => state.prefs,
            },
          ],
          strategy: "slices",
        },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    emit({ key, type: "set" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ prefs: { theme: "light" } });
  });

  test("external set uses hydrate merge for entire state", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      withSubscribe: true,
    });
    const storeId = "external-merge";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 2 });

    const nusm = createNusmStore(
      { merged: false, value: 0 },
      {
        adapter,
        persist: {
          hydrate: {
            merge: ({ initial, persisted }) => ({
              ...(initial as { value: number; merged: boolean }),
              ...(persisted as { value: number }),
              merged: true,
            }),
          },
          strategy: "entire",
        },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    store.set(key, { value: 3 });
    emit({ key, type: "set" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ merged: true, value: 3 });
  });
});

describe("nusm guards", () => {
  test("throws when adapter present without storeId or devtools name", () => {
    const { adapter } = createMemoryAdapter();
    expect(() =>
      createNusmStore(
        { value: 1 },
        {
          adapter,
          persist: { strategy: "entire" },
        },
      ),
    ).toThrow();
  });

  test("does not derive persistence identity from a Devtools name", () => {
    const { adapter, setItemCalls } = createMemoryAdapter();
    expect(() =>
      createNusmStore(
        { value: 1 },
        {
          adapter,
          devtools: { name: "My Store" },
          persist: { strategy: "entire" },
        },
      ),
    ).toThrow("explicit storeId");
    expect(setItemCalls).toHaveLength(0);
  });

  test("discardPersisted via function for slices", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "discard-fn";
    const key = resolveKey({ kind: "slice", sliceKey: "profile", storeId });
    store.set(key, { name: "Jane" });

    const nusm = createNusmStore(
      { profile: { name: "Init" } },
      {
        adapter,
        persist: {
          hydrate: {
            discardPersisted: () => true,
          },
          slices: [
            {
              apply: (state, sliceValue) => ({
                ...state,
                profile: sliceValue as { name: string },
              }),
              key: "profile",
              select: (state) => state.profile,
            },
          ],
          strategy: "slices",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ profile: { name: "Init" } });
  });

  test("validate false discards persisted", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "validate-false";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 9 });

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        persist: {
          hydrate: {
            validate: () => false,
          },
          strategy: "entire",
        },
        storeId,
      },
    );

    await nusm.ready;
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("applies an adapter event when its value differs from the completed write", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      pacer: false,
      withSubscribe: true,
    });
    const storeId = "recent-write";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 1 });

    const nusm = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );

    await nusm.ready;
    nusm.setState({ value: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.set(key, { value: 1 });
    emit({ key, type: "set" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ value: 1 });
  });

  test("defers an adapter invalidation raised during an active write", async () => {
    let persisted: unknown = { value: 0 };
    let writeStarted: (() => void) | undefined;
    let finishWrite: (() => void) | undefined;
    const listeners = new Set<
      Parameters<NonNullable<NusmAdapter["subscribe"]>>[0]
    >();
    const adapter: NusmAdapter = {
      getItem: async () => persisted,
      name: "racy-memory",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => {
        writeStarted?.();
        return new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const store = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "racy",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await store.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    store.setState({ value: 1 });
    await started;
    persisted = { value: 2 };
    for (const listener of listeners)
      listener({ key: "nusm:racy:entire", type: "set" });
    finishWrite?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 2 });
    await store.dispose();
  });

  test("defers an adapter clear until every active write completes", async () => {
    const persisted: unknown = { value: 0 };
    let writeStarted: (() => void) | undefined;
    let finishWrite: (() => void) | undefined;
    const listeners = new Set<
      Parameters<NonNullable<NusmAdapter["subscribe"]>>[0]
    >();
    const adapter: NusmAdapter = {
      getItem: async () => persisted,
      name: "clear-racy-memory",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => {
        writeStarted?.();
        return new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const store = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "clear-racy",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await store.ready;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });

    store.setState({ value: 1 });
    await started;
    for (const listener of listeners) listener({ type: "clear" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state).toEqual({ value: 1 });

    finishWrite?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 0 });
    await store.dispose();
  });

  test("correlates cloned adapter echoes without hiding differing values", async () => {
    const { adapter, store, emit } = createMemoryAdapter({
      pacer: false,
      withSubscribe: true,
    });
    const storeId = "cloned-echo";
    const key = resolveKey({ kind: "entire", storeId });
    const nusm = createNusmStore(
      { nested: { enabled: false }, value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId,
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await nusm.ready;
    let transitions = 0;
    const unsubscribe = nusm.subscribe(() => {
      transitions += 1;
    });

    nusm.setState({ nested: { enabled: true }, value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const written = store.get(key);
    store.set(key, structuredClone(written));
    emit({ key, type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ nested: { enabled: true }, value: 1 });
    expect(transitions).toBe(1);

    store.set(key, { nested: { enabled: true }, value: 2 });
    emit({ key, type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nusm.state).toEqual({ nested: { enabled: true }, value: 2 });
    expect(transitions).toBe(2);
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await nusm.dispose();
  });

  test("drops an adapter read that finishes after a newer local generation", async () => {
    let readCount = 0;
    let resolveDelayedRead: ((value: unknown) => void) | undefined;
    const listeners = new Set<
      Parameters<NonNullable<NusmAdapter["subscribe"]>>[0]
    >();
    const adapter: NusmAdapter = {
      getItem: () => {
        readCount += 1;
        if (readCount === 1) return { value: 0 };
        return new Promise((resolve) => {
          resolveDelayedRead = resolve;
        });
      },
      name: "generation-memory",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const store = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "generation",
        sync: {
          validator: (candidate) =>
            typeof candidate === "object" && candidate !== null,
        },
      },
    );
    await store.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    let transitions = 0;
    const unsubscribe = store.subscribe(() => {
      transitions += 1;
    });
    for (const listener of listeners)
      listener({ key: "nusm:generation:entire", type: "set" });
    await Promise.resolve();
    store.setState({ value: 2 });
    resolveDelayedRead?.({ value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.state).toEqual({ value: 2 });
    expect(transitions).toBe(1);
    if (typeof unsubscribe === "function") unsubscribe();
    else unsubscribe.unsubscribe();
    await store.dispose();
  });

  test("default resolveKey when adapter does not supply one", async () => {
    const { adapter, setItemCalls } = createMemoryAdapter({
      withResolveKey: false,
    });
    const nusm = createNusmStore(
      { value: 0 },
      {
        adapter,
        persist: { strategy: "entire" },
        storeId: "default-key",
      },
    );

    await nusm.ready;
    nusm.setState({ value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedKey = resolveKey({ kind: "entire", storeId: "default-key" });
    expect(setItemCalls.some((call) => call.key === expectedKey)).toBe(true);
  });
});

describe("nusm devtools snapshots", () => {
  const captureSnapshots = async (
    action: () => Promise<void>,
  ): Promise<Array<{ persisted?: unknown }>> => {
    const target = new EventTarget();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;

    const snapshots: Array<{ persisted?: unknown }> = [];
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail as {
        type: string;
        payload?: { persisted?: unknown };
      };
      if (detail.type === "nusm:snapshot" && detail.payload) {
        snapshots.push(detail.payload);
      }
    });

    await action();
    target.dispatchEvent(new CustomEvent("tanstack-connect-success"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    return snapshots;
  };

  test("uses a round-trippable persisted value when getAllKeys is available", async () => {
    const { adapter, store } = createMemoryAdapter();
    const storeId = "snapshot-keys";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 3 });

    const snapshots = await captureSnapshots(async () => {
      const nusm = createNusmStore(
        { value: 0 },
        {
          adapter,
          devtools: true,
          persist: { strategy: "entire" },
          storeId,
        },
      );
      await nusm.ready;
    });

    expect(
      snapshots.some(
        (shot) => (shot.persisted as { value?: number })?.value === 3,
      ),
    ).toBe(true);
  });

  test("uses fallback persisted value for entire strategy", async () => {
    const { adapter, store } = createMemoryAdapter({ withGetAllKeys: false });
    const storeId = "snapshot-fallback";
    const key = resolveKey({ kind: "entire", storeId });
    store.set(key, { value: 4 });

    const snapshots = await captureSnapshots(async () => {
      const nusm = createNusmStore(
        { value: 0 },
        {
          adapter,
          devtools: true,
          persist: { strategy: "entire" },
          storeId,
        },
      );

      await nusm.ready;
    });

    expect(
      snapshots.some(
        (shot) => (shot.persisted as { value?: number })?.value === 4,
      ),
    ).toBe(true);
  });

  test("uses fallback persisted values for slices", async () => {
    type State = { prefs: { theme: string } };
    const { adapter, store } = createMemoryAdapter({
      withGetAllKeys: false,
      withResolveKey: false,
    });
    const storeId = "snapshot-slices";
    const key = resolveKey({ kind: "slice", sliceKey: "prefs", storeId });
    store.set(key, { theme: "dark" });

    const snapshots = await captureSnapshots(async () => {
      const nusm = createNusmStore<State>(
        { prefs: { theme: "light" } },
        {
          adapter,
          devtools: true,
          persist: {
            slices: [
              {
                apply: (state, sliceValue) => ({
                  ...state,
                  prefs: sliceValue as State["prefs"],
                }),
                key: "prefs",
                select: (state) => state.prefs,
              },
            ],
            strategy: "slices",
          },
          storeId,
        },
      );

      await nusm.ready;
    });

    expect(
      snapshots.some(
        (shot) =>
          (shot.persisted as { prefs?: { theme: string } })?.prefs?.theme ===
          "dark",
      ),
    ).toBe(true);
  });
});

describe("nusm hydration errors", () => {
  test("ready rejects when applyState throws", async () => {
    const storeId = "hydrate-reject";
    const key = resolveKey({ kind: "entire", storeId });
    const { adapter, store } = createMemoryAdapter({ delayGetMs: 10 });
    store.set(key, { value: 2 });
    const errors: unknown[] = [];

    const nusm = createNusmStore(
      { value: 1 },
      {
        adapter,
        onError: (err) => errors.push(err),
        persist: { strategy: "entire" },
        storeId,
      },
    );

    nusm.setState = (() => {
      throw new Error("applyState failed");
    }) as typeof nusm.setState;

    await expect(nusm.ready).rejects.toThrow("applyState failed");
    expect(errors.length).toBe(1);
  });
});
