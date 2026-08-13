import createDeepmerge from "@fastify/deepmerge";
import { AsyncDebouncer } from "@tanstack/pacer";
import { batch, Store } from "@tanstack/store";
import { deepEqual } from "fast-equals";

import { createNusmDevtoolsEmitter } from "./devtools/client.js";
import { removeValueAtPath, setValueAtPath } from "./devtools/path.js";

import { isRoundTrippableForDevtools } from "./devtools/serialize.js";

import type {
  NusmDevtoolsCommand,
  NusmDevtoolsPath,
} from "./devtools/types.js";
import type {
  AdapterEvent,
  CreateNusmStoreOptions,
  HydrateConfig,
  HydrationStatus,
  NusmDevtoolsSnapshot,
  NusmStore,
} from "./types.js";

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

const createDataRecord = <T>(): Record<string, T> => Object.create(null);
const defineRecordValue = <T>(
  record: Record<string, T>,
  key: string,
  value: T,
) => {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

const devtoolsStoreSequenceKey = Symbol.for("nusm.devtools.store-sequence");
const nextDevtoolsInstanceId = () => {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  const current = registry[devtoolsStoreSequenceKey];
  const sequence =
    (typeof current === "bigint" && current >= 0n ? current : 0n) + 1n;
  registry[devtoolsStoreSequenceKey] = sequence;
  return `nusm-instance-${sequence}`;
};

const resolveStoreId = <TState>(
  options?: CreateNusmStoreOptions<TState>,
): string | undefined => {
  if (options?.storeId) return options.storeId;
  const devtoolsName =
    typeof options?.devtools === "object" ? options.devtools.name : undefined;
  if (devtoolsName) {
    const normalized = devtoolsName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");
    return normalized || undefined;
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

const resolveCommandStatus = (
  action: NusmDevtoolsCommand["action"],
  snapshotError: string | undefined,
): "error" | "success" | "success_with_warning" => {
  if (!snapshotError) return "success";
  if (action === "refresh") return "error";
  return "success_with_warning";
};

// fallow-ignore-next-line unused-export
export { batch, Store };

// fallow-ignore-next-line complexity
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
  const devtoolsInstanceId = nextDevtoolsInstanceId();
  const storeIdValue = storeId ?? devtoolsInstanceId;
  const configuredEventLogCap =
      typeof options?.devtools === "object"
        ? options.devtools.eventLogCap
        : undefined,
    eventLogCap =
      Number.isSafeInteger(configuredEventLogCap) &&
      (configuredEventLogCap ?? 0) >= 1
        ? Math.min(configuredEventLogCap ?? 100, 10_000)
        : 100,
    devtoolsEmitter = createNusmDevtoolsEmitter(
      Boolean(options?.devtools),
      devtoolsInstanceId,
    );
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
    byKey: createDataRecord(),
    overall: adapter ? "pending" : "not_configured",
  };
  const getHydrationSnapshot = () => {
    const byKey = createDataRecord<HydrationStatus["byKey"][string]>();
    for (const [key, value] of Object.entries(hydrationStatus.byKey))
      defineRecordValue(byKey, key, value);
    return Object.freeze({
      byKey: Object.freeze(byKey),
      overall: hydrationStatus.overall,
    });
  };

  const resolveAdapterKey = (params: {
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
  const resolvedSliceKeys = new Map<string, string>();
  let resolvedEntireKey: string | undefined;
  const registerPersistenceUnit = (
    key: string,
    unit: { kind: "entire" | "slice"; sliceKey?: string },
  ) => {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Persistence adapter keys must be non-empty strings.");
    }
    const existing = persistenceUnits.get(key);
    if (existing) {
      const existingName = existing.sliceKey ?? existing.kind;
      const unitName = unit.sliceKey ?? unit.kind;
      throw new Error(
        `Persistence units "${existingName}" and "${unitName}" resolve to the same adapter key "${key}".`,
      );
    }
    persistenceUnits.set(key, unit);
  };
  const resolveKey = (params: {
    kind: "entire" | "slice";
    sliceKey?: string;
  }): string => {
    const key =
      params.kind === "entire"
        ? resolvedEntireKey
        : params.sliceKey === undefined
          ? undefined
          : resolvedSliceKeys.get(params.sliceKey);
    if (key === undefined) {
      throw new Error(
        "Persistence key was requested before configuration completed.",
      );
    }
    return key;
  };
  if (adapter) {
    if (strategy === "entire") {
      const key = resolveAdapterKey({ kind: "entire" });
      registerPersistenceUnit(key, { kind: "entire" });
      resolvedEntireKey = key;
      hydrationStatus.byKey.entire = "pending";
    } else {
      const logicalSliceKeys = new Set<string>();
      for (const slice of slices) {
        if (logicalSliceKeys.has(slice.key)) {
          throw new Error(
            `Persist slice key "${slice.key}" is configured more than once.`,
          );
        }
        logicalSliceKeys.add(slice.key);
      }
      for (const slice of slices) {
        const key = resolveAdapterKey({ kind: "slice", sliceKey: slice.key });
        registerPersistenceUnit(key, { kind: "slice", sliceKey: slice.key });
        resolvedSliceKeys.set(slice.key, key);
        defineRecordValue(hydrationStatus.byKey, slice.key, "pending");
      }
    }
  }

  const recentWrites = new Map<
    string,
    { active: number; completedAt?: number }
  >();
  let persistenceGeneration = 0;
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
  const queuedGenerations = new Map<string, number>();
  const recordAdapterWrite = async (
    key: string,
    operation: () => void | Promise<void>,
  ) => {
    const writeState = recentWrites.get(key) ?? { active: 0 };
    writeState.active += 1;
    recentWrites.set(key, writeState);
    try {
      await Promise.resolve(operation());
      writeState.completedAt = Date.now();
      lastFlushAt = writeState.completedAt;
    } catch (error) {
      if (writeState.active === 1 && writeState.completedAt === undefined)
        recentWrites.delete(key);
      throw error;
    } finally {
      writeState.active -= 1;
    }
  };
  const persistHydrationBaseline = async (entry: {
    key: string;
    payload: unknown;
    sliceKey?: string;
  }) => {
    if (!adapter) return;
    devtoolsEmitter?.emitEvent({
      key: entry.key,
      sliceKey: entry.sliceKey,
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_scheduled",
    });
    devtoolsEmitter?.emitEvent({
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_flush_start",
    });
    try {
      await recordAdapterWrite(entry.key, () =>
        adapter.setItem(entry.key, entry.payload),
      );
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
      throw error;
    }
  };

  const performFlushQueue = async () => {
    if (!adapter || queuedPayloads.size === 0) return;
    devtoolsEmitter?.emitEvent({
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_flush_start",
    });
    const entries = Array.from(queuedPayloads.values()).map((entry) => ({
      ...entry,
      generation: queuedGenerations.get(entry.key),
    }));
    queuedPayloads.clear();
    queuedGenerations.clear();

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.generation !== persistenceGeneration) return;
        try {
          await recordAdapterWrite(entry.key, () =>
            adapter.setItem(entry.key, entry.payload),
          );

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
    emitDevtoolsSnapshot();
  };
  let activeFlush: Promise<void> | undefined;
  const serializePersistenceOperation = (operation: () => Promise<void>) => {
    const requested = activeFlush ? activeFlush.then(operation) : operation();
    const recoverableTail = requested.catch(() => undefined);
    activeFlush = recoverableTail;
    void recoverableTail.then(() => {
      if (activeFlush === recoverableTail) activeFlush = undefined;
    });
    return requested;
  };
  const flushQueue = () => serializePersistenceOperation(performFlushQueue);

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
    queuedGenerations.set(entry.key, persistenceGeneration);
    devtoolsEmitter?.emitEvent({
      key: entry.key,
      sliceKey: entry.sliceKey,
      storeId: storeIdValue,
      ts: Date.now(),
      type: "persist_scheduled",
    });
    scheduleFlush();
  };

  let previousState = store.state;
  let supersededPersistenceState: { value: TState } | undefined;
  const subscribeToStore = () => {
    store.subscribe((currentVal) => {
      const prevVal = previousState;
      previousState = currentVal;
      if (suppressPersist) return;
      void emitDevtoolsSnapshot();
      if (!adapter) return;
      if (
        supersededPersistenceState &&
        Object.is(currentVal, supersededPersistenceState.value)
      ) {
        supersededPersistenceState = undefined;
        return;
      }
      supersededPersistenceState = undefined;
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
    store.setState(() => nextState);
    suppressPersist = false;
  };

  // fallow-ignore-next-line complexity
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
        await persistHydrationBaseline({ key, payload: initialState });
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

  // fallow-ignore-next-line complexity
  const hydrateSlices = async (): Promise<TState> => {
    let nextState = initialState;
    const missingSlices: typeof slices = [];
    const hydratedSliceValues: Array<{
      slice: (typeof slices)[number];
      value: unknown;
    }> = [];

    if (shouldDiscardPersisted(hydrateConfig)) {
      for (const slice of slices) {
        defineRecordValue(hydrationStatus.byKey, slice.key, "discarded");
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
          missingSlices.push(slice);
          continue;
        }
        let persistedValue: unknown = raw;
        if (hydrateConfig?.validate) {
          const result = resolveValidateResult(
            hydrateConfig.validate(persistedValue),
            persistedValue,
          );
          if (!result.ok) {
            defineRecordValue(hydrationStatus.byKey, slice.key, "discarded");
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
        hydratedSliceValues.push({ slice, value: persistedValue });
        defineRecordValue(hydrationStatus.byKey, slice.key, "hydrated");
      } catch (error) {
        defineRecordValue(hydrationStatus.byKey, slice.key, "error");
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

    const missingBaselines = missingSlices.map((slice) => ({
      baseline: slice.select(initialState),
      key: resolveKey({ kind: "slice", sliceKey: slice.key }),
      slice,
    }));
    let baselineState = nextState;
    for (const { baseline, slice } of missingBaselines) {
      baselineState = slice.apply(baselineState, baseline);
    }
    const expectedSliceValues = [
      ...hydratedSliceValues,
      ...missingBaselines.map(({ baseline, slice }) => ({
        slice,
        value: baseline,
      })),
    ];
    const nonIsolatedSlice = expectedSliceValues.find(
      ({ slice, value }) => !deepEqual(slice.select(baselineState), value),
    );
    if (nonIsolatedSlice) {
      throw new Error(
        `Persist slice "${nonIsolatedSlice.slice.key}" is not isolated: applying slice values changed its selected persisted value.`,
      );
    }
    nextState = baselineState;
    for (const { baseline, key, slice } of missingBaselines) {
      try {
        await persistHydrationBaseline({
          key,
          payload: baseline,
          sliceKey: slice.key,
        });
        defineRecordValue(hydrationStatus.byKey, slice.key, "hydrated");
      } catch (error) {
        defineRecordValue(hydrationStatus.byKey, slice.key, "error");
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
      devtoolsEmitter?.emitHydration(storeIdValue, getHydrationSnapshot());
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

  // fallow-ignore-next-line complexity
  const handleAdapterEvent = async (event: AdapterEvent) => {
    if (!adapter) return;

    if (event.type !== "clear" && event.key) {
      const writeState = recentWrites.get(event.key);
      if (
        writeState &&
        (writeState.active > 0 ||
          (writeState.completedAt !== undefined &&
            Date.now() - writeState.completedAt < recentWriteWindowMs))
      ) {
        return;
      }
    }

    const applyExternalState = (nextState: TState) => {
      suppressPersist = true;
      store.setState(() => nextState);
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

      let nextState = store.state;
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

  // fallow-ignore-next-line complexity
  const readPersistedSnapshot = async (): Promise<unknown> => {
    if (!adapter || !storeId) return undefined;
    if (strategy === "entire") {
      const raw = await adapter.getItem(resolveKey({ kind: "entire" }));
      return raw == null ? undefined : raw;
    }

    const result = createDataRecord<unknown>();
    for (const slice of slices) {
      const raw = await adapter.getItem(
        resolveKey({ kind: "slice", sliceKey: slice.key }),
      );
      if (raw == null) continue;
      defineRecordValue(result, slice.key, raw);
    }
    return result;
  };

  const comparePersistenceValue = (
    memory: unknown,
    persisted: unknown,
  ): "diverged" | "synchronized" =>
    deepEqual(memory, persisted) ? "synchronized" : "diverged";

  const resolveSliceSynchronization = (
    persisted: unknown,
  ): "diverged" | "synchronized" => {
    if (
      typeof persisted !== "object" ||
      persisted === null ||
      Array.isArray(persisted)
    )
      return "diverged";
    for (const slice of slices) {
      const descriptor = Object.getOwnPropertyDescriptor(persisted, slice.key);
      if (!descriptor || !("value" in descriptor)) return "diverged";
      if (
        comparePersistenceValue(slice.select(store.state), descriptor.value) ===
        "diverged"
      )
        return "diverged";
    }
    return "synchronized";
  };

  const resolveSynchronization = (
    persisted: unknown,
  ): NonNullable<NusmDevtoolsSnapshot["synchronization"]> => {
    if (!adapter) return "not_applicable";
    try {
      return strategy === "entire"
        ? comparePersistenceValue(store.state, persisted)
        : resolveSliceSynchronization(persisted);
    } catch {
      return "unknown";
    }
  };

  let snapshotSequence = 0;
  const emitDevtoolsSnapshot = async (): Promise<string | undefined> => {
    if (!devtoolsEmitter) return undefined;
    const sequence = ++snapshotSequence;
    try {
      const persisted = await readPersistedSnapshot();
      if (sequence !== snapshotSequence) return undefined;
      devtoolsEmitter.emitSnapshot({
        adapterName: adapter?.name,
        eventLogCap,
        hydration: getHydrationSnapshot(),
        initial: initialState,
        isReady,
        lastFlushAt,
        memory: store.state,
        pendingKeys: Array.from(queuedPayloads.keys()),
        persisted,
        persistenceStrategy: adapter ? strategy : undefined,
        storeId: storeIdValue,
        synchronization: resolveSynchronization(persisted),
      });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      devtoolsEmitter.emitEvent({
        detail: message,
        storeId: storeIdValue,
        ts: Date.now(),
        type: "devtools_snapshot_error",
      });
      onError?.(error);
      return message;
    }
  };

  const supersedePendingPersistence = (operation: () => Promise<void>) => {
    supersededPersistenceState = { value: store.state };
    persistenceGeneration += 1;
    for (const key of persistenceUnits.keys()) {
      queuedPayloads.delete(key);
      queuedGenerations.delete(key);
    }
    return serializePersistenceOperation(operation);
  };

  const assertDevtoolsValue = (value: unknown) => {
    if (!isRoundTrippableForDevtools(value))
      throw new Error("Devtools mutations require round-trippable JSON data.");
    try {
      structuredClone(value);
    } catch {
      throw new Error("Devtools mutations do not support Proxy values.");
    }
  };

  type PersistedWriteUnit = { key: string; value: unknown };
  type CommittedWrite = { prior: unknown; unit: PersistedWriteUnit };

  const requirePersistenceAdapter = () => {
    if (!adapter || !storeId)
      throw new Error("This store has no configured persistence adapter.");
    return adapter;
  };

  const createSliceWriteUnits = (value: unknown): PersistedWriteUnit[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(
        "Slice persistence requires an object keyed by slice name.",
      );
    const values = value as Record<string, unknown>;
    const expectedKeys = slices.map((slice) => slice.key).sort();
    const receivedKeys = Object.keys(values).sort();
    const keysMatch =
      expectedKeys.length === receivedKeys.length &&
      expectedKeys.every((key, index) => key === receivedKeys[index]);
    if (!keysMatch)
      throw new Error(
        `Slice persistence requires exactly these keys: ${expectedKeys.join(", ")}.`,
      );
    return slices.map((slice) => ({
      key: resolveKey({ kind: "slice", sliceKey: slice.key }),
      value: values[slice.key],
    }));
  };

  const rollbackSliceWrites = async (
    persistenceAdapter: NonNullable<typeof adapter>,
    committed: CommittedWrite[],
    writeError: unknown,
  ) => {
    let rollbackError: unknown;
    for (const { prior, unit } of committed.reverse()) {
      try {
        if (prior == null)
          await recordAdapterWrite(unit.key, () =>
            persistenceAdapter.removeItem(unit.key),
          );
        else
          await recordAdapterWrite(unit.key, () =>
            persistenceAdapter.setItem(unit.key, prior),
          );
      } catch (error) {
        rollbackError = rollbackError ?? error;
      }
    }
    if (rollbackError)
      throw new AggregateError(
        [writeError, rollbackError],
        "Slice write failed and rollback was incomplete.",
      );
    throw writeError;
  };

  const writeSliceUnits = async (
    persistenceAdapter: NonNullable<typeof adapter>,
    units: PersistedWriteUnit[],
  ) => {
    const previous = await Promise.all(
      units.map((unit) => persistenceAdapter.getItem(unit.key)),
    );
    const committed: CommittedWrite[] = [];
    try {
      for (const [index, unit] of units.entries()) {
        await recordAdapterWrite(unit.key, () =>
          persistenceAdapter.setItem(unit.key, unit.value),
        );
        committed.push({ prior: previous[index], unit });
      }
    } catch (writeError) {
      await rollbackSliceWrites(persistenceAdapter, committed, writeError);
    }
  };

  const writePersistedValue = async (value: unknown) => {
    const persistenceAdapter = requirePersistenceAdapter();
    assertDevtoolsValue(value);
    if (strategy === "entire") {
      const key = resolveKey({ kind: "entire" });
      await recordAdapterWrite(key, () =>
        persistenceAdapter.setItem(key, value),
      );
      return;
    }
    await writeSliceUnits(persistenceAdapter, createSliceWriteUnits(value));
  };

  const replacePersistedValue = (value: unknown) =>
    supersedePendingPersistence(() => writePersistedValue(value));

  const readPersistedMutationBase = async (): Promise<unknown> => {
    if (strategy !== "entire")
      throw new Error(
        "Whole persisted mutation is only valid for entire persistence.",
      );
    return readPersistedSnapshot();
  };

  const mutatePersistedValue = (mutation: (value: unknown) => unknown) =>
    supersedePendingPersistence(async () => {
      const persisted = await readPersistedMutationBase();
      assertDevtoolsValue(persisted);
      await writePersistedValue(mutation(persisted));
    });

  const setPersistedValueAtPath = (path: NusmDevtoolsPath, value: unknown) => {
    if (strategy === "entire") {
      return mutatePersistedValue((persisted) =>
        setValueAtPath(persisted, path, value),
      );
    }
    if (!adapter || !storeId) {
      throw new Error("This store has no configured persistence adapter.");
    }
    const [sliceKey, ...nestedPath] = path;
    const slice = slices.find(
      (candidate) => typeof sliceKey === "string" && candidate.key === sliceKey,
    );
    if (!slice)
      throw new Error(
        "Persisted slice path must start with a configured slice key.",
      );
    return supersedePendingPersistence(async () => {
      const key = resolveKey({ kind: "slice", sliceKey: slice.key });
      if (nestedPath.length === 0) {
        assertDevtoolsValue(value);
        await recordAdapterWrite(key, () => adapter.setItem(key, value));
        return;
      }
      const current = await adapter.getItem(key);
      const base = current == null ? slice.select(initialState) : current;
      assertDevtoolsValue(base);
      const next = setValueAtPath(base, nestedPath, value);
      assertDevtoolsValue(next);
      await recordAdapterWrite(key, () => adapter.setItem(key, next));
    });
  };
  const removePersistedValueAtPath = (path: NusmDevtoolsPath) => {
    if (strategy === "entire") {
      return mutatePersistedValue((persisted) =>
        removeValueAtPath(persisted, path),
      );
    }
    if (!adapter || !storeId) {
      throw new Error("This store has no configured persistence adapter.");
    }
    const [sliceKey, ...nestedPath] = path;
    const slice = slices.find(
      (candidate) => typeof sliceKey === "string" && candidate.key === sliceKey,
    );
    if (!slice)
      throw new Error(
        "Persisted slice path must start with a configured slice key.",
      );
    return supersedePendingPersistence(async () => {
      const key = resolveKey({ kind: "slice", sliceKey: slice.key });
      if (nestedPath.length === 0) {
        await recordAdapterWrite(key, () => adapter.removeItem(key));
        return;
      }
      const current = await adapter.getItem(key);
      if (current == null)
        throw new Error("Cannot remove a path from a missing persisted slice.");
      assertDevtoolsValue(current);
      const next = removeValueAtPath(current, nestedPath);
      assertDevtoolsValue(next);
      await recordAdapterWrite(key, () => adapter.setItem(key, next));
    });
  };

  const performPathMutation = async (command: NusmDevtoolsCommand) => {
    if (command.action === "set_path") {
      if (command.location === "persisted") {
        await setPersistedValueAtPath(command.path, command.value);
        return;
      }
      assertDevtoolsValue(store.state);
      const nextValue = setValueAtPath(
        store.state,
        command.path,
        command.value,
      );
      assertDevtoolsValue(nextValue);
      applyState(nextValue as TState);
      return;
    }
    if (command.action !== "remove_path") return;
    if (command.location === "persisted") {
      await removePersistedValueAtPath(command.path);
      return;
    }
    assertDevtoolsValue(store.state);
    const nextValue = removeValueAtPath(store.state, command.path);
    assertDevtoolsValue(nextValue);
    applyState(nextValue as TState);
  };

  const performDevtoolsMutation = async (command: NusmDevtoolsCommand) => {
    if (command.action === "refresh" || command.action === "refresh_all")
      return;
    if (!isReady)
      throw new Error("Store hydration must finish before Devtools mutations.");
    if (command.action === "replace_memory") {
      assertDevtoolsValue(command.value);
      applyState(command.value as TState);
      return;
    }
    if (command.action === "reset_memory") {
      applyState(initialState);
      return;
    }
    if (command.action === "replace_persisted") {
      await replacePersistedValue(command.value);
      return;
    }
    await performPathMutation(command);
  };

  const assertNonEmptyCommandString = (value: unknown, field: string) => {
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`Devtools ${field} must be a non-empty string.`);
  };

  const assertDevtoolsPath = (path: unknown) => {
    if (!Array.isArray(path) || path.length === 0)
      throw new Error(
        "Devtools command path must contain safe string or index segments.",
      );
    const valid = path.every(
      (segment) =>
        typeof segment === "string" ||
        (typeof segment === "number" &&
          Number.isInteger(segment) &&
          segment >= 0),
    );
    if (!valid)
      throw new Error(
        "Devtools command path must contain safe string or index segments.",
      );
  };

  const assertDevtoolsCommand = (command: NusmDevtoolsCommand) => {
    const record = command as unknown as Record<string, unknown>;
    const actions = new Set([
      "refresh_all",
      "refresh",
      "reset_memory",
      "replace_memory",
      "replace_persisted",
      "set_path",
      "remove_path",
    ]);
    assertNonEmptyCommandString(record.commandId, "commandId");
    if (typeof record.action !== "string" || !actions.has(record.action))
      throw new Error("Unknown Devtools command action.");
    if (record.action === "refresh_all") return;
    (() => {
      assertNonEmptyCommandString(record.instanceId, "command instanceId");
      assertNonEmptyCommandString(record.storeId, "command storeId");
      if (record.storeId !== storeIdValue)
        throw new Error(
          "Devtools command storeId does not match its instance.",
        );
    })();
    if (record.action !== "set_path" && record.action !== "remove_path") return;
    if (record.location !== "memory" && record.location !== "persisted")
      throw new Error("Devtools command location must be memory or persisted.");
    assertDevtoolsPath(record.path);
  };
  const applyDevtoolsCommand = async (command: NusmDevtoolsCommand) => {
    const record = command as unknown as Record<string, unknown>;
    if (
      record.action !== "refresh_all" &&
      record.instanceId !== devtoolsInstanceId
    )
      return;
    try {
      assertDevtoolsCommand(command);
      await performDevtoolsMutation(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      devtoolsEmitter?.emitEvent({
        detail: message,
        storeId: storeIdValue,
        ts: Date.now(),
        type: "devtools_command_error",
      });
      if (
        typeof record.commandId === "string" &&
        typeof record.action === "string"
      )
        devtoolsEmitter?.emitCommandResult({
          action: command.action,
          commandId: record.commandId,
          error: message,
          status: "error",
          storeId: storeIdValue,
        });
      onError?.(error);
      return;
    }
    const snapshotError = await emitDevtoolsSnapshot();
    devtoolsEmitter?.emitEvent({
      detail: command.action,
      storeId: storeIdValue,
      ts: Date.now(),
      type: "devtools_command",
    });
    devtoolsEmitter?.emitCommandResult({
      action: command.action,
      commandId: command.commandId,
      error: snapshotError,
      status: resolveCommandStatus(command.action, snapshotError),
      storeId: storeIdValue,
    });
  };

  devtoolsEmitter?.onCommand((command) => {
    void applyDevtoolsCommand(command);
  });

  subscribeToStore();
  void hydrate().then(async () => {
    if (pendingAdapterEvents.length > 0) {
      for (const event of pendingAdapterEvents.splice(0)) {
        await handleAdapterEvent(event);
      }
    }
  });

  // extend store with our ready promise
  (() => {
    Object.defineProperty(store, "devtoolsInstanceId", {
      value: devtoolsInstanceId,
    });
    Object.defineProperty(store, "isReady", { get: () => isReady });
  })();
  Object.defineProperty(store, "hydration", { get: getHydrationSnapshot });
  store.ready = ready;

  return store;
}
