import {
  Activity,
  ArrowUpRight,
  Check,
  CircleDot,
  Command,
  Database,
  Gauge,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { NusmLogo } from "nusm/devtools";
import type { ReactNode } from "react";
import type { preferencesStore, sessionStore, workspaceStore } from "./stores";

export type ActiveView = "command" | "signals" | "stores";
type PreferencesState = typeof preferencesStore.state;
type SessionState = typeof sessionStore.state;
type WorkspaceState = typeof workspaceStore.state;
type StoreReadiness = {
  activity: boolean;
  preferences: boolean;
  session: boolean;
  workspace: boolean;
};
type DashboardProps = {
  activeNav: ActiveView;
  activityCount: number;
  children?: ReactNode;
  devtoolsEnabled: boolean;
  failureCount: number;
  failures: StoreReadiness;
  onAddTask: () => void;
  onAdvanceSession: () => void;
  onNavigate: (view: ActiveView) => void;
  onQueryChange: (query: string) => void;
  onQuickCommand: () => void;
  onRecordActivity: () => void;
  onToggleTask: (id: string) => void;
  onToggleTheme: () => void;
  preferences: PreferencesState;
  query: string;
  readiness: StoreReadiness;
  readyCount: number;
  session: SessionState;
  visibleTasks: WorkspaceState["tasks"];
  workspace: WorkspaceState;
};

const adapters = [
  ["Workspace", "Memory", "Live", "memory", "workspace"],
  ["Preferences", "localStorage", "Synced", "local", "preferences"],
  ["Live session", "sessionStorage", "Active", "session", "session"],
  ["Activity", "IndexedDB", "Durable", "indexdb", "activity"],
] as const;

const DevtoolsCallout = ({
  enabled,
  readyCount,
}: {
  enabled: boolean;
  readyCount: number;
}) => (
  <div className="nav-callout">
    <div className="pulse">
      <Zap size={14} />
    </div>
    <strong>{enabled ? "Devtools live" : "Devtools dormant"}</strong>
    <p>
      {enabled
        ? "Open the TanStack trigger to inspect every adapter."
        : "Add ?devtools to inspect every adapter."}
    </p>
    <span aria-live="polite">
      <CircleDot size={10} /> {readyCount} of 4 stores ready
    </span>
  </div>
);

const PrimaryNavigation = ({
  active,
  activityCount,
  onNavigate,
}: {
  active: ActiveView;
  activityCount: number;
  onNavigate: (view: ActiveView) => void;
}) => (
  <nav aria-label="Primary navigation">
    <button
      aria-controls="command"
      aria-pressed={active === "command"}
      className={`nav-item ${active === "command" ? "active" : ""}`}
      onClick={() => onNavigate("command")}
      type="button"
    >
      <Gauge size={17} /> Command center
    </button>
    <button
      aria-controls="stores"
      aria-pressed={active === "stores"}
      className={`nav-item ${active === "stores" ? "active" : ""}`}
      onClick={() => onNavigate("stores")}
      type="button"
    >
      <Layers3 size={17} /> Stores <span>4</span>
    </button>
    <button
      aria-controls="signals"
      aria-pressed={active === "signals"}
      className={`nav-item ${active === "signals" ? "active" : ""}`}
      onClick={() => onNavigate("signals")}
      type="button"
    >
      <Activity size={17} /> Signals <span>{activityCount}</span>
    </button>
  </nav>
);

const Sidebar = ({
  activeNav,
  activityCount,
  onNavigate,
  onToggleTheme,
  preferences,
  readiness,
  readyCount,
  devtoolsEnabled,
}: Pick<
  DashboardProps,
  | "activeNav"
  | "activityCount"
  | "devtoolsEnabled"
  | "onNavigate"
  | "onToggleTheme"
  | "preferences"
  | "readiness"
  | "readyCount"
>) => (
  <aside className="nav-shell">
    <div className="logo">
      <NusmLogo aria-label="nusm example logo" height={20} width={38} />
      <span>nusm</span>
    </div>
    <PrimaryNavigation
      active={activeNav}
      activityCount={activityCount}
      onNavigate={onNavigate}
    />
    <DevtoolsCallout enabled={devtoolsEnabled} readyCount={readyCount} />
    <button
      aria-busy={!readiness.preferences}
      className="profile"
      disabled={!readiness.preferences}
      onClick={onToggleTheme}
      type="button"
    >
      <span>MW</span>
      <div>
        <strong>Developer mode</strong>
        <small>{preferences.theme} theme</small>
      </div>
    </button>
  </aside>
);

const CommandHeader = ({
  disabled,
  onQuickCommand,
}: {
  disabled: boolean;
  onQuickCommand: () => void;
}) => (
  <header>
    <div>
      <p className="eyebrow">STATE COMMAND CENTER</p>
      <h1>
        Everything in motion,{" "}
        <em className="hero-emphasis">beautifully visible.</em>
      </h1>
    </div>
    <button
      aria-busy={disabled}
      className="command-button"
      disabled={disabled}
      onClick={onQuickCommand}
      type="button"
    >
      <Command size={15} /> Quick command <kbd>⌘ K</kbd>
    </button>
  </header>
);

const TransitionSignal = ({
  commandRuns,
  disabled,
  onRecordActivity,
}: {
  commandRuns: number;
  disabled: boolean;
  onRecordActivity: () => void;
}) => (
  <button
    aria-busy={disabled}
    aria-label="Record IndexedDB activity"
    className="signal-card primary-card"
    disabled={disabled}
    onClick={onRecordActivity}
    type="button"
  >
    <div className="card-top">
      <span className="icon violet">
        <Zap size={16} />
      </span>
      <span className="trend">
        +14.2% <ArrowUpRight size={12} />
      </span>
    </div>
    <p>State transitions</p>
    <strong>{commandRuns}</strong>
    <div
      aria-label="Rising transition activity"
      className="sparkline"
      role="img"
    >
      {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (
        <i key={bar} />
      ))}
    </div>
  </button>
);

const AdapterSignal = ({
  failureCount,
  readyCount,
}: {
  failureCount: number;
  readyCount: number;
}) => {
  const health =
    failureCount > 0 ? "Degraded" : readyCount === 4 ? "Healthy" : "Hydrating";
  return (
    <article className="signal-card">
      <div className="card-top">
        <span className="icon cyan">
          <Database size={16} />
        </span>
        <span className="status-dot">{health}</span>
      </div>
      <p>Adapters online</p>
      <strong>
        {readyCount} <small className="metric-unit">/ 4</small>
      </strong>
      <div className="mini-list">
        <span>memory</span>
        <span>local</span>
        <span>session</span>
        <span>idb</span>
      </div>
    </article>
  );
};

const FocusSignal = ({
  disabled,
  onAdvanceSession,
  session,
  workspace,
}: Pick<DashboardProps, "onAdvanceSession" | "session" | "workspace"> & {
  disabled: boolean;
}) => (
  <button
    aria-busy={disabled}
    aria-label="Advance session workspace"
    className="signal-card focus-card"
    disabled={disabled}
    onClick={onAdvanceSession}
    type="button"
  >
    <div className="orb">
      <span>{workspace.focusMinutes}</span>
      <small>MIN</small>
    </div>
    <div className="focus-copy">
      <p>Focus current</p>
      <strong>{workspace.activeProject}</strong>
      <small>{session.drafts} drafts in this session</small>
    </div>
  </button>
);

type SignalViewProps = Pick<
  DashboardProps,
  | "failureCount"
  | "onAdvanceSession"
  | "onRecordActivity"
  | "readiness"
  | "readyCount"
  | "session"
  | "workspace"
>;

const SignalCards = (props: SignalViewProps) => (
  <>
    <TransitionSignal
      commandRuns={props.workspace.commandRuns}
      disabled={!props.readiness.activity || !props.readiness.workspace}
      onRecordActivity={props.onRecordActivity}
    />
    <AdapterSignal
      failureCount={props.failureCount}
      readyCount={props.readyCount}
    />
    <FocusSignal
      disabled={!props.readiness.session}
      onAdvanceSession={props.onAdvanceSession}
      session={props.session}
      workspace={props.workspace}
    />
  </>
);

const SignalsView = (props: SignalViewProps) => (
  <section aria-label="Signals view" className="hero-grid" id="signals">
    <SignalCards {...props} />
  </section>
);

const WorkspacePanel = (
  props: Pick<
    DashboardProps,
    | "onAddTask"
    | "onQueryChange"
    | "onToggleTask"
    | "query"
    | "readiness"
    | "visibleTasks"
  >,
) => (
  <article className="panel task-panel">
    <div className="panel-head">
      <div>
        <p className="eyebrow">MEMORY STORE</p>
        <h2>Workspace pulse</h2>
      </div>
      <button
        aria-busy={!props.readiness.workspace}
        className="add-button"
        disabled={!props.readiness.workspace}
        onClick={props.onAddTask}
        type="button"
      >
        <Plus size={14} /> Add state
      </button>
    </div>
    <label className="task-search">
      <Search size={14} />
      <input
        aria-label="Filter workspace tasks"
        onChange={(event) => props.onQueryChange(event.target.value)}
        placeholder="Filter live state…"
        value={props.query}
      />
    </label>
    <div className="tasks">
      {props.visibleTasks.map((task) => (
        <button
          aria-busy={!props.readiness.workspace}
          className="task"
          disabled={!props.readiness.workspace}
          key={task.id}
          onClick={() => props.onToggleTask(task.id)}
          type="button"
        >
          <span className={task.done ? "check checked" : "check"}>
            {task.done && <Check size={12} />}
          </span>
          <span className={task.done ? "done" : ""}>{task.title}</span>
          <small>{task.owner}</small>
        </button>
      ))}
    </div>
  </article>
);

const AdapterTopology = ({
  failureCount,
  failures,
  readiness,
  readyCount,
  devtoolsEnabled,
}: Pick<
  DashboardProps,
  "devtoolsEnabled" | "failureCount" | "failures" | "readiness" | "readyCount"
>) => {
  const liveStatus =
    failureCount > 0 ? "DEGRADED" : readyCount === 4 ? "LIVE" : "HYDRATING";
  return (
    <article className="panel adapter-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">PERSISTENCE MAP</p>
          <h2>Adapter topology</h2>
        </div>
        <span className="live-pill">
          <i /> {liveStatus}
        </span>
      </div>
      <div className="adapter-map">
        {adapters.map(([name, adapter, status, tone, key]) => (
          <div className="adapter-row" key={name}>
            <span className={`adapter-icon ${tone}`}>
              <Database size={14} />
            </span>
            <div>
              <strong>{name}</strong>
              <small>{adapter}</small>
            </div>
            <span>
              {failures[key] ? "Error" : readiness[key] ? status : "Hydrating"}
            </span>
          </div>
        ))}
      </div>
      <div className="tip">
        <Sparkles size={14} />
        <p>
          <strong>
            {devtoolsEnabled ? "Try it live." : "Opt in to inspect."}
          </strong>{" "}
          Edit memory in devtools to watch this interface react instantly;
          adapter tabs manage persisted values independently.
        </p>
      </div>
    </article>
  );
};

const StoreCards = (props: DashboardProps) => (
  <>
    <WorkspacePanel {...props} />
    <AdapterTopology {...props} />
  </>
);

const StoresView = (props: DashboardProps) => (
  <section aria-label="Stores view" className="content-grid" id="stores">
    <StoreCards {...props} />
  </section>
);

const CommandView = (props: DashboardProps) => (
  <section aria-label="Command center view" id="command">
    <div className="hero-grid">
      <SignalCards {...props} />
    </div>
    <div className="content-grid">
      <StoreCards {...props} />
    </div>
  </section>
);

const DashboardFooter = ({
  devtoolsEnabled,
  lastCommand,
}: {
  devtoolsEnabled: boolean;
  lastCommand: string;
}) => (
  <footer>
    <span className="footer-item footer-status">
      <CircleDot size={11} />{" "}
      {devtoolsEnabled
        ? "Bidirectional event bridge connected"
        : "Devtools shell disabled · append ?devtools"}
    </span>
    <span className="footer-item">Last command {lastCommand}</span>
  </footer>
);

export function ExampleDashboard(props: DashboardProps) {
  const commandDisabled =
    !props.readiness.activity ||
    !props.readiness.session ||
    !props.readiness.workspace;
  return (
    <div
      className="app"
      data-devtools={props.devtoolsEnabled ? "active" : "no-op"}
      data-theme={props.preferences.theme}
    >
      <Sidebar {...props} />
      <main className="main-shell">
        <CommandHeader
          disabled={commandDisabled}
          onQuickCommand={props.onQuickCommand}
        />
        {props.activeNav === "command" && <CommandView {...props} />}
        {props.activeNav === "stores" && <StoresView {...props} />}
        {props.activeNav === "signals" && <SignalsView {...props} />}
        <DashboardFooter
          devtoolsEnabled={props.devtoolsEnabled}
          lastCommand={props.session.lastCommand}
        />
      </main>
      {props.children}
    </div>
  );
}
