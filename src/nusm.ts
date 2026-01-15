import createDeepmerge from "@fastify/deepmerge";
import { AsyncDebouncer } from "@tanstack/pacer";
import { batch, Derived, Effect, Store } from "@tanstack/store";
import { createNusmDevtoolsEmitter } from "./devtools/client";
import type {
  AdapterEvent,
  CreateNusmStoreOptions,
  HydrateConfig,
  HydrationStatus,
  NusmStore,
} from "./types";

const deepMerge = createDeepmerge({
  mergeArray: () => (_target, source) => source,
}) as <TState>(target: TState, source: unknown) => TState;

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

const resolveStoreId = <TState>(
  options?: CreateNusmStoreOptions<TState>,
): string | undefined => {
  if (options?.storeId) return options.storeId;
  const devtoolsName =
    typeof options?.devtools === "object" ? options.devtools.name : undefined;
  if (devtoolsName) {
    return devtoolsName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");
  }
  return undefined;
};

const shouldDiscardPersisted = <TState>(
  hydrate?: HydrateConfig<TState>,
): boolean => {
  const discard = hydrate?.discardPersisted;
  if (typeof discard === "function") return discard();
  return Boolean(discard);
};

const resolveValidateResult = (
  validateResult: boolean | { ok: boolean; value?: unknown },
  persisted: unknown,
): { ok: boolean; value: unknown } => {
  if (typeof validateResult === "boolean") {
    return { ok: validateResult, value: persisted };
  }
  return {
    ok: validateResult.ok,
    value: validateResult.value ?? persisted,
  };
};

export { Derived, Effect, batch };

export function createNusmStore<TState>(
  initialState: TState,
  options?: CreateNusmStoreOptions<TState>,
): NusmStore<TState> {
  const adapter = options?.adapter;
  const persist = options?.persist;
  const strategy = persist?.strategy ?? "entire";
  const slices = persist?.slices ?? [];
  const hydrateConfig = persist?.hydrate;
  const onError = options?.onError;
  const storeId = resolveStoreId(options);
  const storeIdValue = storeId ?? "nusm";
  const devtoolsEmitter = createNusmDevtoolsEmitter(Boolean(options?.devtools));
  let lastFlushAt: number | undefined;

  if (adapter && !storeId) {
    throw new Error(
      "nusm requires a stable storeId or devtools name when persistence is enabled.",
    );
  }

  const store = new Store<TState>(
    adapter ? (undefined as unknown as TState) : initialState,
  ) as NusmStore<TState>;

  let readyResolve: () => void = () => undefined;
  let readyReject: (error: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let isReady = false;
  let suppressPersist = false;

  const hydrationStatus: HydrationStatus = {
    byKey: {},
    overall: adapter ? "pending" : "not_configured",
  };

  const resolveKey = (params: {
    kind: "entire" | "slice";
    sliceKey?: string;
  }): string => {
    if (!storeId) return "";
    return adapter?.resolveKey
      ? adapter.resolveKey({ storeId, ...params })
      : defaultResolveKey({ storeId, ...params });
  };

  const persistenceUnits = new Map<
    string,
    { kind: "entire" | "slice"; sliceKey?: string }
  >();
  if (adapter) {
    if (strategy === "entire") {
      const key = resolveKey({ kind: "entire" });
      persistenceUnits.set(key, { kind: "entire" });
      hydrationStatus.byKey.entire = "pending";
    } else {
      for (const slice of slices) {
        const key = resolveKey({ kind: "slice", sliceKey: slice.key });
        persistenceUnits.set(key, { kind: "slice", sliceKey: slice.key });
        hydrationStatus.byKey[slice.key] = "pending";
      }
    }
  }

  const recentWrites = new Map<string, number>();
  const recentWriteWindowMs = adapter?.name.toLowerCase().includes("index")
    ? 1000
    : 500;

  const queuedPayloads = new Map<
    string,
    {
      key: string;
      payload: unknown;
      sliceKey?: string;
      kind: "entire" | "slice";
    }
  >();

  const flushQueue = async () => {
    if (!adapter || queuedPayloads.size === 0) return;
    devtoolsEmitter?.emitEvent({
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_flush_start",
    });
    const entries = Array.from(queuedPayloads.values());
    queuedPayloads.clear();

    await Promise.all(
      entries.map(async (entry) => {
        try {
          await adapter.setItem(entry.key, entry.payload);
          recentWrites.set(entry.key, Date.now());
          devtoolsEmitter?.emitEvent({
            key: entry.key,
            sliceKey: entry.sliceKey,
            storeId: storeIdValue,
            ts: Date.now(),
            type: "persist_flush_ok",
          });
        } catch (error) {
          devtoolsEmitter?.emitEvent({
            detail: error,
            key: entry.key,
            sliceKey: entry.sliceKey,
            storeId: storeIdValue,
            ts: Date.now(),
            type: "persist_flush_error",
          });
          onError?.(error);
        }
      }),
    );
    lastFlushAt = Date.now();
    emitDevtoolsSnapshot();
  };

  const pacerConfig = adapter?.pacer;
  const pacer =
    adapter && pacerConfig !== false
      ? new AsyncDebouncer(
          async () => {
            await flushQueue();
          },
          {
            leading: pacerConfig?.leading ?? false,
            trailing: pacerConfig?.trailing ?? true,
            wait: pacerConfig?.wait ?? 0,
          },
        )
      : null;

  const scheduleFlush = () => {
    if (!adapter) return;
    if (pacerConfig === false) {
      void flushQueue();
      return;
    }
    pacer?.maybeExecute();
  };

  const enqueuePersist = (entry: {
    key: string;
    payload: unknown;
    sliceKey?: string;
    kind: "entire" | "slice";
  }) => {
    queuedPayloads.set(entry.key, entry);
    devtoolsEmitter?.emitEvent({
      key: entry.key,
      sliceKey: entry.sliceKey,
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_scheduled",
    });
    scheduleFlush();
  };

  const subscribeToStore = () => {
    store.subscribe(({ prevVal, currentVal }) => {
      if (!adapter || suppressPersist) return;

      if (strategy === "entire") {
        const key = resolveKey({ kind: "entire" });
        enqueuePersist({ key, kind: "entire", payload: currentVal });
        return;
      }

      for (const slice of slices) {
        const prevSlice = slice.select(prevVal);
        const nextSlice = slice.select(currentVal);
        if (Object.is(prevSlice, nextSlice)) continue;
        const key = resolveKey({ kind: "slice", sliceKey: slice.key });
        enqueuePersist({
          key,
          kind: "slice",
          payload: nextSlice,
          sliceKey: slice.key,
        });
      }
    });
  };

  const applyState = (nextState: TState) => {
    suppressPersist = true;
    store.setState(nextState);
    suppressPersist = false;
  };

  const hydrateEntire = async (): Promise<TState> => {
    const key = resolveKey({ kind: "entire" });
    if (!adapter) return initialState;

    if (shouldDiscardPersisted(hydrateConfig)) {
      hydrationStatus.byKey.entire = "discarded";
      devtoolsEmitter?.emitEvent({
        storeId: storeIdValue,
        ts: Date.now(),
        type: "hydrate_discarded",
      });
      return initialState;
    }

    try {
      const raw = await adapter.getItem(key);
      if (raw == null) {
        hydrationStatus.byKey.entire = "hydrated";
        return initialState;
      }
      let persistedValue: unknown = raw;

      if (hydrateConfig?.validate) {
        const result = resolveValidateResult(
          hydrateConfig.validate(persistedValue),
          persistedValue,
        );
        if (!result.ok) {
          hydrationStatus.byKey.entire = "discarded";
          devtoolsEmitter?.emitEvent({
            storeId: storeIdValue,
            ts: Date.now(),
            type: "hydrate_discarded",
          });
          return initialState;
        }
        persistedValue = result.value;
      }

      const merged = hydrateConfig?.merge
        ? hydrateConfig.merge({
            initial: initialState,
            persisted: persistedValue,
          })
        : deepMerge(initialState, persistedValue);

      hydrationStatus.byKey.entire = "hydrated";
      return merged;
    } catch (error) {
      hydrationStatus.byKey.entire = "error";
      devtoolsEmitter?.emitEvent({
        detail: error,
        storeId: storeIdValue,
        ts: Date.now(),
        type: "hydrate_error",
      });
      onError?.(error);
      return initialState;
    }
  };

  const hydrateSlices = async (): Promise<TState> => {
    let nextState = initialState;

    if (shouldDiscardPersisted(hydrateConfig)) {
      for (const slice of slices) {
        hydrationStatus.byKey[slice.key] = "discarded";
      }
      devtoolsEmitter?.emitEvent({
        storeId: storeIdValue,
        ts: Date.now(),
        type: "hydrate_discarded",
      });
      return nextState;
    }

    for (const slice of slices) {
      const key = resolveKey({ kind: "slice", sliceKey: slice.key });
      try {
        const raw = await adapter?.getItem(key);
        if (raw == null) {
          hydrationStatus.byKey[slice.key] = "hydrated";
          continue;
        }
        let persistedValue: unknown = raw;
        if (hydrateConfig?.validate) {
          const result = resolveValidateResult(
            hydrateConfig.validate(persistedValue),
            persistedValue,
          );
          if (!result.ok) {
            hydrationStatus.byKey[slice.key] = "discarded";
            devtoolsEmitter?.emitEvent({
              sliceKey: slice.key,
              storeId: storeIdValue,
              ts: Date.now(),
              type: "hydrate_discarded",
            });
            continue;
          }
          persistedValue = result.value;
        }

        nextState = slice.apply(nextState, persistedValue);
        hydrationStatus.byKey[slice.key] = "hydrated";
      } catch (error) {
        hydrationStatus.byKey[slice.key] = "error";
        devtoolsEmitter?.emitEvent({
          detail: error,
          sliceKey: slice.key,
          storeId: storeIdValue,
          ts: Date.now(),
          type: "hydrate_error",
        });
        onError?.(error);
      }
    }

    return nextState;
  };

  const finalizeHydration = () => {
    const statuses = Object.values(hydrationStatus.byKey);
    if (statuses.includes("error")) {
      hydrationStatus.overall = "error";
    } else if (statuses.includes("discarded")) {
      hydrationStatus.overall = "discarded";
    } else {
      hydrationStatus.overall = adapter ? "hydrated" : "not_configured";
    }
  };

  const hydrate = async () => {
    if (!adapter) {
      isReady = true;
      readyResolve();
      emitDevtoolsSnapshot();
      return;
    }

    devtoolsEmitter?.emitEvent({
      storeId: storeIdValue,
      ts: Date.now(),
      type: "hydrate_start",
    });

    try {
      const hydratedState =
        strategy === "entire" ? await hydrateEntire() : await hydrateSlices();
      applyState(hydratedState);
      finalizeHydration();
      devtoolsEmitter?.emitEvent({
        storeId: storeIdValue,
        ts: Date.now(),
        type: "hydrate_applied",
      });
      isReady = true;
      readyResolve();
      devtoolsEmitter?.emitHydration(storeIdValue, hydrationStatus);
      emitDevtoolsSnapshot();
    } catch (error) {
      hydrationStatus.overall = "error";
      devtoolsEmitter?.emitEvent({
        detail: error,
        storeId: storeIdValue,
        ts: Date.now(),
        type: "hydrate_error",
      });
      onError?.(error);
      readyReject(error);
    }
  };

  const handleAdapterEvent = async (event: AdapterEvent) => {
    if (!adapter) return;

    if (event.type !== "clear" && event.key) {
      const lastWrite = recentWrites.get(event.key);
      if (lastWrite && Date.now() - lastWrite < recentWriteWindowMs) {
        return;
      }
    }

    const applyExternalState = (nextState: TState) => {
      suppressPersist = true;
      store.setState(nextState);
      suppressPersist = false;
      devtoolsEmitter?.emitEvent({
        key: event.key,
        storeId: storeIdValue,
        ts: Date.now(),
        type: "adapter_external_event",
      });
      emitDevtoolsSnapshot();
    };

    if (event.type === "clear") {
      if (strategy === "entire") {
        applyExternalState(initialState);
        return;
      }

      let nextState = initialState;
      for (const slice of slices) {
        nextState = slice.apply(nextState, slice.select(initialState));
      }
      applyExternalState(nextState);
      return;
    }

    if (!event.key) return;
    const unit = persistenceUnits.get(event.key);
    if (!unit) return;

    if (event.type === "remove") {
      if (unit.kind === "entire") {
        applyExternalState(initialState);
      } else {
        const slice = slices.find(
          (candidate) => candidate.key === unit.sliceKey,
        );
        if (slice) {
          const resetValue = slice.select(initialState);
          applyExternalState(slice.apply(store.state, resetValue));
        }
      }
      return;
    }

    if (unit.kind === "entire") {
      const raw = await adapter.getItem(event.key);
      if (raw == null) return;
      const merged = hydrateConfig?.merge
        ? hydrateConfig.merge({
            initial: initialState,
            persisted: raw,
          })
        : deepMerge(initialState, raw);
      applyExternalState(merged);
    } else {
      const slice = slices.find((candidate) => candidate.key === unit.sliceKey);
      if (!slice) return;
      const raw = await adapter.getItem(event.key);
      if (raw == null) return;
      applyExternalState(slice.apply(store.state, raw));
    }
  };

  const pendingAdapterEvents: AdapterEvent[] = [];
  if (adapter?.subscribe) {
    adapter.subscribe((event) => {
      if (!isReady) {
        pendingAdapterEvents.push(event);
        return;
      }
      void handleAdapterEvent(event);
    });
  }

  const readPersistedSnapshot = async (): Promise<unknown> => {
    if (!adapter || !storeId) return undefined;
    if (adapter.getAllKeys) {
      const keys = await adapter.getAllKeys();
      const prefix = `nusm:${storeId}:`;
      const relevant = keys.filter((key) => key.startsWith(prefix));
      const results: Record<string, unknown> = {};
      for (const key of relevant) {
        const raw = await adapter.getItem(key);
        if (raw == null) continue;
        results[key] = raw;
      }
      return results;
    }

    if (strategy === "entire") {
      const key = resolveKey({ kind: "entire" });
      const raw = await adapter.getItem(key);
      if (raw == null) return undefined;
      return raw;
    }

    const result: Record<string, unknown> = {};
    for (const slice of slices) {
      const key = resolveKey({ kind: "slice", sliceKey: slice.key });
      const raw = await adapter.getItem(key);
      if (raw == null) continue;
      result[slice.key] = raw;
    }
    return result;
  };

  const emitDevtoolsSnapshot = () => {
    if (!devtoolsEmitter) return;
    void (async () => {
      const persisted = await readPersistedSnapshot();
      devtoolsEmitter.emitSnapshot({
        hydration: hydrationStatus,
        isReady,
        lastFlushAt,
        memory: store.state,
        pendingKeys: Array.from(queuedPayloads.keys()),
        persisted,
        storeId: storeIdValue,
      });
    })();
  };

  subscribeToStore();
  void hydrate().then(async () => {
    if (pendingAdapterEvents.length > 0) {
      for (const event of pendingAdapterEvents.splice(0)) {
        await handleAdapterEvent(event);
      }
    }
  });

  // extend store with our ready promise
  store.ready = ready;

  return store;
}
