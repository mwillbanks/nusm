import {
  configureNusm,
  createBroadcastChannelSyncSource,
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
  type NusmSyncContext,
} from "nusm";

type Task = { id: string; title: string; done: boolean; owner: string };
const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);
const validatePreferencesCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  context.source.length > 0 &&
  isRecord(candidate) &&
  typeof candidate.accent === "string" &&
  typeof candidate.density === "string";
const validateActivityCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  context.source.length > 0 &&
  isRecord(candidate) &&
  Array.isArray(candidate.events);
const validateWorkspaceCandidate = (candidate: unknown) =>
  isRecord(candidate) &&
  typeof candidate.activeProject === "string" &&
  typeof candidate.commandRuns === "number" &&
  typeof candidate.focusMinutes === "number" &&
  Array.isArray(candidate.tasks);
const validateSessionCandidate = (candidate: unknown) =>
  isRecord(candidate) &&
  typeof candidate.activeView === "string" &&
  typeof candidate.drafts === "number" &&
  typeof candidate.lastCommand === "string";
const validateGlobalCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  ({
    "activity-archive": (value: unknown) =>
      isRecord(value) && Array.isArray(value.events),
    "live-session": validateSessionCandidate,
    preferences: (value: unknown) =>
      isRecord(value) &&
      typeof value.accent === "string" &&
      typeof value.density === "string" &&
      typeof value.shortcuts === "boolean" &&
      typeof value.theme === "string",
    "workspace-pulse": validateWorkspaceCandidate,
  })[context.storeId]?.(candidate) ?? false;

const shouldEnableSynchronization =
  typeof window !== "undefined" &&
  (Boolean(
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV,
  ) ||
    new URLSearchParams(window.location.search).has("sync"));

configureNusm({ sync: { validator: validateGlobalCandidate } });

if (shouldEnableSynchronization) {
  const response = await fetch("/sync-key");
  if (!response.ok)
    throw new Error("Example synchronization key is unavailable.");
  const encoded = await response.text();
  const keyBytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
  configureNusm({
    sync: {
      source: createBroadcastChannelSyncSource({
        key,
        namespace: "nusm-example",
      }),
      validator: validateGlobalCandidate,
    },
  });
}

export const workspaceStore = createNusmStore(
  {
    activeProject: "Aurora",
    commandRuns: 18,
    focusMinutes: 96,
    tasks: [
      { done: true, id: "t1", owner: "Maya", title: "Shape release narrative" },
      {
        done: false,
        id: "t2",
        owner: "Jon",
        title: "Validate adapter fallback",
      },
      { done: false, id: "t3", owner: "Rin", title: "Polish launch telemetry" },
    ] as Task[],
  },
  {
    devtools: { eventLogCap: 150, name: "Workspace Pulse" },
    storeId: "workspace-pulse",
    sync: { validator: validateGlobalCandidate },
  },
);

export const preferencesStore = createNusmStore(
  {
    accent: "violet",
    density: "comfortable",
    shortcuts: true,
    theme: "midnight",
  },
  {
    adapter: createLocalStorageAdapter(),
    devtools: { name: "Preferences" },
    persist: { strategy: "entire" },
    storeId: "preferences",
    sync: { validator: validatePreferencesCandidate },
  },
);

export const sessionStore = createNusmStore(
  { activeView: "command-center", drafts: 2, lastCommand: "⌘ K" },
  {
    adapter: createSessionStorageAdapter(),
    devtools: { name: "Live Session" },
    persist: { strategy: "entire" },
    storeId: "live-session",
    sync: false,
  },
);

export const activityStore = createNusmStore(
  {
    events: [
      {
        id: "e1",
        label: "Preferences hydrated",
        time: "just now",
        tone: "violet",
      },
      { id: "e2", label: "Session snapshot created", time: "2m", tone: "cyan" },
      {
        id: "e3",
        label: "Workspace command completed",
        time: "5m",
        tone: "green",
      },
    ],
  },
  {
    adapter: createIndexDbAdapter({
      dbName: "nusm-showcase",
      storeName: "activity",
    }),
    devtools: { name: "Activity Archive" },
    persist: { strategy: "entire" },
    storeId: "activity-archive",
    sync: { validator: validateActivityCandidate },
  },
);

export const storesReady = Promise.all([
  workspaceStore.ready,
  preferencesStore.ready,
  sessionStore.ready,
  activityStore.ready,
]);
