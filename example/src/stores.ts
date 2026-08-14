import {
  configureNusm,
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
  type NusmSyncContext,
} from "nusm";

configureNusm({ crossTab: true });

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
const validateSessionCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  context.source.length > 0 &&
  isRecord(candidate) &&
  typeof candidate.activeView === "string" &&
  typeof candidate.drafts === "number";
const validateActivityCandidate = (
  candidate: unknown,
  context: NusmSyncContext,
) =>
  context.source.length > 0 &&
  isRecord(candidate) &&
  Array.isArray(candidate.events);

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
  { devtools: { eventLogCap: 150, name: "Workspace Pulse" } },
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
    crossTab: false,
    devtools: { name: "Live Session" },
    persist: { strategy: "entire" },
    storeId: "live-session",
    sync: { validator: validateSessionCandidate },
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

configureNusm({ crossTab: false });
