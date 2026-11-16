import { describe, expect, spyOn, test } from "bun:test";
import type {
  AdapterEvent,
  CreateNusmStoreOptions,
  HydrateConfig,
  NusmAdapter,
  NusmDevtoolsSnapshot,
  NusmEvent,
  NusmStore,
  NusmSyncValidator,
  PersistSlice,
} from "../src";
import { createNusmStore } from "../src";
import type { NusmDevtoolsCommandResult } from "../src/devtools/types";

type State = { a: number; b: number };
const initialState: State = { a: 1, b: 2 };
const storeId = "persistence-coverage";
const keyFor = (slice: keyof State) => `nusm:${storeId}:slice:${slice}`;
const slices: Array<PersistSlice<State>> = (["a", "b"] as const).map((key) => ({
  apply: (state, value) => ({ ...state, [key]: value }),
  key,
  select: (state) => state[key],
}));

const memoryAdapter = (overrides?: Partial<NusmAdapter>): NusmAdapter => ({
  getItem: () => ({ ...initialState }),
  name: "memory",
  pacer: false,
  removeItem: () => undefined,
  setItem: () => undefined,
  ...overrides,
});

const withDevtools = async (
  options: CreateNusmStoreOptions<State>,
  run: (context: {
    store: NusmStore<State>;
    events: NusmEvent[];
    snapshots: NusmDevtoolsSnapshot[];
    command: (
      payload: Record<string, unknown>,
    ) => Promise<NusmDevtoolsCommandResult>;
  }) => Promise<void>,
) => {
  const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
  const target = new EventTarget();
  const clock = spyOn(Date, "now").mockReturnValue(20_000);
  const events: NusmEvent[] = [];
  const snapshots: NusmDevtoolsSnapshot[] = [];
  const dispatch = (type: string, payload: unknown) =>
    target.dispatchEvent(new CustomEvent(type, { detail: { payload } }));
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const { type, payload } = (
      event as CustomEvent<{ type: string; payload: unknown }>
    ).detail;
    dispatch(type, payload);
  });
  target.addEventListener("nusm:event", (event) => {
    events.push((event as CustomEvent<{ payload: NusmEvent }>).detail.payload);
  });
  target.addEventListener("nusm:snapshot", (event) => {
    snapshots.push(
      (event as CustomEvent<{ payload: NusmDevtoolsSnapshot }>).detail.payload,
    );
  });
  globalThis.__TANSTACK_EVENT_TARGET__ = target;
  let store: NusmStore<State> | undefined;
  try {
    const created = createNusmStore(initialState, {
      ...options,
      devtools: true,
      storeId,
    });
    store = created;
    await run({
      store: created,
      events,
      snapshots,
      command: (payload) =>
        new Promise((resolve) => {
          target.addEventListener(
            "nusm:commandResult",
            (event) =>
              resolve(
                (event as CustomEvent<{ payload: NusmDevtoolsCommandResult }>)
                  .detail.payload,
              ),
            { once: true },
          );
          dispatch("nusm:command", {
            commandId: "command",
            instanceId: created.devtoolsInstanceId,
            storeId,
            ...payload,
          });
        }),
    });
  } finally {
    try {
      await store?.dispose();
    } finally {
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
      clock.mockRestore();
    }
  }
};

describe("persistence hydration events", () => {
  test.each(["entire", "slices"] as const)(
    "reports explicitly discarded %s hydration",
    async (strategy) => {
      await withDevtools(
        {
          adapter: memoryAdapter(),
          persist: { strategy, slices, hydrate: { discardPersisted: true } },
        },
        async ({ events, store }) => {
          await store.ready;
          expect(events.map(({ type }) => type)).toEqual([
            "hydrate_start",
            "hydrate_discarded",
            "hydrate_applied",
          ]);
          expect(store.state).toEqual(initialState);
          expect(store.hydration.overall).toBe("discarded");
        },
      );
    },
  );

  test.each(["entire", "slices"] as const)(
    "reports rejected %s persisted values",
    async (strategy) => {
      const hydrate: HydrateConfig<State> = { validate: () => false };
      await withDevtools(
        {
          adapter: memoryAdapter(),
          persist: { strategy, slices, hydrate },
        },
        async ({ events, store }) => {
          await store.ready;
          const discarded = events.filter(
            ({ type }) => type === "hydrate_discarded",
          );
          expect(discarded.map(({ sliceKey }) => sliceKey)).toEqual(
            strategy === "entire" ? [undefined] : ["a", "b"],
          );
          expect(store.hydration.overall).toBe("discarded");
          expect(store.state).toEqual(initialState);
        },
      );
    },
  );

  test("reports entire state read errors", async () => {
    const error = new Error("entire read failed");
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: () => Promise.reject(error),
        }),
      },
      async ({ events, store }) => {
        await store.ready;
        expect(store.hydration.overall).toBe("error");
        expect(events).toContainEqual(
          expect.objectContaining({ type: "hydrate_error", detail: error }),
        );
      },
    );
  });

  test("reports failed slice reads and baseline writes with their keys", async () => {
    const readError = new Error("slice read failed");
    const writeError = new Error("slice baseline write failed");
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: (key) =>
            key === keyFor("a") ? Promise.reject(readError) : null,
          setItem: () => Promise.reject(writeError),
        }),
        persist: { strategy: "slices", slices },
      },
      async ({ events, store }) => {
        await store.ready;
        expect(store.hydration.byKey).toEqual({ a: "error", b: "error" });
        expect(
          events
            .filter(({ type }) => type === "hydrate_error")
            .map(({ sliceKey, detail }) => [sliceKey, detail]),
        ).toEqual([
          ["a", readError],
          ["b", writeError],
        ]);
      },
    );
  });

  test("reports an isolation failure that prevents slice hydration", async () => {
    const overlapping: PersistSlice<State> = {
      ...slices[1]!,
      apply: (state, value) => ({ ...state, a: 42, b: value as number }),
    };
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: (key) => (key === keyFor("a") ? 1 : null),
        }),
        persist: { strategy: "slices", slices: [slices[0]!, overlapping] },
      },
      async ({ events, store }) => {
        await expect(store.ready).rejects.toThrow(
          'Persist slice "a" is not isolated',
        );
        expect(store.hydration.overall).toBe("error");
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "hydrate_error",
            detail: expect.objectContaining({
              message: expect.stringContaining(
                'Persist slice "a" is not isolated',
              ),
            }),
          }),
        );
      },
    );
  });
});

describe("persistence commands", () => {
  test("reports snapshot failure after a successful memory edit", async () => {
    let failReads = false;
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: () => {
            if (failReads) throw new Error("snapshot unavailable");
            return initialState;
          },
        }),
      },
      async ({ command, store }) => {
        await store.ready;
        failReads = true;
        const result = await command({
          action: "replace_memory",
          value: { a: 3, b: 4 },
        });
        expect(result).toMatchObject({
          status: "success_with_warning",
          error: "snapshot unavailable",
        });
        expect(store.state).toEqual({ a: 3, b: 4 });
      },
    );
  });

  test("reports persisted slice divergence after an edit", async () => {
    const values = new Map<string, unknown>([
      [keyFor("a"), 1],
      [keyFor("b"), 2],
    ]);
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: (key) => values.get(key),
          setItem: (key, value) => {
            values.set(key, value);
          },
        }),
        persist: { strategy: "slices", slices },
      },
      async ({ command, snapshots, store }) => {
        await store.ready;
        const result = await command({
          action: "set_path",
          location: "persisted",
          path: ["a"],
          value: 3,
        });
        expect(result.status).toBe("success");
        expect(snapshots.at(-1)?.synchronization).toBe("diverged");
        expect(store.state).toEqual(initialState);
      },
    );
  });

  test.each([false, true])(
    "reports a failed slice write (rollback failed: %s)",
    async (failRollback) => {
      const errors: unknown[] = [];
      const writeError = new Error("second write failed");
      const rollbackError = new Error("first rollback failed");
      let firstSliceValue = 1;
      await withDevtools(
        {
          adapter: memoryAdapter({
            getItem: (key) => (key === keyFor("a") ? firstSliceValue : 2),
            setItem: (key, value) => {
              if (key === keyFor("b")) throw writeError;
              if (failRollback && value === 1) throw rollbackError;
              firstSliceValue = value as number;
            },
          }),
          onError: (error) => errors.push(error),
          persist: { strategy: "slices", slices },
        },
        async ({ command, store }) => {
          await store.ready;
          const result = await command({
            action: "replace_persisted",
            value: { a: 3, b: 4 },
          });
          const expectedError = failRollback
            ? "Slice write failed and rollback was incomplete."
            : "second write failed";
          expect(result).toMatchObject({
            status: "error",
            error: expectedError,
          });
          const reportedError = failRollback
            ? expect.objectContaining({ errors: [writeError, rollbackError] })
            : writeError;
          expect(errors).toEqual([reportedError]);
          expect(firstSliceValue).toBe(failRollback ? 3 : 1);
        },
      );
    },
  );

  test("rejects nested removal from a missing persisted slice", async () => {
    let missing = false;
    await withDevtools(
      {
        adapter: memoryAdapter({
          getItem: (key) => {
            if (key === keyFor("b")) return 2;
            return missing ? null : 1;
          },
        }),
        persist: { strategy: "slices", slices },
      },
      async ({ command, store }) => {
        await store.ready;
        missing = true;
        const result = await command({
          action: "remove_path",
          location: "persisted",
          path: ["a", "child"],
        });
        expect(result).toMatchObject({
          status: "error",
          error: "Cannot remove a path from a missing persisted slice.",
        });
      },
    );
  });

  test("rejects empty command IDs and invalid path locations", async () => {
    await withDevtools({}, async ({ command, store }) => {
      await store.ready;
      expect(
        await command({ action: "reset_memory", commandId: "" }),
      ).toMatchObject({
        status: "error",
        error: "Devtools commandId must be a non-empty string.",
      });
      expect(
        await command({
          action: "set_path",
          location: "unknown",
          path: ["a"],
          value: 3,
        }),
      ).toMatchObject({
        status: "error",
        error: "Devtools command location must be memory or persisted.",
      });
      expect(store.state).toEqual(initialState);
    });
  });
});

describe("adapter updates", () => {
  test("rejects malformed validation results and accepts the original candidate", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(20_000);
    const failure = Promise.withResolvers<unknown>();
    const applied = Promise.withResolvers<State>();
    let notify: ((event: AdapterEvent) => void) | undefined;
    const key = `nusm:${storeId}:entire`;
    let value = initialState;
    let validatorResult: unknown = { ok: "invalid" };
    const store = createNusmStore(initialState, {
      adapter: memoryAdapter({
        getItem: () => value,
        subscribe: (listener) => {
          notify = listener;
          return () => {
            notify = undefined;
          };
        },
      }),
      onError: failure.resolve,
      storeId,
      sync: { validator: (() => validatorResult) as NusmSyncValidator<State> },
    });
    try {
      await store.ready;
      value = { a: 3, b: 4 };
      notify?.({ key, type: "set" });
      expect(await failure.promise).toEqual(
        new Error("Synchronization validator rejected adapter state."),
      );
      expect(store.state).toEqual(initialState);

      const subscription = store.subscribe(() => applied.resolve(store.state));
      try {
        validatorResult = { ok: true };
        notify?.({ key, type: "set" });
        expect(await applied.promise).toEqual({ a: 3, b: 4 });
      } finally {
        subscription.unsubscribe();
      }
    } finally {
      try {
        await store.dispose();
      } finally {
        clock.mockRestore();
      }
    }
  });

  test("skips an outdated slice when a prior adapter write updates it", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(20_000);
    const allowFirstWrite = Promise.withResolvers<void>();
    const lastWrite = Promise.withResolvers<void>();
    const writes: Array<[string, unknown]> = [];
    const store = createNusmStore(initialState, {
      adapter: memoryAdapter({
        getItem: (key) => (key === keyFor("a") ? 1 : 2),
        setItem: (key, value) => {
          writes.push([key, value]);
          if (key === keyFor("a") && value === 3)
            return allowFirstWrite.promise;
          if (key === keyFor("a") && value === 4)
            store.setState(() => ({ a: 4, b: 6 }));
          if (key === keyFor("b") && value === 6) lastWrite.resolve();
        },
      }),
      persist: { strategy: "slices", slices },
      storeId,
    });
    try {
      await store.ready;
      store.setState(() => ({ a: 3, b: 2 }));
      store.setState(() => ({ a: 4, b: 5 }));
      allowFirstWrite.resolve();
      await lastWrite.promise;
      expect(writes).toEqual([
        [keyFor("a"), 3],
        [keyFor("a"), 4],
        [keyFor("b"), 6],
      ]);
    } finally {
      allowFirstWrite.resolve();
      try {
        await store.dispose();
      } finally {
        clock.mockRestore();
      }
    }
  });
});
