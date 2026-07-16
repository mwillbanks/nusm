import { TanStackDevtools } from "@tanstack/react-devtools";

import type { NusmStore } from "nusm";
import {
  createNoOpNusmDevtoolsPlugin,
  createNusmDevtoolsPlugin,
} from "nusm/devtools";
import { useStore } from "nusm/react";
import { useEffect, useMemo, useState } from "react";
import type { ActiveView } from "./dashboard";
import { ExampleDashboard } from "./dashboard";
import {
  activityStore,
  preferencesStore,
  sessionStore,
  workspaceStore,
} from "./stores";
import "./styles.css";

export const resolveExampleDevtoolsEnabled = (hot: unknown, search: string) =>
  Boolean(hot) || new URLSearchParams(search).has("devtools");
const devtoolsEnabled = resolveExampleDevtoolsEnabled(
  (import.meta as ImportMeta & { hot?: unknown }).hot,
  globalThis.location?.search ?? "",
);

let exampleIdSequence = 0;
const createExampleId = () => `nusm-example-${++exampleIdSequence}`;

type StoreReadiness = {
  activity: boolean;
  preferences: boolean;
  session: boolean;
  workspace: boolean;
};
type AppProps = {
  failureOverride?: Partial<StoreReadiness>;
  readinessOverride?: Partial<StoreReadiness>;
};

const ExampleDevtools = () => {
  const plugin = useMemo(
    () =>
      devtoolsEnabled
        ? createNusmDevtoolsPlugin()
        : createNoOpNusmDevtoolsPlugin(),
    [],
  );
  if (!devtoolsEnabled) return null;
  return (
    <TanStackDevtools
      config={{ defaultOpen: false, position: "bottom-right" }}
      plugins={[plugin]}
    />
  );
};

export const observeStoreReadiness = (
  store: Pick<NusmStore<unknown>, "hydration" | "isReady" | "ready">,
  onReady: () => void,
  onFailed: () => void,
) => {
  const settle = () =>
    store.hydration.overall === "error" ? onFailed() : onReady();
  if (store.isReady) {
    settle();
    return;
  }
  void store.ready.then(settle, onFailed);
};

const useExampleModel = (
  readinessOverride?: Partial<StoreReadiness>,
  failureOverride?: Partial<StoreReadiness>,
) => {
  const workspace = useStore(workspaceStore) ?? {
    activeProject: "Hydrating…",
    commandRuns: 0,
    focusMinutes: 0,
    tasks: [],
  };
  const preferences = useStore(preferencesStore) ?? { theme: "midnight" };
  const session = useStore(sessionStore) ?? { drafts: 0, lastCommand: "—" };
  const activityCount = useStore(
    activityStore,
    (state) => state?.events.length ?? 0,
  );
  const [hydrated, setHydrated] = useState<StoreReadiness>(() => ({
    activity: activityStore.isReady,
    preferences: preferencesStore.isReady,
    session: sessionStore.isReady,
    workspace: workspaceStore.isReady,
  }));
  const [failed, setFailed] = useState<StoreReadiness>({
    activity: false,
    preferences: false,
    session: false,
    workspace: false,
  });
  useEffect(() => {
    let mounted = true;
    const markReady = (key: keyof StoreReadiness) => () => {
      if (mounted)
        setHydrated((current) =>
          current[key] ? current : { ...current, [key]: true },
        );
    };
    const markFailed = (key: keyof StoreReadiness) => () => {
      if (mounted) setFailed((current) => ({ ...current, [key]: true }));
    };
    const stores = [
      ["activity", activityStore],
      ["preferences", preferencesStore],
      ["session", sessionStore],
      ["workspace", workspaceStore],
    ] as const;
    for (const [key, store] of stores) {
      observeStoreReadiness(store, markReady(key), markFailed(key));
    }
    return () => {
      mounted = false;
    };
  }, []);
  const readiness = { ...hydrated, ...readinessOverride };
  const failures = { ...failed, ...failureOverride };
  const failureCount = Object.values(failures).filter(Boolean).length;
  const readyCount = Object.values(readiness).filter(Boolean).length;
  const [query, setQuery] = useState("");
  const [activeNav, setActiveNav] = useState<"command" | "signals" | "stores">(
    "command",
  );
  const visibleTasks = useMemo(
    () =>
      workspace.tasks.filter((task) =>
        task.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, workspace.tasks],
  );
  return {
    activeNav,
    activityCount,
    failureCount,
    failures,
    preferences,
    query,
    readiness,
    readyCount,
    session,
    setActiveNav,
    setQuery,
    visibleTasks,
    workspace,
  };
};

export function App({ readinessOverride, failureOverride }: AppProps = {}) {
  const model = useExampleModel(readinessOverride, failureOverride);
  const toggleTask = (id: string) => {
    if (!model.readiness.workspace) return;
    workspaceStore.setState((state) => ({
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task,
      ),
    }));
  };
  const addTask = () => {
    if (!model.readiness.workspace) return;
    workspaceStore.setState((state) => ({
      ...state,
      tasks: [
        ...state.tasks,
        {
          done: false,
          id: createExampleId(),
          owner: "You",
          title: "Inspect the live store graph",
        },
      ],
    }));
  };
  const toggleTheme = () => {
    if (!model.readiness.preferences) return;
    preferencesStore.setState((state) => ({
      ...state,
      theme: state.theme === "midnight" ? "daylight" : "midnight",
    }));
  };
  const recordActivity = () => {
    if (!model.readiness.activity || !model.readiness.workspace) return;
    workspaceStore.setState((state) => ({
      ...state,
      commandRuns: state.commandRuns + 1,
    }));
    activityStore.setState((state) => ({
      ...state,
      events: [
        {
          id: createExampleId(),
          label: "Devtools inspection recorded",
          time: "now",
          tone: "violet",
        },
        ...state.events,
      ],
    }));
  };
  const advanceSession = () => {
    if (!model.readiness.session) return;
    sessionStore.setState((state) => ({
      ...state,
      drafts: state.drafts + 1,
      lastCommand: "Session checkpoint",
    }));
  };
  const runQuickCommand = () => {
    if (
      !model.readiness.activity ||
      !model.readiness.session ||
      !model.readiness.workspace
    )
      return;
    recordActivity();
    sessionStore.setState((state) => ({
      ...state,
      lastCommand: "Quick command",
    }));
    model.setActiveNav("signals");
  };
  const navigate = (view: ActiveView) => model.setActiveNav(view);

  return (
    <ExampleDashboard
      {...model}
      devtoolsEnabled={devtoolsEnabled}
      onAddTask={addTask}
      onAdvanceSession={advanceSession}
      onNavigate={navigate}
      onQueryChange={model.setQuery}
      onQuickCommand={runQuickCommand}
      onRecordActivity={recordActivity}
      onToggleTask={toggleTask}
      onToggleTheme={toggleTheme}
    >
      <ExampleDevtools />
    </ExampleDashboard>
  );
}
