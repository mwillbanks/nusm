import type { AdapterEvent } from "../types.js";

/** An ordered revision supplied by a synchronization source. */
export interface NusmSyncRevision {
  counter: number;
  senderId: string;
  /** A source may use an epoch to rotate its logical clock. */
  epoch?: string;
}

export type NusmSyncEventKind =
  | "request"
  | "snapshot"
  | "update"
  | "ack"
  | "ready"
  | "adapter";

export type NusmSyncHydrationPhase = "hydrating" | "ready";

/** The common envelope consumed by a store synchronization coordinator. */
export interface NusmSyncEvent<TState = unknown> {
  eventId: string;
  sourceId: string;
  storeId: string;
  kind: NusmSyncEventKind;
  revision?: NusmSyncRevision;
  causalRevision?: NusmSyncRevision;
  state?: TState;
  changedKeys?: readonly string[];
  key?: string;
  generation?: number;
  targetId?: string;
  adapterEvent?: AdapterEvent;
  /** Lifecycle phase carried by signed handshake events. */
  hydration?: NusmSyncHydrationPhase;
  /** Signed creation time used for deterministic leader election. */
  creationTime?: number;
  /** Correlation identity for request/snapshot/ack handshakes. */
  requestId?: string;
}

export interface NusmSyncContext {
  storeId: string;
  sourceId: string;
  kind: NusmSyncEventKind;
  revision?: NusmSyncRevision;
}

/** Context supplied when a shared source is attached to one store. */
export interface NusmSyncSourceContext {
  storeId: string;
  instanceId?: string;
  onError?: (error: unknown) => void;
}

export type NusmSyncValidationResult =
  | boolean
  | { ok: boolean; value?: unknown };

/** Validates or transforms a candidate before a remote event reaches memory. */
export type NusmSyncValidator<_TState = unknown> = (
  candidate: unknown,
  context: NusmSyncContext,
) => NusmSyncValidationResult | Promise<NusmSyncValidationResult>;

export type NusmSyncStatus =
  | "disabled"
  | "pending"
  | "active"
  | "unavailable"
  | "disposed";

export type NusmSyncSourceListener<TState = unknown> = (
  event: NusmSyncEvent<TState>,
) => void;

/** A transport-agnostic synchronization source. */
export interface NusmSyncSource<TState = unknown> {
  readonly sourceId?: string;
  start(
    listener: NusmSyncSourceListener<TState>,
    context?: NusmSyncSourceContext,
  ): void | (() => void) | Promise<undefined | (() => void)>;
  publish(event: NusmSyncEvent<TState>): void | Promise<void>;
  dispose?(context?: NusmSyncSourceContext): void | Promise<void>;
}

export type NusmSyncSourceInput<TState = unknown> =
  | NusmSyncSource<TState>
  | readonly NusmSyncSource<TState>[];

export interface NusmSyncOptions<TState = unknown> {
  source?: NusmSyncSourceInput<TState>;
  sources?: NusmSyncSourceInput<TState>;
  validator?: NusmSyncValidator<TState>;
  optimistic?: boolean;
}
