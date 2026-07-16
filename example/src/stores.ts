import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
} from "nusm";

type Task = { id: string; title: string; done: boolean; owner: string };

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
  },
);

export const sessionStore = createNusmStore(
  { activeView: "command-center", drafts: 2, lastCommand: "⌘ K" },
  {
    adapter: createSessionStorageAdapter(),
    devtools: { name: "Live Session" },
    persist: { strategy: "entire" },
    storeId: "live-session",
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
  },
);

export const storesReady = Promise.all([
  workspaceStore.ready,
  preferencesStore.ready,
  sessionStore.ready,
  activityStore.ready,
]);
