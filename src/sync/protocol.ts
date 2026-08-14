import superjson from "superjson";
import type {
  NusmSyncEvent,
  NusmSyncEventKind,
  NusmSyncRevision,
} from "./types.js";

const BROADCAST_PROTOCOL_VERSION = 1 as const;
export interface BroadcastProtocolLimits {
  maxEnvelopeBytes: number;
  maxIdentifierBytes: number;
  maxIdentitiesPerPeer: number;
  maxPeers: number;
  maxProtocolErrors: number;
  maxStateBytes: number;
  maxChangedKeys: number;
  protocolErrorWindowMs: number;
  quarantineAfter: number;
  quarantineMs: number;
}

export const DEFAULT_BROADCAST_LIMITS: BroadcastProtocolLimits = {
  maxChangedKeys: 128,
  maxEnvelopeBytes: 512 * 1024,
  maxIdentifierBytes: 128,
  maxIdentitiesPerPeer: 128,
  maxPeers: 32,
  maxProtocolErrors: 5,
  maxStateBytes: 256 * 1024,
  protocolErrorWindowMs: 10_000,
  quarantineAfter: 20,
  quarantineMs: 30_000,
};

/** Revision counters intentionally stay within a signed 31-bit range. */
export const MAX_SYNC_REVISION_COUNTER = 0x7fffffff;
export const SYNC_REVISION_ROLLOVER_WINDOW = 4096;
export const MAX_SYNC_REVISION_EPOCH = Number.MAX_SAFE_INTEGER;

export type BroadcastWireEnvelope = {
  version: typeof BROADCAST_PROTOCOL_VERSION;
  kind: NusmSyncEventKind;
  storeId: string;
  senderId: string;
  epoch: string;
  messageId: string;
  revisionCounter: number | null;
  revisionSenderId: string;
  causalCounter: number | null;
  causalSenderId: string;
  changedKeys: string[];
  eventKey: string;
  generation: number | null;
  targetId: string;
  statePresent: boolean;
  payload: string;
  signature: string;
  hydration?: "hydrating" | "ready";
  creationTime?: number;
  requestId?: string;
};

const encoder = new TextEncoder();

export const utf8Size = (value: string): number =>
  encoder.encode(value).byteLength;

export const isValidSyncRevisionCounter = (
  counter: unknown,
): counter is number =>
  typeof counter === "number" &&
  Number.isInteger(counter) &&
  Number.isSafeInteger(counter) &&
  counter > 0 &&
  counter <= MAX_SYNC_REVISION_COUNTER - SYNC_REVISION_ROLLOVER_WINDOW;

export const isValidSyncRevisionEpoch = (epoch: unknown): epoch is string => {
  if (typeof epoch !== "string" || !/^(?:0|[1-9]\d*)$/u.test(epoch))
    return false;
  const numeric = Number(epoch);
  return Number.isSafeInteger(numeric) && numeric <= MAX_SYNC_REVISION_EPOCH;
};

const toBase64Url = (value: Uint8Array): string => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const fromBase64Url = (value: string): Uint8Array | undefined => {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(
      normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const headerValues = (
  envelope: Omit<BroadcastWireEnvelope, "signature">,
): string[] => [
  String(envelope.version),
  envelope.kind,
  envelope.storeId,
  envelope.senderId,
  envelope.epoch,
  envelope.messageId,
  envelope.revisionCounter === null ? "" : String(envelope.revisionCounter),
  envelope.revisionSenderId,
  envelope.causalCounter === null ? "" : String(envelope.causalCounter),
  envelope.causalSenderId,
  JSON.stringify(envelope.changedKeys),
  envelope.eventKey,
  envelope.generation === null ? "" : String(envelope.generation),
  envelope.targetId,
  envelope.statePresent ? "1" : "0",
  envelope.payload,
  envelope.hydration ?? "",
  envelope.creationTime === undefined ? "" : String(envelope.creationTime),
  envelope.requestId ?? "",
];

/** The signed representation has a fixed field order and exact payload text. */
const canonicalEnvelope = (
  envelope: Omit<BroadcastWireEnvelope, "signature">,
): string => JSON.stringify(headerValues(envelope));

const serializeState = (
  state: unknown,
  limits: BroadcastProtocolLimits,
): string => {
  assertSerializable(state);
  const payload = superjson.stringify(state);
  if (utf8Size(payload) > limits.maxStateBytes)
    throw new Error(
      `Synchronized state exceeds the ${limits.maxStateBytes}-byte limit.`,
    );
  return payload;
};

const assertSerializable = (
  value: unknown,
  seen = new WeakSet<object>(),
): void => {
  const type = typeof value;
  if (
    value === null ||
    value === undefined ||
    ["string", "number", "boolean", "bigint"].includes(type)
  )
    return;
  if (["function", "symbol"].includes(type) || type !== "object")
    throw new Error("Synchronized state contains a non-serializable value.");
  if (seen.has(value))
    throw new Error("Cyclic synchronized state is not supported.");
  seen.add(value);
  try {
    assertSerializableObject(value, seen);
  } finally {
    seen.delete(value);
  }
};

const assertSerializableObject = (
  value: object,
  seen: WeakSet<object>,
): void => {
  if (value instanceof Date || value instanceof RegExp || value instanceof URL)
    return;
  if (value instanceof Map) {
    assertSerializableMap(value, seen);
    return;
  }
  if (value instanceof Set) {
    assertSerializableSet(value, seen);
    return;
  }
  if (!isPlainSerializableObject(value))
    throw new Error("Synchronized state contains a non-serializable object.");
  assertSerializableProperties(value, seen);
};

const assertSerializableProperties = (
  value: object,
  seen: WeakSet<object>,
): void => {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("get" in descriptor || "set" in descriptor)
      throw new Error("Synchronized state contains an accessor property.");
    if (typeof key === "symbol")
      throw new Error("Synchronized state contains a symbol property.");
    if (Array.isArray(value) && key === "length") continue;
    assertSerializable(descriptor.value, seen);
  }
};

const isPlainSerializableObject = (value: object): boolean => {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertSerializableMap = (
  value: Map<unknown, unknown>,
  seen: WeakSet<object>,
) => {
  for (const [key, entry] of value) {
    assertSerializable(key, seen);
    assertSerializable(entry, seen);
  }
};

const assertSerializableSet = (value: Set<unknown>, seen: WeakSet<object>) => {
  for (const entry of value) assertSerializable(entry, seen);
};

const parseState = (
  payload: string,
  limits: BroadcastProtocolLimits,
): unknown => {
  if (utf8Size(payload) > limits.maxStateBytes)
    throw new Error(
      `Synchronized state exceeds the ${limits.maxStateBytes}-byte limit.`,
    );
  return superjson.parse(payload);
};

const asRevision = (
  counter: number | null,
  senderId: string,
  epoch: string,
): NusmSyncRevision | undefined =>
  counter === null
    ? undefined
    : { counter, senderId, ...(epoch ? { epoch } : {}) };

const optionalEnvelopeFields = <TState>(event: NusmSyncEvent<TState>) => {
  const fields: Partial<BroadcastWireEnvelope> = {};
  if (event.hydration) fields.hydration = event.hydration;
  if (event.creationTime !== undefined)
    fields.creationTime = event.creationTime;
  if (event.requestId) fields.requestId = event.requestId;
  return fields;
};

export const eventToEnvelope = <TState>(
  event: NusmSyncEvent<TState>,
  senderId: string,
  messageId: string,
  limits: BroadcastProtocolLimits,
): Omit<BroadcastWireEnvelope, "signature"> => {
  const statePresent = Object.hasOwn(event, "state");
  const payload = statePresent ? serializeState(event.state, limits) : "";
  const revision = event.revision;
  const causal = event.causalRevision;
  return {
    causalCounter: causal?.counter ?? null,
    causalSenderId: causal?.senderId ?? "",
    changedKeys: event.changedKeys ? [...event.changedKeys] : [],
    epoch: revision?.epoch ?? causal?.epoch ?? "",
    eventKey: event.key ?? "",
    generation: event.generation ?? null,
    kind: event.kind,
    messageId,
    payload,
    revisionCounter: revision?.counter ?? null,
    revisionSenderId: revision?.senderId ?? "",
    senderId,
    statePresent,
    storeId: event.storeId,
    targetId: event.targetId ?? "",
    version: BROADCAST_PROTOCOL_VERSION,
    ...optionalEnvelopeFields(event),
  };
};

export const envelopeToEvent = (
  envelope: BroadcastWireEnvelope,
  limits: BroadcastProtocolLimits = DEFAULT_BROADCAST_LIMITS,
): NusmSyncEvent => ({
  eventId: envelope.messageId,
  kind: envelope.kind,
  sourceId: envelope.senderId,
  storeId: envelope.storeId,
  ...(envelope.statePresent
    ? { state: parseState(envelope.payload, limits) }
    : {}),
  ...(envelope.revisionCounter === null
    ? {}
    : {
        revision: asRevision(
          envelope.revisionCounter,
          envelope.revisionSenderId,
          envelope.epoch,
        ),
      }),
  ...(envelope.causalCounter === null
    ? {}
    : {
        causalRevision: asRevision(
          envelope.causalCounter,
          envelope.causalSenderId,
          envelope.epoch,
        ),
      }),
  ...(envelope.changedKeys.length > 0
    ? { changedKeys: envelope.changedKeys }
    : {}),
  ...(envelope.eventKey ? { key: envelope.eventKey } : {}),
  ...(envelope.generation === null ? {} : { generation: envelope.generation }),
  ...(envelope.targetId ? { targetId: envelope.targetId } : {}),
  ...(envelope.hydration ? { hydration: envelope.hydration } : {}),
  ...(envelope.creationTime === undefined
    ? {}
    : { creationTime: envelope.creationTime }),
  ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
});

export const createHmacKey = async (
  input: CryptoKey | Uint8Array,
): Promise<CryptoKey> => {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.subtle) throw new Error("Web Crypto is unavailable.");
  if (input instanceof Uint8Array) {
    if (input.byteLength < 32)
      throw new Error("Synchronization keys require at least 32 random bytes.");
    return cryptoObject.subtle.importKey(
      "raw",
      new Uint8Array(input),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"],
    );
  }
  if (!input || typeof input !== "object")
    throw new Error("Synchronization key must be a CryptoKey or Uint8Array.");
  const key = input as CryptoKey;
  const algorithm = key.algorithm as HmacKeyGenParams;
  const hashName =
    typeof algorithm?.hash === "string"
      ? algorithm.hash
      : (algorithm?.hash as { name?: string } | undefined)?.name;
  if (
    key.extractable ||
    key.type !== "secret" ||
    algorithm?.name !== "HMAC" ||
    hashName !== "SHA-256" ||
    !key.usages.includes("sign") ||
    !key.usages.includes("verify")
  )
    throw new Error(
      "Synchronization CryptoKey must be a non-extractable HMAC-SHA-256 signing key.",
    );
  return key;
};

export const deriveChannelName = async (
  key: CryptoKey,
  namespace: string,
  storeId: string,
): Promise<string> => {
  const digest = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${namespace}\0${storeId}`),
  );
  return `nusm:sync:v1:${toBase64Url(new Uint8Array(digest))}`;
};

export const signEnvelope = async (
  key: CryptoKey,
  envelope: Omit<BroadcastWireEnvelope, "signature">,
): Promise<BroadcastWireEnvelope> => {
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalEnvelope(envelope)),
  );
  return { ...envelope, signature: toBase64Url(new Uint8Array(signature)) };
};

export const verifyEnvelope = async (
  key: CryptoKey,
  envelope: BroadcastWireEnvelope,
): Promise<boolean> => {
  const signature = fromBase64Url(envelope.signature);
  if (!signature) return false;
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signature as Uint8Array<ArrayBuffer>,
    encoder.encode(canonicalEnvelope(envelope)),
  );
};
