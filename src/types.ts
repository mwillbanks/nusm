import type { Derived, Effect, Store } from "@tanstack/store";

export type NusmPacerConfig =
  | false
  | {
      wait?: number;
      maxWait?: number;
      leading?: boolean;
      trailing?: boolean;
    };

export type { Store, Derived, Effect };

export type AdapterEventType = "set" | "remove" | "clear";

export interface AdapterEvent {
  type: AdapterEventType;
  key?: string;
}

export interface NusmAdapter {
  name: string;

  getItem(key: string): unknown | null | Promise<unknown | null>;
  setItem(key: string, value: unknown): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;

  getAllKeys?(): string[] | Promise<string[]>;
  clear?(): void | Promise<void>;

  subscribe?(listener: (event: AdapterEvent) => void): () => void;

  resolveKey?(params: {
    storeId: string;
    sliceKey?: string;
    kind: "entire" | "slice";
  }): string;

  pacer?: NusmPacerConfig;
}

export interface PersistSlice<TState> {
  key: string;
  select: (state: TState) => unknown;
  apply: (state: TState, sliceValue: unknown) => TState;
}

export interface HydrateConfig<TState> {
  validate?:
    | ((persisted: unknown) => boolean)
    | ((persisted: unknown) => { ok: boolean; value?: unknown });
  merge?: (params: { initial: TState; persisted: unknown }) => TState;
  discardPersisted?: boolean | (() => boolean);
}

export interface CreateNusmStoreOptions<TState> {
  adapter?: NusmAdapter;
  persist?: {
    strategy: "entire" | "slices";
    slices?: Array<PersistSlice<TState>>;
    hydrate?: HydrateConfig<TState>;
  };
  devtools?: boolean | { name?: string; eventLogCap?: number };
  onError?: (error: unknown) => void;
  storeId?: string;
}

export type HydrationState =
  | "not_configured"
  | "pending"
  | "hydrated"
  | "discarded"
  | "error";

export interface HydrationStatus {
  overall: HydrationState;
  byKey: Record<string, HydrationState>;
}

export type NusmEventType =
  | "hydrate_start"
  | "hydrate_discarded"
  | "hydrate_applied"
  | "hydrate_error"
  | "persist_scheduled"
  | "persist_flush_start"
  | "persist_flush_ok"
  | "persist_flush_error"
  | "adapter_external_event";

export interface NusmEvent {
  ts: number;
  type: NusmEventType;
  storeId: string;
  key?: string;
  sliceKey?: string;
  detail?: unknown;
}

export interface NusmDevtoolsSnapshot {
  storeId: string;
  memory: unknown;
  persisted?: unknown;
  hydration: HydrationStatus;
  isReady: boolean;
  pendingKeys?: string[];
  lastFlushAt?: number;
}

export interface NusmStore<TState> extends Store<TState> {
  ready: Promise<void>;
}

export interface StorageAdapterOptions {
  storage?: StorageLike;
  prefix?: string;
  serialize?: (value: unknown) => string;
  deserialize?: (raw: string) => unknown;
  pacer?: NusmPacerConfig;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear?(): void;
  key?(index: number): string | null;
  readonly length?: number;
}

export interface IndexDbAdapterOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
  serialize?: (value: unknown) => string;
  deserialize?: (raw: string) => unknown;
  pacer?: NusmPacerConfig;
}
