import { deepEqual } from "fast-equals";
import type { AdapterEvent } from "../types.js";
import {
  isValidSyncRevisionEpoch,
  MAX_SYNC_REVISION_COUNTER,
  MAX_SYNC_REVISION_EPOCH,
  SYNC_REVISION_ROLLOVER_WINDOW,
} from "./protocol.js";
import type {
  NusmSyncEvent,
  NusmSyncRevision,
  NusmSyncSource,
  NusmSyncSourceContext,
  NusmSyncSourceInput,
  NusmSyncStatus,
  NusmSyncValidationResult,
  NusmSyncValidator,
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
  optimistic?: boolean;
  validator?: NusmSyncValidator<TState>;
  onRejected?: (error: Error, event: NusmSyncEvent<TState>) => void;
  onSnapshotRequest?: (
    event: NusmSyncEvent<TState>,
  ) => TState | Promise<TState>;
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
  announceHydrating(state: TState): Promise<void>;
  announceReady(state: TState): Promise<void>;
  waitForIdle(includePublishes?: boolean): Promise<void>;
  waitForConvergence(): Promise<void>;
  isConverged(): boolean;
  nextRevision(): { counter: number; senderId: string; epoch: string };
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

const applyValidationResult = <TState>(
  event: NusmSyncEvent<TState>,
  result: NusmSyncValidationResult<TState>,
): NusmSyncEvent<TState> | undefined => {
  if (typeof result === "boolean") return result ? event : undefined;
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.ok !== "boolean" ||
    !result.ok
  )
    return undefined;
  return Object.hasOwn(result, "value")
    ? { ...event, state: result.value as TState }
    : event;
};

const createSyncInstanceId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  fallbackIdentityCounter += 1;
  return `nusm-sync-${Date.now()}-${fallbackIdentityCounter}`;
};

let fallbackIdentityCounter = 0;

const followsRevision = (
  previous: { counter: number; epoch: string },
  incoming: NusmSyncRevision,
): boolean => {
  if (previous.epoch === (incoming.epoch ?? ""))
    return incoming.counter === previous.counter + 1;
  const previousEpoch = Number(previous.epoch);
  const incomingEpoch = Number(incoming.epoch ?? "");
  return incoming.counter === 1 && incomingEpoch === previousEpoch + 1;
};

const allowsEpochBaseline = (
  currentEpochText: string,
  incomingEpochText: string,
  allowBaseline: boolean,
): boolean => {
  const currentEpoch = Number(currentEpochText);
  const incomingEpoch = Number(incomingEpochText);
  if (allowBaseline)
    return incomingEpoch === currentEpoch || incomingEpoch === currentEpoch + 1;
  return incomingEpoch <= currentEpoch;
};

const isAheadOfClock = (
  currentEpochText: string,
  currentCounter: number,
  incomingEpochText: string,
  incomingCounter: number,
): boolean => {
  const currentEpoch = Number(currentEpochText);
  const incomingEpoch = Number(incomingEpochText);
  return (
    incomingEpoch > currentEpoch ||
    (incomingEpoch === currentEpoch && incomingCounter > currentCounter)
  );
};

const allowsFirstRevision = (
  counter: number,
  currentCounter: number,
  allowBaseline: boolean,
): boolean => allowBaseline || counter <= currentCounter + 1;

const MAX_TRACKED_PEERS = 32;
const MAX_TRACKED_PROTOCOL_IDS = 256;
const MAX_QUEUED_PUBLISHES = 256;

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
  const localId = createSyncInstanceId();
  const sourceContext: NusmSyncSourceContext = {
    instanceId: localId,
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
  let started: Promise<void> | undefined;
  let localPhase: "hydrating" | "ready" = "hydrating";
  const creationTime = Date.now();
  let requestSequence = 0;
  let revisionCounter = 0;
  let revisionEpoch = "0";
  let provisionalCounter = 0;
  let provisionalEpoch = "0";
  let _localState: TState | undefined;
  let converged = sources.length === 0;
  let flushingQueued = false;
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let hydrationHeartbeat: ReturnType<typeof setInterval> | undefined;
  const peers = new Map<
    string,
    {
      phase: "hydrating" | "ready";
      creationTime: number;
      lastSeen: number;
    }
  >();
  const pendingRequests = new Map<
    string,
    { targetId: string; retries: number; timer?: ReturnType<typeof setTimeout> }
  >();
  const appliedSnapshots = new Set<string>();
  const servedRequests = new Map<string, string>();
  const servedAttempts = new Map<string, number>();
  const servedRevisions = new Map<
    string,
    { counter: number; senderId: string; epoch: string }
  >();
  const convergenceWaiters: Array<() => void> = [];
  const revisionProgress = new Map<
    string,
    { counter: number; epoch: string }
  >();
  const rejectedRevisionProgress = new Map<
    string,
    { counter: number; epoch: string }
  >();
  const snapshotProgress = new Set<string>();
  const rejectedCandidates = new Set<string>();
  const pruneOldest = <T>(
    entries: Map<string, T> | Set<string>,
    limit: number,
  ) => {
    while (entries.size > limit) {
      const oldest =
        entries instanceof Map
          ? entries.keys().next().value
          : entries.values().next().value;
      if (!oldest) return;
      entries.delete(oldest as string);
    }
  };
  const expirePeers = () => {
    const cutoff = Date.now() - 5000;
    for (const [id, peer] of peers)
      if (peer.lastSeen < cutoff) peers.delete(id);
  };
  const rememberPeer = (
    id: string,
    peer: {
      phase: "hydrating" | "ready";
      creationTime: number;
      lastSeen: number;
    },
  ) => {
    expirePeers();
    peers.set(id, peer);
    pruneOldest(peers, MAX_TRACKED_PEERS);
  };
  const rememberAppliedSnapshot = (id: string) => {
    appliedSnapshots.add(id);
    pruneOldest(appliedSnapshots, MAX_TRACKED_PROTOCOL_IDS);
  };
  const validRevisionShape = (event: NusmSyncEvent<TState>) => {
    const revision = event.revision;
    if (!revision) return true;
    if (!Number.isInteger(revision.counter) || revision.counter <= 0)
      return false;
    if (
      revision.counter >
      MAX_SYNC_REVISION_COUNTER - SYNC_REVISION_ROLLOVER_WINDOW
    )
      return false;
    if (!revision.senderId) return false;
    if (!isValidSyncRevisionEpoch(revision.epoch ?? "0")) return false;
    return (
      event.kind === "snapshot" ||
      revision.counter <
        MAX_SYNC_REVISION_COUNTER - SYNC_REVISION_ROLLOVER_WINDOW
    );
  };
  const validRevisionProgression = (
    revision: NonNullable<NusmSyncEvent<TState>["revision"]>,
    allowEpochBaseline: boolean,
  ) => {
    const epoch = revision.epoch ?? "";
    const accepted = revisionProgress.get(revision.senderId);
    const rejected = rejectedRevisionProgress.get(revision.senderId);
    const previous =
      accepted && rejected
        ? isAheadOfClock(
            accepted.epoch,
            accepted.counter,
            rejected.epoch,
            rejected.counter,
          )
          ? rejected
          : accepted
        : (accepted ?? rejected);
    return previous
      ? followsRevision(previous, revision)
      : allowsFirstRevision(
          revision.counter,
          revisionCounter,
          allowEpochBaseline,
        ) && allowsEpochBaseline(revisionEpoch, epoch, allowEpochBaseline);
  };
  const commitRevision = (
    revision: NonNullable<NusmSyncEvent<TState>["revision"]>,
  ) => {
    const epoch = revision.epoch ?? "";
    revisionProgress.set(revision.senderId, {
      counter: revision.counter,
      epoch,
    });
    pruneOldest(revisionProgress, MAX_TRACKED_PROTOCOL_IDS);
    if (
      revision.senderId !== localId &&
      isAheadOfClock(revisionEpoch, revisionCounter, epoch, revision.counter)
    ) {
      revisionCounter = revision.counter;
      revisionEpoch = epoch;
      if (!converged && queuedPublishes.length === 0) {
        provisionalCounter = revisionCounter;
        provisionalEpoch = revisionEpoch;
      }
    }
  };
  const validateRevision = (event: NusmSyncEvent<TState>) => {
    const revision = event.revision;
    if (!validRevisionShape(event)) return false;
    if (!revision) return true;
    if (!validRevisionProgression(revision, event.kind === "snapshot"))
      return false;
    return true;
  };
  const commitEventRevision = (event: NusmSyncEvent<TState>) => {
    const revision = event.revision;
    if (!revision) return;
    commitRevision(revision);
    if (event.kind === "snapshot") {
      snapshotProgress.add(revision.senderId);
      pruneOldest(snapshotProgress, MAX_TRACKED_PROTOCOL_IDS);
    }
  };

  const report = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // Error reporters are observers and must never break event delivery.
    }
  };
  const validateCandidate = async (
    event: NusmSyncEvent<TState>,
  ): Promise<NusmSyncEvent<TState> | undefined> => {
    if (!options.validator || !Object.hasOwn(event, "state")) return event;
    const context = {
      kind: event.kind,
      revision: event.revision,
      source: event.sourceId,
      storeId: options.storeId,
    } as const;
    const rejectionKey = `${event.sourceId}:${event.kind}:${event.requestId ?? event.eventId}`;
    const reject = (error: unknown) => {
      if (rejectedCandidates.has(rejectionKey)) return;
      rejectedCandidates.add(rejectionKey);
      while (rejectedCandidates.size > MAX_TRACKED_PROTOCOL_IDS)
        rejectedCandidates.delete(
          rejectedCandidates.values().next().value ?? "",
        );
      const rejection = toError(error);
      if (event.revision) {
        rejectedRevisionProgress.set(event.revision.senderId, {
          counter: event.revision.counter,
          epoch: event.revision.epoch ?? "",
        });
        pruneOldest(rejectedRevisionProgress, MAX_TRACKED_PROTOCOL_IDS);
      }
      try {
        options.onRejected?.(rejection, event);
      } catch (observerError) {
        report(observerError);
      }
    };
    let result: NusmSyncValidationResult<TState>;
    try {
      result = await options.validator(event.state, context);
    } catch (error) {
      reject(error);
      return undefined;
    }
    const validated = applyValidationResult(event, result);
    if (validated) return validated;
    reject(new Error("Synchronization validator rejected state."));
    return undefined;
  };
  const setStatus = (next: NusmSyncStatus) => {
    status = next;
    try {
      options.onStatus?.(next);
    } catch (error) {
      report(error);
    }
  };
  const rawPublish = (event: NusmSyncEvent<TState>) => {
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
  const flushQueued = () => {
    if (!converged) return;
    flushingQueued = true;
    queuedRevisionBase = undefined;
    const replay = async () => {
      let previous: NusmSyncRevision = {
        counter: revisionCounter,
        epoch: revisionEpoch,
        senderId: localId,
      };
      const replayEvents = async (
        queued: NusmSyncEvent<TState>[],
        index: number,
      ): Promise<void> => {
        if (index >= queued.length) return;
        const event = queued[index];
        if (!event) return;
        previous = rebaseReplayRevision(previous);
        previous = nextRevisionAfter(previous);
        event.revision = { ...previous };
        revisionCounter = previous.counter;
        revisionEpoch = previous.epoch ?? "0";
        revisionProgress.set(localId, {
          counter: revisionCounter,
          epoch: revisionEpoch,
        });
        try {
          await options.onEvent(event);
        } catch (error) {
          report(error);
        }
        await rawPublish(event);
        await replayEvents(queued, index + 1);
      };
      const replayBatches = async (): Promise<void> => {
        if (queuedPublishes.length === 0) return;
        await replayEvents(queuedPublishes.splice(0), 0);
        await replayBatches();
      };
      await replayBatches();
      // The authoritative revision is now represented by `revisionCounter`.
      // Do not retain a replay tail: an empty drain must not influence the
      // next local revision after a snapshot advances the clock.
      queuedRevisionBase = undefined;
      provisionalCounter = revisionCounter;
      provisionalEpoch = revisionEpoch;
      flushingQueued = false;
      for (const resolve of convergenceWaiters.splice(0)) resolve();
    };
    void replay();
  };
  const queuedPublishes: NusmSyncEvent<TState>[] = [];
  let queuedRevisionBase: NusmSyncRevision | undefined;
  const nextRevisionAfter = (previous: NusmSyncRevision): NusmSyncRevision => {
    const rolloverThreshold =
      MAX_SYNC_REVISION_COUNTER - SYNC_REVISION_ROLLOVER_WINDOW - 1;
    if (previous.counter >= rolloverThreshold) {
      const epoch = Number(previous.epoch ?? "0");
      return {
        counter: 1,
        epoch: String(epoch >= MAX_SYNC_REVISION_EPOCH ? 0 : epoch + 1),
        senderId: localId,
      };
    }
    return {
      counter: previous.counter + 1,
      epoch: previous.epoch ?? "0",
      senderId: localId,
    };
  };
  const rebaseReplayRevision = (previous: NusmSyncRevision) =>
    isAheadOfClock(
      previous.epoch ?? "0",
      previous.counter,
      revisionEpoch,
      revisionCounter,
    )
      ? {
          counter: revisionCounter,
          epoch: revisionEpoch,
          senderId: localId,
        }
      : previous;
  const compactQueuedPublishes = () => {
    if (queuedPublishes.length <= MAX_QUEUED_PUBLISHES) return;
    const retained = queuedPublishes.slice(-MAX_QUEUED_PUBLISHES);
    let revision = queuedRevisionBase ?? {
      counter: 0,
      epoch: "0",
      senderId: localId,
    };
    queuedPublishes.splice(0, queuedPublishes.length);
    for (const event of retained) {
      revision = nextRevisionAfter(revision);
      if (event.revision) Object.assign(event.revision, revision);
      else event.revision = { ...revision };
      queuedPublishes.push(event);
    }
    provisionalCounter = revision.counter;
    provisionalEpoch = revision.epoch ?? "0";
  };
  const publishControl = (event: NusmSyncEvent<TState>) => rawPublish(event);
  const queueUpdate = (event: NusmSyncEvent<TState>) => {
    if (!queuedRevisionBase)
      queuedRevisionBase = {
        counter: Math.max(0, event.revision?.counter ?? 1) - 1,
        epoch: event.revision?.epoch ?? "0",
        senderId: localId,
      };
    queuedPublishes.push(event);
    compactQueuedPublishes();
    return publishQueue;
  };
  const publish = (event: NusmSyncEvent<TState>) => {
    if ((!converged || flushingQueued) && event.kind === "update")
      return queueUpdate(event);
    return rawPublish(event);
  };
  const comparePeer = (
    left: { creationTime: number; phase: string },
    right: { creationTime: number; phase: string },
  ) => left.creationTime - right.creationTime;
  const earlierHydratingPeer = () => {
    const now = Date.now();
    for (const [id, peer] of peers) {
      if (
        peer.phase === "hydrating" &&
        now - peer.lastSeen <= 5000 &&
        (comparePeer(peer, { creationTime, phase: localPhase }) < 0 ||
          (comparePeer(peer, { creationTime, phase: localPhase }) === 0 &&
            id.localeCompare(localId) < 0))
      )
        return id;
    }
    return undefined;
  };
  const leaderId = () => {
    if (localPhase !== "ready" || earlierHydratingPeer()) return undefined;
    const candidates = [
      { creationTime, id: localId, phase: "ready" as const },
      ...Array.from(peers, ([id, peer]) => ({ id, ...peer })).filter(
        (peer) => peer.phase === "ready" && Date.now() - peer.lastSeen <= 5000,
      ),
    ];
    candidates.sort((a, b) => comparePeer(a, b) || a.id.localeCompare(b.id));
    return candidates[0]?.id;
  };
  const markConverged = () => {
    if (converged) return;
    converged = true;
    flushQueued();
  };
  const requestSnapshot = () => {
    if (converged || localPhase !== "ready") return;
    const leader = leaderId();
    if (!leader || leader === localId) {
      if (leader === localId) markConverged();
      return;
    }
    if (
      [...pendingRequests.values()].some(
        (request) => request.targetId === leader,
      )
    )
      return;
    const requestId = `${localId}:request:${++requestSequence}`;
    const request: {
      retries: number;
      targetId: string;
      timer?: ReturnType<typeof setTimeout>;
    } = { retries: 0, targetId: leader };
    pendingRequests.set(requestId, request);
    const send = () => {
      if (!pendingRequests.has(requestId) || disposed) return;
      void publishControl({
        creationTime,
        eventId: `${requestId}:${request.retries}`,
        kind: "request",
        requestId,
        sourceId: localId,
        storeId: options.storeId,
        targetId: request.targetId,
      });
      if (request.retries >= 4) {
        pendingRequests.delete(requestId);
        peers.delete(request.targetId);
        requestSnapshot();
        return;
      }
      request.retries += 1;
      request.timer = setTimeout(
        send,
        [50, 100, 200, 400][request.retries - 1],
      );
    };
    send();
  };
  const beginPeerHydration = () => {
    if (converged && queuedPublishes.length === 0) {
      provisionalCounter = revisionCounter;
      provisionalEpoch = revisionEpoch;
    }
    converged = false;
  };
  const announce = (phase: "hydrating" | "ready", state: TState) => {
    localPhase = phase;
    _localState = state;
    const eventId = `${localId}:ready:${phase}:${phase === "hydrating" ? Date.now() : "final"}`;
    return publishControl({
      creationTime,
      eventId,
      hydration: phase,
      kind: "ready",
      sourceId: localId,
      state,
      storeId: options.storeId,
    });
  };
  const handleReadyEvent = (event: NusmSyncEvent<TState>) => {
    if (event.creationTime === undefined || !event.sourceId) return;
    rememberPeer(event.sourceId, {
      creationTime: event.creationTime,
      lastSeen: Date.now(),
      phase: event.hydration ?? "ready",
    });
    if (localPhase !== "ready") return;
    if (event.hydration === "hydrating") {
      beginPeerHydration();
      if (_localState !== undefined) void announce("ready", _localState);
    }
    if (leaderId() === localId) markConverged();
    else requestSnapshot();
  };
  const recordServedRequest = (
    requestId: string,
    sourceId: string,
  ): NusmSyncRevision => {
    servedRequests.set(requestId, sourceId);
    pruneOldest(servedRequests, MAX_TRACKED_PROTOCOL_IDS);
    const attempt = (servedAttempts.get(requestId) ?? 0) + 1;
    servedAttempts.set(requestId, attempt);
    pruneOldest(servedAttempts, MAX_TRACKED_PROTOCOL_IDS);
    const revision = servedRevisions.get(requestId) ?? nextRevision();
    servedRevisions.set(requestId, revision);
    pruneOldest(servedRevisions, MAX_TRACKED_PROTOCOL_IDS);
    return revision;
  };
  const canServeRequest = (event: NusmSyncEvent<TState>) => {
    if (event.targetId && event.targetId !== localId) return false;
    if (localPhase !== "ready" || leaderId() !== localId) return false;
    return Boolean(options.onSnapshotRequest);
  };
  const commitServedSnapshot = (revision: NusmSyncRevision) => {
    commitRevision(revision);
    if (revision.senderId !== localId) return;
    revisionCounter = revision.counter;
    revisionEpoch = revision.epoch ?? "0";
    revisionProgress.set(localId, {
      counter: revisionCounter,
      epoch: revisionEpoch,
    });
    if (!converged && queuedPublishes.length === 0) {
      provisionalCounter = revisionCounter;
      provisionalEpoch = revisionEpoch;
    }
  };
  const handleRequestEvent = async (event: NusmSyncEvent<TState>) => {
    if (!canServeRequest(event)) return;
    const snapshotRequest = options.onSnapshotRequest;
    if (!snapshotRequest) return;
    const state = await snapshotRequest(event);
    const requestId = event.requestId ?? event.eventId;
    const snapshotRevision = recordServedRequest(requestId, event.sourceId);
    const attempt = servedAttempts.get(requestId) ?? 1;
    commitServedSnapshot(snapshotRevision);
    await publishControl({
      eventId: `${localId}:snapshot:${requestId}:${attempt}`,
      kind: "snapshot",
      requestId,
      revision: snapshotRevision,
      sourceId: localId,
      state,
      storeId: options.storeId,
      targetId: event.sourceId,
    });
  };
  const handleSnapshotEvent = async (event: NusmSyncEvent<TState>) => {
    if (event.targetId !== localId) return;
    const requestId = event.requestId ?? event.eventId;
    const request = pendingRequests.get(requestId);
    if (!request || request.targetId !== event.sourceId) return;
    const duplicate = appliedSnapshots.has(requestId);
    if (!duplicate && !validateRevision(event)) return;
    if (!duplicate) {
      const validated = await validateCandidate(event);
      if (!validated) return;
      await options.onEvent(validated);
      commitEventRevision(validated);
      rememberAppliedSnapshot(requestId);
    }
    await publishControl({
      eventId: `${localId}:ack:${requestId}`,
      kind: "ack",
      requestId,
      sourceId: localId,
      storeId: options.storeId,
      targetId: event.sourceId,
    });
  };
  const handleLeaderAck = async (event: NusmSyncEvent<TState>) => {
    const requestId = event.requestId ?? event.eventId;
    if (servedRequests.get(requestId) !== event.sourceId) return;
    servedRequests.delete(requestId);
    servedAttempts.delete(requestId);
    servedRevisions.delete(requestId);
    await publishControl({
      eventId: `${localId}:ack:${requestId}`,
      kind: "ack",
      requestId,
      sourceId: localId,
      storeId: options.storeId,
      targetId: event.sourceId,
    });
  };
  const handleFollowerAck = (event: NusmSyncEvent<TState>) => {
    const requestId = event.requestId ?? event.eventId;
    const request = pendingRequests.get(requestId);
    if (!request || request.targetId !== event.sourceId) return;
    if (request.timer) clearTimeout(request.timer);
    pendingRequests.delete(requestId);
    markConverged();
  };
  const handleAckEvent = async (event: NusmSyncEvent<TState>) => {
    if (event.targetId !== localId) return;
    if (leaderId() === localId) {
      await handleLeaderAck(event);
      return;
    }
    if (leaderId() !== event.sourceId) return;
    handleFollowerAck(event);
  };
  const handleProtocolEvent = async (
    event: NusmSyncEvent<TState>,
  ): Promise<boolean> => {
    if (event.sourceId === localId) return true;
    switch (event.kind) {
      case "ready":
        handleReadyEvent(event);
        return true;
      case "request":
        await handleRequestEvent(event);
        return true;
      case "snapshot":
        await handleSnapshotEvent(event);
        return true;
      case "ack":
        await handleAckEvent(event);
        return true;
      default:
        return false;
    }
  };
  const normalizeIncomingRevision = (event: NusmSyncEvent<TState>) => {
    if (validateRevision(event)) return event;
    if (event.kind !== "update" || !event.revision) return undefined;
    const previous = revisionProgress.get(event.revision.senderId);
    if (!previous || !snapshotProgress.has(event.revision.senderId))
      return undefined;
    if (
      previous.counter !== event.revision.counter ||
      previous.epoch !== (event.revision.epoch ?? "0")
    )
      return undefined;
    return {
      ...event,
      revision: nextRevisionAfter({
        ...previous,
        senderId: event.revision.senderId,
      }),
    };
  };
  const processIncomingEvent = async (incoming: NusmSyncEvent<TState>) => {
    if (disposed || incoming.storeId !== options.storeId) return;
    try {
      if (incoming.kind === "update") {
        const event = normalizeIncomingRevision(incoming);
        if (!event) return;
        const validated = await validateCandidate(event);
        if (!validated) return;
        await options.onEvent(validated);
        commitEventRevision(validated);
        return;
      }
      if (await handleProtocolEvent(incoming)) return;
      await options.onEvent(incoming);
    } catch (error) {
      report(error);
    }
  };
  const enqueue = (event: NusmSyncEvent<TState>): Promise<void> => {
    if (disposed || event.storeId !== options.storeId) return queue;
    if (event.sourceId === localId && event.kind === "update") return queue;
    if (!rememberEvent(seenEvents, event)) return queue;
    queue = queue.then(() => processIncomingEvent(event));
    return queue;
  };
  const startSource = async (source: NusmSyncSource<TState>) => {
    try {
      const cleanup = await source.start((event) => {
        void enqueue(event);
      }, sourceContext);
      if (typeof cleanup !== "function") return;
      if (disposed) {
        try {
          await cleanup();
        } catch (cleanupError) {
          report(cleanupError);
        }
      } else cleanups.push(cleanup);
    } catch (error) {
      if (!disposed) {
        setStatus("unavailable");
        report(toError(error));
      }
    }
  };
  const startSources = async () => {
    const startNext = async (index: number): Promise<void> => {
      if (disposed || index >= sources.length) return;
      const source = sources[index];
      if (!source) return;
      await startSource(source);
      await startNext(index + 1);
    };
    await startNext(0);
    if (disposed) return;
    if (status === "pending") setStatus("active");
  };
  const startDiscovery = () => {
    if (disposed || sources.length === 0 || discoveryTimer) return;
    let discoveryAttempt = 0;
    const mayCompleteDiscovery = () =>
      // A hydrating peer is either earlier (caught by earlierHydratingPeer)
      // or later (the local leader short-circuits discovery before this check).
      !earlierHydratingPeer();
    const scheduleDiscovery = (discover: () => void) => {
      const delay =
        discoveryAttempt < 4 ? [50, 100, 200, 400][discoveryAttempt++] : 5000;
      discoveryTimer = setTimeout(discover, delay);
    };
    const canConvergeDiscovery = () => {
      const leader = peers.size > 0 ? leaderId() : undefined;
      if (leader === localId && peers.size > 0) return true;
      return !(leader || discoveryAttempt < 4 || !mayCompleteDiscovery());
    };
    const discover = () => {
      discoveryTimer = undefined;
      if (disposed || converged) return;
      if (localPhase !== "ready") {
        discoveryTimer = setTimeout(discover, 50);
        return;
      }
      if (canConvergeDiscovery()) return markConverged();
      scheduleDiscovery(discover);
    };
    discoveryTimer = setTimeout(discover, 50);
  };
  const start = async () => {
    if (started) return started;
    started = (async () => {
      if (disposed || sources.length === 0) return;
      await startSources();
      startDiscovery();
    })();
    return started;
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
      eventId: `adapter:${Date.now()}:${++requestSequence}`,
      generation,
      key: event.key,
      kind: "adapter",
      sourceId: "adapter",
      storeId: options.storeId,
    });
  const announceHydrating = (state: TState) => {
    localPhase = "hydrating";
    if (!hydrationHeartbeat && sources.length > 0) {
      hydrationHeartbeat = setInterval(() => {
        if (localPhase === "hydrating" && !disposed)
          void announce("hydrating", state);
      }, 1000);
    }
    return announce("hydrating", state);
  };
  const announceReady = async (state: TState) => {
    localPhase = "ready";
    if (hydrationHeartbeat) {
      clearInterval(hydrationHeartbeat);
      hydrationHeartbeat = undefined;
    }
    await announce("ready", state);
    if (leaderId() && leaderId() !== localId) requestSnapshot();
    else if (peers.size > 0 && leaderId() === localId) markConverged();
  };
  const waitForConvergence = async () => {
    if (sources.length === 0 || status === "unavailable" || converged) return;
    await new Promise<void>((resolve) => convergenceWaiters.push(resolve));
  };
  const localRevisionBase = (): NusmSyncRevision => {
    const knownLocalRevision = revisionProgress.get(localId);
    const knownLocalCounter =
      knownLocalRevision?.epoch === revisionEpoch
        ? knownLocalRevision.counter
        : 0;
    return converged
      ? {
          counter:
            knownLocalRevision?.epoch === revisionEpoch
              ? Math.max(revisionCounter, knownLocalRevision.counter)
              : revisionCounter,
          epoch: revisionEpoch,
          senderId: localId,
        }
      : {
          counter:
            provisionalEpoch === revisionEpoch
              ? Math.max(provisionalCounter, revisionCounter, knownLocalCounter)
              : provisionalCounter,
          epoch: provisionalEpoch,
          senderId: localId,
        };
  };
  const nextRevision = () => {
    const previous = localRevisionBase();
    const next = nextRevisionAfter(previous);
    if (converged) {
      revisionCounter = next.counter;
      revisionEpoch = next.epoch ?? "0";
      revisionProgress.set(localId, {
        counter: revisionCounter,
        epoch: revisionEpoch,
      });
    } else {
      provisionalCounter = next.counter;
      provisionalEpoch = next.epoch ?? "0";
    }
    return {
      counter: next.counter,
      epoch: next.epoch ?? "0",
      senderId: localId,
    };
  };
  const runCleanup = async (
    task: () => void | Promise<void>,
    failures: unknown[],
  ) => {
    try {
      await task();
    } catch (error) {
      failures.push(error);
      report(error);
    }
  };
  const clearCoordinatorState = () => {
    if (discoveryTimer) clearTimeout(discoveryTimer);
    if (hydrationHeartbeat) clearInterval(hydrationHeartbeat);
    discoveryTimer = undefined;
    hydrationHeartbeat = undefined;
    setStatus("disposed");
    pendingWrites.clear();
    for (const request of pendingRequests.values())
      if (request.timer) clearTimeout(request.timer);
    pendingRequests.clear();
    for (const resolve of convergenceWaiters.splice(0)) resolve();
    seenEvents.clear();
    queue = Promise.resolve();
    publishQueue = Promise.resolve();
  };
  const disposeResources = async () => {
    const failures: unknown[] = [];
    const cleanupTasks = cleanups.splice(0);
    const runCleanups = async (index: number): Promise<void> => {
      if (index >= cleanupTasks.length) return;
      const cleanup = cleanupTasks[index];
      if (!cleanup) return;
      await runCleanup(cleanup, failures);
      await runCleanups(index + 1);
    };
    const disposeSources = async (index: number): Promise<void> => {
      if (index >= sources.length) return;
      const source = sources[index];
      if (!source) return;
      await runCleanup(() => source.dispose?.(sourceContext), failures);
      await disposeSources(index + 1);
    };
    await runCleanups(0);
    await disposeSources(0);
    if (failures.length > 0) throw new AggregateError(failures);
  };
  const dispose = async () => {
    if (disposed) return queue;
    disposed = true;
    clearCoordinatorState();
    await disposeResources();
  };
  const waitForIdle = async (includePublishes = true) => {
    while (true) {
      const pendingEvents = queue;
      const pendingPublishes = includePublishes ? publishQueue : undefined;
      await Promise.all([pendingEvents, pendingPublishes]);
      if (
        pendingEvents === queue &&
        (!includePublishes || pendingPublishes === publishQueue)
      )
        return;
    }
  };

  return {
    announceHydrating,
    announceReady,
    dispose,
    enqueue,
    enqueueAdapterEvent,
    hasPendingWrites: () =>
      Array.from(pendingWrites.values()).some((entries) =>
        entries.some((entry) => entry.active > 0),
      ),
    isConverged: () => converged,
    isPendingWrite: (key) => {
      return Boolean(pendingWrites.get(key)?.some((entry) => entry.active > 0));
    },
    matchesPendingWrite,
    nextRevision,
    publish,
    recordPendingWrite,
    start,
    get status() {
      return status;
    },
    waitForConvergence,
    waitForIdle,
  };
};
