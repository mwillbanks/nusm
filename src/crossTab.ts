export type CrossTabRevision = {
  counter: number;
  senderId: string;
};

type CrossTabMessage = {
  kind: "request" | "snapshot" | "update";
  messageId: string;
  revision: CrossTabRevision;
  senderId: string;
  state?: unknown;
  storeId: string;
  targetId?: string;
  version: 1;
};

type BroadcastChannelLike = {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
};

type BroadcastChannelConstructor = new (name: string) => BroadcastChannelLike;

export type CrossTabTransport = {
  close(): void;
  postRequest(revision: CrossTabRevision): void;
  postSnapshot(
    state: unknown,
    revision: CrossTabRevision,
    targetId: string,
  ): void;
  postState(state: unknown, revision: CrossTabRevision): void;
};

export const compareCrossTabRevisions = (
  left: CrossTabRevision,
  right: CrossTabRevision,
): number =>
  left.counter === right.counter
    ? left.senderId.localeCompare(right.senderId)
    : left.counter - right.counter;

const isRevision = (value: unknown): value is CrossTabRevision => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.counter) &&
    (candidate.counter as number) >= 0 &&
    typeof candidate.senderId === "string" &&
    candidate.senderId.length > 0
  );
};

const isMessageKind = (value: unknown): value is CrossTabMessage["kind"] =>
  value === "request" || value === "snapshot" || value === "update";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const hasRequiredState = (candidate: Record<string, unknown>): boolean =>
  candidate.kind === "request" || Object.hasOwn(candidate, "state");

const hasValidTarget = (candidate: Record<string, unknown>): boolean =>
  candidate.kind !== "snapshot" || isNonEmptyString(candidate.targetId);

const hasValidIdentity = (candidate: Record<string, unknown>): boolean =>
  isNonEmptyString(candidate.messageId) &&
  isNonEmptyString(candidate.senderId) &&
  isNonEmptyString(candidate.storeId);

const hasValidPayload = (candidate: Record<string, unknown>): boolean =>
  isRevision(candidate.revision) &&
  hasRequiredState(candidate) &&
  hasValidTarget(candidate);

const parseMessage = (value: unknown): CrossTabMessage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !isMessageKind(candidate.kind) ||
    !hasValidIdentity(candidate) ||
    !hasValidPayload(candidate)
  )
    return undefined;
  return candidate as CrossTabMessage;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const invokeSafely = (
  operation: () => void,
  onError: (error: Error) => void,
) => {
  try {
    operation();
  } catch (error) {
    onError(toError(error));
  }
};

const rememberMessage = (seenMessages: Set<string>, messageId: string) => {
  seenMessages.add(messageId);
  if (seenMessages.size <= 1_000) return;
  const oldest = seenMessages.values().next().value;
  if (oldest) seenMessages.delete(oldest);
};

const dispatchMessage = (
  message: CrossTabMessage,
  options: {
    instanceId: string;
    onError: (error: Error) => void;
    onRequest: (requesterId: string) => void;
    onState: (
      state: unknown,
      revision: CrossTabRevision,
      kind: "snapshot" | "update",
    ) => void;
  },
) => {
  const kind = message.kind;
  if (kind === "request") {
    invokeSafely(() => options.onRequest(message.senderId), options.onError);
    return;
  }
  if (message.kind === "snapshot" && message.targetId !== options.instanceId)
    return;
  invokeSafely(
    () => options.onState(message.state, message.revision, kind),
    options.onError,
  );
};

export const getBrowserBroadcastChannel = ():
  | BroadcastChannelConstructor
  | undefined => {
  if (typeof window === "undefined") return undefined;
  const candidate = (window as unknown as { BroadcastChannel?: unknown })
    .BroadcastChannel;
  return typeof candidate === "function"
    ? (candidate as BroadcastChannelConstructor)
    : undefined;
};

export const createCrossTabTransport = (options: {
  BroadcastChannel: BroadcastChannelConstructor;
  instanceId: string;
  onError: (error: Error) => void;
  onRequest: (requesterId: string) => void;
  onState: (
    state: unknown,
    revision: CrossTabRevision,
    kind: "snapshot" | "update",
  ) => void;
  storeId: string;
}): CrossTabTransport => {
  const channel = new options.BroadcastChannel(
    `nusm:cross-tab:v1:${encodeURIComponent(options.storeId)}`,
  );
  let messageSequence = 0;
  const seenMessages = new Set<string>();
  const post = (
    kind: CrossTabMessage["kind"],
    revision: CrossTabRevision,
    state?: unknown,
    targetId?: string,
  ) => {
    const messageId = `${options.instanceId}:${++messageSequence}`;
    try {
      channel.postMessage({
        kind,
        messageId,
        revision,
        senderId: options.instanceId,
        ...(kind === "snapshot" || kind === "update" ? { state } : {}),
        storeId: options.storeId,
        ...(targetId ? { targetId } : {}),
        version: 1,
      } satisfies CrossTabMessage);
    } catch (error) {
      options.onError(toError(error));
    }
  };
  channel.onmessage = (event) => {
    const message = parseMessage(event.data);
    if (!message || message.storeId !== options.storeId) {
      options.onError(new Error("Received an invalid cross-tab message."));
      return;
    }
    if (
      message.senderId === options.instanceId ||
      seenMessages.has(message.messageId)
    )
      return;
    rememberMessage(seenMessages, message.messageId);
    dispatchMessage(message, options);
  };
  return {
    close: () => {
      channel.onmessage = null;
      channel.close();
    },
    postRequest: (revision) => post("request", revision),
    postSnapshot: (state, revision, targetId) =>
      post("snapshot", revision, state, targetId),
    postState: (state, revision) => post("update", revision, state),
  };
};
