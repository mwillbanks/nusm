import { deepEqual } from "fast-equals";
import type { AdapterEvent } from "../types.js";
import type {
  NusmSyncEvent,
  NusmSyncSource,
  NusmSyncSourceContext,
  NusmSyncSourceInput,
  NusmSyncStatus,
} from "./types.js";

type PendingWrite = {
  active: number;
  generation: number;
  value: unknown;
};

export interface NusmSyncCoordinatorOptions<TState = unknown> {
  storeId: string;
  sources?: NusmSyncSourceInput<TState>;
  onEvent: (event: NusmSyncEvent<TState>) => void | Promise<void>;
  onError?: (error: unknown) => void;
  onStatus?: (status: NusmSyncStatus) => void;
  instanceId?: string;
}

export interface NusmSyncCoordinator<TState = unknown> {
  readonly status: NusmSyncStatus;
  start(): Promise<void>;
  enqueue(event: NusmSyncEvent<TState>): Promise<void>;
  publish(event: NusmSyncEvent<TState>): Promise<void>;
  recordPendingWrite(
    key: string,
    value: unknown,
    generation: number,
  ): () => void;
  isPendingWrite(key: string): boolean;
  hasPendingWrites(): boolean;
  matchesPendingWrite(
    key: string,
    value: unknown,
    generation?: number,
  ): boolean;
  enqueueAdapterEvent(event: AdapterEvent, generation?: number): Promise<void>;
  dispose(): Promise<void>;
}

const asSources = <TState>(
  sources: NusmSyncSourceInput<TState> | undefined,
): readonly NusmSyncSource<TState>[] => {
  if (!sources) return [];
  return Array.isArray(sources)
    ? (sources as readonly NusmSyncSource<TState>[])
    : [sources as NusmSyncSource<TState>];
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const rememberEvent = (
  seenEvents: Map<string, Set<string>>,
  event: NusmSyncEvent,
): boolean => {
  const sourceEvents = seenEvents.get(event.sourceId) ?? new Set<string>();
  if (sourceEvents.has(event.eventId)) return false;
  sourceEvents.add(event.eventId);
  seenEvents.set(event.sourceId, sourceEvents);
  const identities = Array.from(seenEvents.values()).reduce(
    (count, values) => count + values.size,
    0,
  );
  if (identities <= 256) return true;
  const oldestSource = seenEvents.keys().next().value;
  if (!oldestSource) return true;
  const oldestEvents = seenEvents.get(oldestSource);
  const oldestEvent = oldestEvents?.values().next().value;
  if (oldestEvent) oldestEvents?.delete(oldestEvent);
  if (oldestEvents?.size === 0) seenEvents.delete(oldestSource);
  return true;
};

/**
 * Serializes source and adapter observations and correlates adapter echoes
 * with the exact write generation that produced them.
 */
export const createNusmSyncCoordinator = <TState>(
  options: NusmSyncCoordinatorOptions<TState>,
): NusmSyncCoordinator<TState> => {
  const sources = asSources(options.sources);
  const sourceContext: NusmSyncSourceContext = {
    instanceId: options.instanceId,
    onError: options.onError,
    storeId: options.storeId,
  };
  const pendingWrites = new Map<string, PendingWrite[]>();
  const seenEvents = new Map<string, Set<string>>();
  const cleanups: Array<() => void | Promise<void>> = [];
  let queue = Promise.resolve();
  let publishQueue = Promise.resolve();
  let disposed = false;
  let status: NusmSyncStatus = sources.length > 0 ? "pending" : "disabled";

  const report = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // Error reporters are observers and must never break event delivery.
    }
  };
  const setStatus = (next: NusmSyncStatus) => {
    status = next;
    try {
      options.onStatus?.(next);
    } catch (error) {
      report(error);
    }
  };
  const enqueue = (event: NusmSyncEvent<TState>): Promise<void> => {
    if (disposed || event.storeId !== options.storeId) return queue;
    if (!rememberEvent(seenEvents, event)) return queue;
    queue = queue.then(async () => {
      if (disposed || event.storeId !== options.storeId) return;
      try {
        await options.onEvent(event);
      } catch (error) {
        report(error);
      }
    });
    return queue;
  };
  const start = async () => {
    if (disposed || sources.length === 0) return;
    for (const source of sources) {
      try {
        const cleanup = await source.start((event) => {
          void enqueue(event);
        }, sourceContext);
        if (typeof cleanup === "function") cleanups.push(cleanup);
      } catch (error) {
        setStatus("unavailable");
        report(toError(error));
      }
    }
    if (status === "pending") setStatus("active");
  };
  const publish = (event: NusmSyncEvent<TState>) => {
    publishQueue = publishQueue.then(async () => {
      if (disposed || sources.length === 0) return;
      await Promise.all(
        sources.map(async (source) => {
          try {
            await source.publish(event);
          } catch (error) {
            report(toError(error));
          }
        }),
      );
    });
    return publishQueue;
  };
  const recordPendingWrite = (
    key: string,
    value: unknown,
    generation: number,
  ) => {
    const entries = pendingWrites.get(key) ?? [];
    const entry = { active: 1, generation, value };
    entries.push(entry);
    // Keep correlation history bounded without using time as an identity.
    if (entries.length > 128) entries.splice(0, entries.length - 128);
    pendingWrites.set(key, entries);
    return () => {
      entry.active = 0;
      // Keep the completed value until the adapter reports its observation.
      // This is exact value correlation, not a time-window heuristic.
    };
  };
  const matchesPendingWrite = (
    key: string,
    value: unknown,
    generation?: number,
  ) => {
    const entries = pendingWrites.get(key);
    if (!entries) return false;
    const index = entries.findIndex(
      (entry) =>
        entry.active === 0 &&
        (generation === undefined || entry.generation === generation) &&
        deepEqual(entry.value, value),
    );
    if (index < 0) return false;
    entries.splice(index, 1);
    if (entries.length === 0) pendingWrites.delete(key);
    return true;
  };
  const enqueueAdapterEvent = (event: AdapterEvent, generation?: number) =>
    enqueue({
      adapterEvent: event,
      eventId: `adapter:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      generation,
      key: event.key,
      kind: "adapter",
      sourceId: "adapter",
      storeId: options.storeId,
    });
  const dispose = async () => {
    if (disposed) return queue;
    disposed = true;
    setStatus("disposed");
    pendingWrites.clear();
    const failures: unknown[] = [];
    for (const cleanup of cleanups.splice(0)) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
        report(error);
      }
    }
    for (const source of sources) {
      try {
        await source.dispose?.(sourceContext);
      } catch (error) {
        failures.push(error);
        report(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures);
  };

  return {
    dispose,
    enqueue,
    enqueueAdapterEvent,
    hasPendingWrites: () =>
      Array.from(pendingWrites.values()).some((entries) =>
        entries.some((entry) => entry.active > 0),
      ),
    isPendingWrite: (key) => {
      return Boolean(pendingWrites.get(key)?.some((entry) => entry.active > 0));
    },
    matchesPendingWrite,
    publish,
    recordPendingWrite,
    start,
    get status() {
      return status;
    },
  };
};
