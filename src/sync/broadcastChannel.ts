import {
  type BroadcastProtocolLimits,
  type BroadcastWireEnvelope,
  createHmacKey,
  DEFAULT_BROADCAST_LIMITS,
  deriveChannelName,
  envelopeToEvent,
  eventToEnvelope,
  signEnvelope,
  utf8Size,
  verifyEnvelope,
} from "./protocol.js";
import type {
  NusmSyncEvent,
  NusmSyncSource,
  NusmSyncSourceContext,
  NusmSyncSourceListener,
} from "./types.js";

export type BroadcastSyncLimits = Partial<BroadcastProtocolLimits>;

export interface BroadcastChannelSyncSourceOptions {
  namespace: string;
  key: CryptoKey | Uint8Array;
  limits?: BroadcastSyncLimits;
}

type BroadcastChannelLike = {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
};

type BroadcastChannelConstructor = new (name: string) => BroadcastChannelLike;

type PeerState = {
  identities: Set<string>;
};

type ChannelEntry = {
  channel: BroadcastChannelLike;
  listeners: Map<NusmSyncSourceListener, NusmSyncSourceContext>;
  peers: Map<string, PeerState>;
  errors: number[];
  invalidCount: number;
  quarantineUntil: number;
  sequence: number;
  active: boolean;
  inbound: Promise<void>;
};

const textEncoder = new TextEncoder();

const resolveLimits = (
  limits?: BroadcastSyncLimits,
): BroadcastProtocolLimits => {
  const resolved = { ...DEFAULT_BROADCAST_LIMITS };
  const hardMaxima: BroadcastProtocolLimits = DEFAULT_BROADCAST_LIMITS;
  for (const key of Object.keys(hardMaxima) as Array<
    keyof BroadcastProtocolLimits
  >) {
    const value = limits?.[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
      throw new Error(
        `Synchronization limit ${key} must be a positive integer.`,
      );
    resolved[key] = Math.min(value, hardMaxima[key]);
  }
  return resolved;
};

const hasRealBrowserWindow = (): boolean =>
  typeof window !== "undefined" && window === globalThis;

const hasRealDocument = (): boolean =>
  typeof document !== "undefined" &&
  document.defaultView === window &&
  document.nodeType === 9 &&
  typeof document.createElement === "function";

const hasBrowserFeatures = (): boolean =>
  typeof globalThis.BroadcastChannel === "function" &&
  Boolean(globalThis.crypto?.subtle);

const browserBroadcastChannel = (): BroadcastChannelConstructor => {
  if (!hasRealBrowserWindow() || !hasRealDocument() || !hasBrowserFeatures())
    throw new Error(
      "Authenticated BroadcastChannel synchronization requires a browser Web Crypto environment.",
    );
  return globalThis.BroadcastChannel as unknown as BroadcastChannelConstructor;
};

const isString = (value: unknown): value is string => typeof value === "string";

const isIdentifier = (value: unknown, maxBytes: number): value is string =>
  isString(value) &&
  value.length > 0 &&
  textEncoder.encode(value).byteLength <= maxBytes;

const isCounter = (value: unknown): value is number =>
  value === null ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const validKinds = new Set(["request", "snapshot", "update", "ack", "ready"]);

const hasEnvelopeShape = (
  candidate: Partial<BroadcastWireEnvelope>,
  limits: BroadcastProtocolLimits,
): boolean =>
  [
    candidate.version === 1,
    isString(candidate.kind) && validKinds.has(candidate.kind),
    isIdentifier(candidate.storeId, limits.maxIdentifierBytes),
    isIdentifier(candidate.senderId, limits.maxIdentifierBytes),
    isString(candidate.epoch),
    isIdentifier(candidate.messageId, limits.maxIdentifierBytes),
    isCounter(candidate.revisionCounter),
    isString(candidate.revisionSenderId),
    isCounter(candidate.causalCounter),
    isString(candidate.causalSenderId),
    Array.isArray(candidate.changedKeys) &&
      candidate.changedKeys.length <= limits.maxChangedKeys,
    candidate.changedKeys?.every((key) =>
      isIdentifier(key, limits.maxIdentifierBytes),
    ) ?? false,
    isString(candidate.eventKey),
    isCounter(candidate.generation),
    isString(candidate.targetId),
    typeof candidate.statePresent === "boolean",
    isString(candidate.payload),
    isString(candidate.signature),
  ].every(Boolean);

const hasEnvelopeBounds = (
  candidate: BroadcastWireEnvelope,
  limits: BroadcastProtocolLimits,
): boolean =>
  [
    candidate.epoch === "" ||
      isIdentifier(candidate.epoch, limits.maxIdentifierBytes),
    !candidate.revisionSenderId ||
      isIdentifier(candidate.revisionSenderId, limits.maxIdentifierBytes),
    !candidate.causalSenderId ||
      isIdentifier(candidate.causalSenderId, limits.maxIdentifierBytes),
    !candidate.targetId ||
      isIdentifier(candidate.targetId, limits.maxIdentifierBytes),
    !candidate.eventKey ||
      isIdentifier(candidate.eventKey, limits.maxIdentifierBytes),
    candidate.statePresent
      ? utf8Size(candidate.payload) <= limits.maxStateBytes
      : candidate.payload === "",
  ].every(Boolean);

const isWireEnvelope = (
  value: unknown,
  limits: BroadcastProtocolLimits,
): value is BroadcastWireEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BroadcastWireEnvelope>;
  return (
    hasEnvelopeShape(candidate, limits) &&
    hasEnvelopeBounds(candidate as BroadcastWireEnvelope, limits)
  );
};

const reportSafely = (
  reporter: ((error: Error) => void) | undefined,
  error: Error,
) => {
  try {
    reporter?.(error);
  } catch {
    // A consumer error reporter cannot break transport recovery.
  }
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const hasValidMessageIdentity = (envelope: BroadcastWireEnvelope): boolean => {
  const prefix = `${envelope.senderId}:`;
  return (
    envelope.messageId.startsWith(prefix) &&
    envelope.messageId.length > prefix.length
  );
};

const notifyListeners = (entry: ChannelEntry, event: NusmSyncEvent) => {
  for (const listener of entry.listeners.keys()) {
    try {
      listener(event);
    } catch {
      // Listener failures belong to the coordinator and cannot affect peers.
    }
  }
};

const createSourceId = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  const random = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (random)
    return Array.from(random, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  throw new Error(
    "Web Crypto is required to create a synchronization identity.",
  );
};

const assertKeyInput = (key: CryptoKey | Uint8Array) => {
  if (key instanceof Uint8Array) {
    if (key.byteLength < 32)
      throw new Error("Synchronization keys require at least 32 random bytes.");
    return;
  }
  if (!key || typeof key !== "object")
    throw new Error("Synchronization key must be a CryptoKey or Uint8Array.");
  const candidate = key as CryptoKey;
  if (!isAcceptedHmacKey(candidate))
    throw new Error(
      "Synchronization CryptoKey must be a non-extractable HMAC-SHA-256 signing key.",
    );
};

const isAcceptedHmacKey = (candidate: CryptoKey): boolean => {
  const algorithm = candidate.algorithm as HmacKeyGenParams;
  const hashName =
    typeof algorithm?.hash === "string"
      ? algorithm.hash
      : (algorithm?.hash as { name?: string } | undefined)?.name;
  return (
    isSecretKey(candidate) &&
    algorithm?.name === "HMAC" &&
    hashName === "SHA-256" &&
    hasSigningUsages(candidate)
  );
};

const isSecretKey = (candidate: CryptoKey): boolean =>
  !candidate.extractable && candidate.type === "secret";

const hasSigningUsages = (candidate: CryptoKey): boolean =>
  candidate.usages.includes("sign") && candidate.usages.includes("verify");

/** Authenticated, bounded BroadcastChannel synchronization for identified stores. */
export const createBroadcastChannelSyncSource = <TState = unknown>(
  options: BroadcastChannelSyncSourceOptions,
): NusmSyncSource<TState> => {
  if (
    !isIdentifier(
      options.namespace,
      DEFAULT_BROADCAST_LIMITS.maxIdentifierBytes,
    )
  )
    throw new Error(
      "Synchronization namespace must be a non-empty bounded string.",
    );
  assertKeyInput(options.key);
  const limits = resolveLimits(options.limits);
  let sourceId: string | undefined;
  let keyPromise: Promise<CryptoKey> | undefined;
  const getKey = () => (keyPromise ??= createHmacKey(options.key));
  const entries = new Map<string, ChannelEntry>();
  const pendingEntries = new Map<string, Promise<ChannelEntry>>();
  const entryGenerations = new Map<string, number>();
  const getEntry = async (storeId: string): Promise<ChannelEntry> => {
    const existing = entries.get(storeId);
    if (existing) return existing;
    const pending = pendingEntries.get(storeId);
    if (pending) return pending;
    const generation = entryGenerations.get(storeId) ?? 0;
    const creation = (async () => {
      let channel: BroadcastChannelLike | undefined;
      try {
        const Constructor = browserBroadcastChannel();
        const key = await getKey();
        const channelName = await deriveChannelName(
          key,
          options.namespace,
          storeId,
        );
        channel = new Constructor(channelName);
        if ((entryGenerations.get(storeId) ?? 0) !== generation) {
          channel.close();
          throw new Error("Synchronization channel creation was disposed.");
        }
        const entry: ChannelEntry = {
          active: true,
          channel,
          errors: [],
          inbound: Promise.resolve(),
          invalidCount: 0,
          listeners: new Map(),
          peers: new Map(),
          quarantineUntil: 0,
          sequence: 0,
        };
        channel.onmessage = (messageEvent) => {
          entry.inbound = entry.inbound
            .then(() => handleMessage(entry, storeId, messageEvent.data))
            .catch((error) => reportProtocol(entry, asError(error)));
        };
        entries.set(storeId, entry);
        return entry;
      } catch (error) {
        channel?.close();
        throw error;
      }
    })();
    pendingEntries.set(storeId, creation);
    try {
      return await creation;
    } finally {
      if (pendingEntries.get(storeId) === creation)
        pendingEntries.delete(storeId);
    }
  };

  const reportProtocol = (
    entry: ChannelEntry,
    error: Error,
    countAsInvalid = true,
  ) => {
    const now = Date.now();
    entry.errors = entry.errors.filter(
      (timestamp) => now - timestamp < limits.protocolErrorWindowMs,
    );
    if (entry.errors.length < limits.maxProtocolErrors) {
      entry.errors.push(now);
      for (const context of entry.listeners.values())
        reportSafely(context.onError, error);
    }
    if (countAsInvalid) {
      entry.invalidCount += 1;
      if (entry.invalidCount >= limits.quarantineAfter)
        entry.quarantineUntil = now + limits.quarantineMs;
    }
  };

  const parseIncoming = (
    entry: ChannelEntry,
    storeId: string,
    value: unknown,
  ): BroadcastWireEnvelope | undefined => {
    let rawEnvelopeBytes: number;
    try {
      rawEnvelopeBytes = utf8Size(JSON.stringify(value));
    } catch {
      reportProtocol(
        entry,
        new Error("Synchronization envelope cannot be measured."),
      );
      return undefined;
    }
    if (rawEnvelopeBytes > limits.maxEnvelopeBytes) {
      reportProtocol(
        entry,
        new Error("Synchronization envelope exceeds its size limit."),
      );
      return undefined;
    }
    if (!isWireEnvelope(value, limits)) {
      reportProtocol(
        entry,
        new Error("Received an invalid synchronization envelope."),
      );
      return undefined;
    }
    if (value.storeId !== storeId || !hasValidMessageIdentity(value)) {
      reportProtocol(
        entry,
        new Error("Synchronization envelope identity is invalid."),
      );
      return undefined;
    }
    return value;
  };

  const handleMessage = async (
    entry: ChannelEntry,
    storeId: string,
    value: unknown,
  ) => {
    if (!entry.active || Date.now() < entry.quarantineUntil) return;
    const envelope = parseIncoming(entry, storeId, value);
    if (!envelope) return;
    if (!(await verifyIncoming(entry, envelope))) return;
    if (!entry.active) return;
    if (!rememberPeer(entry, envelope)) return;
    deliverEnvelope(entry, envelope);
  };

  const verifyIncoming = async (
    entry: ChannelEntry,
    envelope: BroadcastWireEnvelope,
  ): Promise<boolean> => {
    const key = await getKey().catch((error) => {
      reportProtocol(entry, asError(error));
      return undefined;
    });
    const valid = key
      ? await verifyEnvelope(key, envelope).catch(() => false)
      : false;
    if (valid) return true;
    reportProtocol(
      entry,
      new Error("Synchronization envelope authentication failed."),
    );
    return false;
  };

  const rememberPeer = (
    entry: ChannelEntry,
    envelope: BroadcastWireEnvelope,
  ): boolean => {
    if (envelope.senderId === sourceId) return false;
    let peer = entry.peers.get(envelope.senderId);
    if (!peer) {
      if (entry.peers.size >= limits.maxPeers) {
        reportProtocol(
          entry,
          new Error("Synchronization peer limit exceeded."),
        );
        return false;
      }
      peer = { identities: new Set() };
      entry.peers.set(envelope.senderId, peer);
    }
    const identity = `${envelope.senderId}\0${envelope.epoch}\0${envelope.messageId}`;
    if (peer.identities.has(identity)) return false;
    peer.identities.add(identity);
    if (peer.identities.size > limits.maxIdentitiesPerPeer)
      peer.identities.delete(peer.identities.values().next().value ?? identity);
    return true;
  };

  const deliverEnvelope = (
    entry: ChannelEntry,
    envelope: BroadcastWireEnvelope,
  ) => {
    try {
      const event = envelopeToEvent(envelope, limits);
      entry.invalidCount = 0;
      notifyListeners(entry, event);
    } catch (error) {
      reportProtocol(entry, asError(error));
    }
  };

  const publishEnvelope = async (
    entry: ChannelEntry,
    event: NusmSyncEvent<TState>,
  ) => {
    sourceId ??= createSourceId();
    const messageId = `${sourceId}:${++entry.sequence}`;
    if (!validOutboundIdentifiers(event, messageId))
      throw new Error("Synchronization identifiers exceed their size limit.");
    const envelope = eventToEnvelope(event, sourceId, messageId, limits);
    if (!isWireEnvelope({ ...envelope, signature: "" }, limits))
      throw new Error("Synchronization event contains invalid fields.");
    const signed = await signEnvelope(await getKey(), envelope);
    if (utf8Size(JSON.stringify(signed)) > limits.maxEnvelopeBytes)
      throw new Error("Synchronization envelope exceeds its size limit.");
    entry.channel.postMessage(signed);
  };

  const validOutboundIdentifiers = (
    event: NusmSyncEvent<TState>,
    messageId: string,
  ): boolean =>
    event.kind !== "adapter" &&
    isIdentifier(event.storeId, limits.maxIdentifierBytes) &&
    isIdentifier(messageId, limits.maxIdentifierBytes) &&
    (event.changedKeys ?? []).length <= limits.maxChangedKeys &&
    (event.changedKeys ?? []).every((key) =>
      isIdentifier(key, limits.maxIdentifierBytes),
    );

  const source: NusmSyncSource<TState> = {
    dispose: async (context) => {
      if (context?.storeId) {
        const pending = pendingEntries.get(context.storeId);
        const entry = pending
          ? await pending
              .catch(() => undefined)
              .then(async (resolved) => {
                await Promise.resolve();
                return resolved;
              })
          : entries.get(context.storeId);
        if (entry) removeContextListeners(entry, context);
        closeEmptyEntry(context.storeId);
        return;
      }
      closeAllEntries();
    },
    publish: async (event) => {
      try {
        if (!isIdentifier(event.storeId, limits.maxIdentifierBytes))
          throw new Error(
            "Synchronization identifiers exceed their size limit.",
          );
        const entry = await getEntry(event.storeId);
        await publishEnvelope(entry, event);
      } catch (error) {
        const entry = entries.get(event.storeId);
        if (entry) reportProtocol(entry, asError(error), false);
      }
    },
    get sourceId() {
      return sourceId;
    },
    start: async (listener, context) => {
      if (!context?.storeId)
        throw new Error("A storeId is required for synchronization sources.");
      if (!isIdentifier(context.storeId, limits.maxIdentifierBytes))
        throw new Error("Synchronization storeId exceeds its size limit.");
      browserBroadcastChannel();
      sourceId ??= createSourceId();
      const entry = await getEntry(context.storeId);
      entry.listeners.set(listener as NusmSyncSourceListener, context);
      return () => {
        entry.listeners.delete(listener as NusmSyncSourceListener);
        if (entry.listeners.size === 0) {
          entry.active = false;
          entry.channel.onmessage = null;
          entry.channel.close();
          entries.delete(context.storeId);
        }
      };
    },
  };
  const removeContextListeners = (
    entry: ChannelEntry,
    context: NusmSyncSourceContext,
  ) => {
    for (const [listener, listenerContext] of entry.listeners)
      if (
        listenerContext.storeId === context.storeId &&
        (!context.instanceId ||
          listenerContext.instanceId === context.instanceId)
      )
        entry.listeners.delete(listener);
  };
  const closeEmptyEntry = (storeId: string) => {
    const entry = entries.get(storeId);
    if (!entry || entry.listeners.size > 0) return;
    entry.active = false;
    entry.channel.onmessage = null;
    entry.channel.close();
    entries.delete(storeId);
  };
  const closeAllEntries = () => {
    for (const [storeId, entry] of entries) {
      entryGenerations.set(storeId, (entryGenerations.get(storeId) ?? 0) + 1);
      entry.active = false;
      entry.channel.onmessage = null;
      entry.channel.close();
      entries.delete(storeId);
    }
    for (const storeId of pendingEntries.keys())
      entryGenerations.set(storeId, (entryGenerations.get(storeId) ?? 0) + 1);
  };
  return source;
};
