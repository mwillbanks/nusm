import { describe, expect, test } from "bun:test";
import {
  createNusmStore,
  type NusmAdapter,
  type NusmSyncSource,
} from "../../src/index.js";
import { runLifecycleCleanup } from "../../src/store/lifecycle.js";

const validator = () => true;
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

describe("store lifecycle", () => {
  test("dispose before hydration rejects ready promptly and cancels hydration", async () => {
    let resolveRead!: (value: unknown) => void;
    const target = relay();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const events: unknown[] = [];
    target.addEventListener("nusm:event", (event) =>
      events.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: () => new Promise((resolve) => (resolveRead = resolve)),
      name: "never-ready",
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    try {
      const store = createNusmStore(
        { value: 1 },
        { adapter, devtools: true, storeId: "cancel", sync: { validator } },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ready = store.ready;
      const disposal = store.dispose();
      expect(disposal).toBe(store.dispose());
      await expect(ready).rejects.toMatchObject({ name: "AbortError" });
      await disposal;
      expect(store.hydration.overall).toBe("cancelled");
      resolveRead({ value: 9 });
      await Promise.resolve();
      await Promise.resolve();
      expect(store.state).toBeUndefined();
      expect(store.isReady).toBe(false);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "hydrate_applied" }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "devtools_snapshot" }),
      );
    } finally {
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    }
  });

  test("dispose never waits for a never-resolving adapter", async () => {
    const adapter: NusmAdapter = {
      getItem: () => new Promise(() => undefined),
      name: "never",
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    const store = createNusmStore(
      { value: 1 },
      { adapter, storeId: "never", sync: { validator } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    void store.ready.catch(() => undefined);
    await expect(store.dispose()).resolves.toBeUndefined();
  });

  test("normal disposal preserves completed hydration status and identity", async () => {
    const store = createNusmStore({ value: 1 });
    await store.ready;
    expect(store.hydration.overall).toBe("not_configured");
    const first = store.dispose();
    const second = store.dispose();
    expect(first).toBe(second);
    await first;
    expect(store.hydration.overall).toBe("not_configured");
  });

  test("pending adapter events are discarded during disposal", async () => {
    let resolveRead!: (value: unknown) => void;
    let emit!: (event: { type: "set"; key: string }) => void;
    const adapter: NusmAdapter = {
      getItem: () => new Promise((resolve) => (resolveRead = resolve)),
      name: "events",
      removeItem: () => undefined,
      setItem: () => undefined,
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
    };
    const store = createNusmStore(
      { value: 1 },
      { adapter, storeId: "events", sync: { validator } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit({ key: "nusm:events:entire", type: "set" });
    const ready = store.ready.catch(() => undefined);
    await store.dispose();
    resolveRead({ value: 4 });
    await ready;
    expect(store.state).toBeUndefined();
  });

  test("setState immediately after disposal schedules no persistence", async () => {
    let writes = 0;
    const adapter: NusmAdapter = {
      getItem: async () => ({ value: 1 }),
      name: "writes",
      pacer: { wait: 1000 },
      removeItem: () => undefined,
      setItem: async () => {
        writes += 1;
      },
    };
    const store = createNusmStore({ value: 1 }, { adapter, storeId: "writes" });
    await store.ready;
    await store.dispose();
    store.setState({ value: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toBe(0);
  });

  test("pending synchronization events are discarded during disposal", async () => {
    let publishEvent!: (event: any) => void;
    const source: NusmSyncSource = {
      publish: () => undefined,
      start: (listener) => {
        publishEvent = listener;
        return undefined;
      },
    };
    const store = createNusmStore(
      { value: 1 },
      { storeId: "pending-sync", sync: { source, validator } },
    );
    await Promise.resolve();
    publishEvent({
      eventId: "pending",
      kind: "update",
      sourceId: "peer",
      state: { value: 9 },
      storeId: "pending-sync",
    });
    void store.ready.catch(() => undefined);
    await store.dispose();
    await Promise.resolve();
    expect(store.state).toEqual({ value: 1 });
  });

  test("never-resolving source start does not block disposal and late cleanup runs", async () => {
    let resolveStart!: (cleanup: () => void) => void;
    let cleaned = 0;
    let secondStarted = 0;
    const source: NusmSyncSource = {
      publish: () => undefined,
      start: () =>
        new Promise((resolve) => {
          resolveStart = () =>
            resolve(() => {
              cleaned += 1;
            });
        }),
    };
    const secondSource: NusmSyncSource = {
      publish: () => undefined,
      start: () => {
        secondStarted += 1;
      },
    };
    const store = createNusmStore(
      { value: 1 },
      {
        storeId: "late-source",
        sync: { sources: [source, secondSource], validator },
      },
    );
    void store.ready.catch(() => undefined);
    await Promise.resolve();
    await expect(store.dispose()).resolves.toBeUndefined();
    resolveStart(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleaned).toBe(1);
    expect(secondStarted).toBe(0);
  });

  test("lifecycle cleanup isolates pacer, subscription, source, and flush failures", async () => {
    const reported: string[] = [];
    const failures = await runLifecycleCleanup(
      [
        () => {
          throw new Error("pacer-cancel");
        },
        () => {
          throw new Error("unsubscribe");
        },
        () => {
          throw new Error("source-dispose");
        },
      ],
      () => {
        throw new Error("flush");
      },
      (error) => reported.push((error as Error).message),
    );
    expect(failures.map((error) => (error as Error).message)).toEqual([
      "pacer-cancel",
      "flush",
      "unsubscribe",
      "flush",
      "source-dispose",
      "flush",
    ]);
    expect(reported).toEqual(failures.map((error) => (error as Error).message));
  });

  test("late async adapter validation cannot mutate state, status, or persistence", async () => {
    let emit!: (event: { type: "set"; key: string }) => void;
    let resolveValidation!: (result: boolean) => void;
    let writes = 0;
    const adapter: NusmAdapter = {
      getItem: async () => ({ value: 1 }),
      name: "late-validation",
      removeItem: () => undefined,
      setItem: async () => {
        writes += 1;
      },
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
    };
    const store = createNusmStore(
      { value: 1 },
      {
        adapter,
        storeId: "late-validation",
        sync: {
          validator: () =>
            new Promise<boolean>((resolve) => {
              resolveValidation = resolve;
            }),
        },
      },
    );
    await store.ready;
    emit({ key: "nusm:late-validation:entire", type: "set" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = store.hydration;
    await store.dispose();
    resolveValidation(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.state).toEqual({ value: 1 });
    expect(store.hydration).toEqual(status);
    expect(writes).toBe(0);
  });

  test("in-flight persisted Devtools command emits no late result after disposal", async () => {
    let resolveWrite!: () => void;
    const target = relay();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: unknown[] = [];
    const events: unknown[] = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    target.addEventListener("nusm:event", (event) =>
      events.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(
      { value: 1 },
      {
        adapter: {
          getItem: async () => ({ value: 1 }),
          name: "devtools-late",
          removeItem: () => undefined,
          setItem: () =>
            new Promise<void>((resolve) => (resolveWrite = resolve)),
        },
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "devtools-late",
      },
    );
    try {
      await store.ready;
      target.dispatchEvent(
        new CustomEvent("nusm:command", {
          detail: {
            payload: {
              action: "replace_persisted",
              commandId: "late-command",
              instanceId: store.devtoolsInstanceId,
              storeId: "devtools-late",
              value: { value: 2 },
            },
          },
        }),
      );
      await tick();
      const disposal = store.dispose();
      resolveWrite();
      await disposal;
      await tick();
      await tick();
      expect(results).toEqual([]);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "devtools_command" }),
      );
    } finally {
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    }
  });

  test("attempts every cleanup and flush and aggregates failures without synchronous throws", async () => {
    const failures: string[] = [];
    const source: NusmSyncSource = {
      dispose: () => {
        failures.push("source-dispose");
        throw new Error("source-dispose");
      },
      publish: () => undefined,
      start: () => () => {
        failures.push("source-cleanup");
        throw new Error("source-cleanup");
      },
    };
    const adapter: NusmAdapter = {
      getItem: async () => ({ value: 1 }),
      name: "failing",
      pacer: { wait: 1000 },
      removeItem: () => undefined,
      setItem: async () => {
        failures.push("flush");
        throw new Error("flush");
      },
      subscribe: () => () => {
        failures.push("unsubscribe");
        throw new Error("unsubscribe");
      },
    };
    const store = createNusmStore(
      { value: 1 },
      {
        adapter,
        onError: () => {
          throw new Error("reporter");
        },
        storeId: "failures",
        sync: { source, validator },
      },
    );
    await store.ready;
    store.setState({ value: 2 });
    let disposal!: Promise<void>;
    expect(() => {
      disposal = store.dispose();
    }).not.toThrow();
    const rejection = disposal.catch((error) => error);
    const error = await rejection;
    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.map(
        (failure) => (failure as Error).message,
      ),
    ).toEqual(["flush", "unsubscribe", "source-cleanup", "source-dispose"]);
    expect(store.dispose()).toBe(disposal);
    expect(failures).toEqual(
      expect.arrayContaining([
        "source-cleanup",
        "source-dispose",
        "unsubscribe",
        "flush",
      ]),
    );
  });

  test("re-entrant disposal from the disposal event reuses one promise", async () => {
    const target = relay();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    let reentrant!: Promise<void>;
    let store!: ReturnType<typeof createNusmStore>;
    target.addEventListener("nusm:event", (event) => {
      const payload = (event as CustomEvent).detail.payload;
      if (payload.type === "synchronization_disposed")
        reentrant = store.dispose();
    });
    store = createNusmStore(
      { value: 1 },
      { devtools: true, storeId: "reentrant" },
    );
    try {
      await store.ready;
      const disposal = store.dispose();
      expect(reentrant).toBe(disposal);
      await disposal;
    } finally {
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    }
  });
});
