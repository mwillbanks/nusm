import { expect, jest, test } from "bun:test";
import {
  createNusmStore,
  type AdapterEvent,
  type CreateNusmStoreOptions,
} from "../src/index.js";
import { createMemoryAdapter } from "./helpers/memory-adapter.js";

type State = { value: number };

function createFixture(
  strategy: "entire" | "slices",
  validator: NonNullable<
    Exclude<
      CreateNusmStoreOptions<State>["sync"],
      undefined | false
    >["validator"]
  >,
) {
  const memory = createMemoryAdapter({ pacer: false, withSubscribe: true });
  const storeId = `ordering-${strategy}`;
  const key =
    strategy === "entire"
      ? `nusm:${storeId}:entire`
      : `nusm:${storeId}:slice:value`;
  memory.store.set(key, strategy === "entire" ? { value: 5 } : 5);
  const store = createNusmStore<State>(
    { value: 0 },
    {
      adapter: memory.adapter,
      persist: {
        strategy,
        ...(strategy === "slices"
          ? {
              slices: [
                {
                  apply: (state: State, value: unknown) => ({
                    ...state,
                    value: value as number,
                  }),
                  key: "value",
                  select: (state: State) => state.value,
                },
              ],
            }
          : {}),
      },
      storeId,
      sync: { validator },
    },
  );
  return { ...memory, key, nusm: store };
}

test.each<["entire" | "slices", "set" | "remove"]>([
  ["slices", "set"],
  ["entire", "remove"],
])("drops a queued %s %s event after a local write", async (strategy, type) => {
  const validating = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<boolean>();
  const drained = Promise.withResolvers<void>();
  let validations = 0;
  const { emit, key, nusm } = createFixture(strategy, () => {
    if (++validations === 1) {
      validating.resolve();
      return resume.promise;
    }
    drained.resolve();
    return false;
  });

  try {
    await nusm.ready;
    emit({ type: "clear" });
    await validating.promise;
    emit({ key, type });
    nusm.setState(() => ({ value: 7 }));
    resume.resolve(true);
    emit({ type: "clear" });
    await drained.promise;
    expect(validations).toBe(2);
    expect(nusm.state).toEqual({ value: 7 });
  } finally {
    resume.resolve(false);
    await nusm.dispose();
  }
});

test.each(["entire", "slices"] as const)(
  "drops an external %s read superseded by a local write",
  async (strategy) => {
    const reading = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<unknown>();
    const drained = Promise.withResolvers<void>();
    const { adapter, emit, key, nusm } = createFixture(strategy, () => {
      drained.resolve();
      return false;
    });

    try {
      await nusm.ready;
      adapter.getItem = () => {
        reading.resolve();
        return resume.promise;
      };
      emit({ key, type: "set" });
      await reading.promise;
      nusm.setState(() => ({ value: 7 }));
      resume.resolve(strategy === "entire" ? { value: 6 } : 6);
      emit({ type: "clear" });
      await drained.promise;
      expect(nusm.state).toEqual({ value: 7 });
    } finally {
      resume.resolve(null);
      await nusm.dispose();
    }
  },
);

test("applies a keyless clear received during hydration", async () => {
  const read = Promise.withResolvers<unknown>();
  const cleared = Promise.withResolvers<void>();
  let listener: ((event: AdapterEvent) => void) | undefined;
  const store = createNusmStore(
    { value: 0 },
    {
      adapter: {
        getItem: () => read.promise,
        name: "memory",
        pacer: false,
        removeItem: () => {},
        setItem: () => {},
        subscribe: (callback) => {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
      },
      storeId: "ordering-hydration-clear",
      sync: { validator: () => true },
    },
  );
  const subscription = store.subscribe((state) => {
    if (state?.value === 0) cleared.resolve();
  });

  try {
    expect(listener).toBeDefined();
    listener?.({ type: "clear" });
    read.resolve({ value: 5 });
    await store.ready;
    await cleared.promise;
    expect(store.state).toEqual({ value: 0 });
  } finally {
    read.resolve(null);
    subscription.unsubscribe();
    await store.dispose();
  }
});

test.serial(
  "replays each deferred slice event when its own write finishes",
  async () => {
    jest.useFakeTimers({ now: 1_000 });
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const firstWrite = Promise.withResolvers<void>();
    const secondWrite = Promise.withResolvers<void>();
    const deferred = Promise.withResolvers<void>();
    const firstApplied = Promise.withResolvers<void>();
    const secondApplied = Promise.withResolvers<void>();
    const {
      adapter,
      emit,
      store: persisted,
    } = createMemoryAdapter({
      pacer: { wait: 50 },
      withSubscribe: true,
    });
    const storeId = "ordering-overlapping-writes";
    const fields = ["first", "second", "sentinel"] as const;
    const key = (field: (typeof fields)[number]) =>
      `nusm:${storeId}:slice:${field}`;
    for (const field of fields) persisted.set(key(field), 0);
    const store = createNusmStore(
      { first: 0, second: 0, sentinel: 0 },
      {
        adapter,
        persist: {
          strategy: "slices",
          slices: fields.map((field) => ({
            apply: (state, value) => ({ ...state, [field]: value }),
            key: field,
            select: (state) => state[field],
          })),
        },
        storeId,
        sync: { validator: () => true },
      },
    );
    const subscription = store.subscribe((state) => {
      if (state?.first === 11) firstApplied.resolve();
      if (state?.second === 22) secondApplied.resolve();
    });

    try {
      await store.ready;
      adapter.setItem = (name) => {
        if (name === key("first")) {
          firstStarted.resolve();
          return firstWrite.promise;
        }
        secondStarted.resolve();
        return secondWrite.promise;
      };
      adapter.getItem = (name) => {
        if (name === key("sentinel")) deferred.resolve();
        return persisted.get(name) ?? null;
      };
      store.setState((state) => ({ ...state, first: 1, second: 2 }));
      jest.advanceTimersByTime(50);
      await Promise.all([firstStarted.promise, secondStarted.promise]);
      persisted.set(key("first"), 11);
      persisted.set(key("second"), 22);
      for (const field of fields) emit({ key: key(field), type: "set" });
      await deferred.promise;

      firstWrite.resolve();
      await firstApplied.promise;
      expect(store.state).toEqual({ first: 11, second: 2, sentinel: 0 });
      secondWrite.resolve();
      await secondApplied.promise;
      expect(store.state).toEqual({ first: 11, second: 22, sentinel: 0 });
    } finally {
      try {
        firstWrite.resolve();
        secondWrite.resolve();
        subscription.unsubscribe();
        await store.dispose();
        jest.advanceTimersByTime(0);
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    }
  },
);
