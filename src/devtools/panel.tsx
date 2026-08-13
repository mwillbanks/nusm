import type { TanStackDevtoolsPluginProps } from "@tanstack/devtools";
import {
  Activity,
  Boxes,
  Braces,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Cpu,
  Database,
  HardDrive,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NusmDevtoolsSnapshot, NusmEvent } from "../types.js";
import { NusmLogo } from "./nusm-logo.js";
import {
  flattenValue,
  formatPath,
  parsePath,
  previewValue,
} from "./panel-model.js";
import {
  getNusmDevtoolsClient,
  parseNusmDevtoolsCommandResult,
} from "./protocol.js";
import { stringifyForDevtools } from "./serialize.js";
import type {
  NusmDevtoolsCommandInput,
  NusmDevtoolsLocation,
  NusmDevtoolsPath,
} from "./types.js";

const styles = `
.nusm-dt{--bg:#090b10;--surface:#0f131b;--surface2:#151b25;--line:#273142;--text:#e8edf6;--muted:#8f9bad;--accent:#a78bfa;--accent2:#6ee7d8;--danger:#fb7185;height:100%;min-height:360px;display:grid;grid-template-columns:44px 230px minmax(0,1fr);overflow:hidden;background:var(--bg);color:var(--text);font:12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark}.nusm-dt[data-theme=light]{--bg:#f5f7fb;--surface:#fff;--surface2:#f0f3f9;--line:#dce2ec;--text:#182033;--muted:#647084;--accent:#6d28d9;--accent2:#087f72;--danger:#dc2949;color-scheme:light}.nusm-dt *{box-sizing:border-box}.nusm-rail{display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 5px;background:#07090d;border-right:1px solid var(--line)}.nusm-dt[data-theme=light] .nusm-rail{background:#e9edf5}.nusm-icon,.nusm-btn,.nusm-tab,.nusm-store,.nusm-row{border:0;color:inherit;font:inherit;cursor:pointer}.nusm-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:7px;background:transparent;color:var(--muted)}.nusm-icon:hover,.nusm-icon[aria-pressed=true]{background:var(--surface2);color:var(--accent)}.nusm-rail-spacer{flex:1}.nusm-sidebar{min-width:0;border-right:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column}.nusm-brand{height:45px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line);font-weight:700;letter-spacing:.01em}.nusm-mark{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;background:linear-gradient(135deg,var(--accent),#5b21b6);color:white}.nusm-search{position:relative;margin:10px}.nusm-search svg{position:absolute;left:9px;top:9px;color:var(--muted)}.nusm-input,.nusm-select,.nusm-editor{width:100%;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--text);font:inherit;outline:none}.nusm-input{height:32px;padding:0 9px 0 30px}.nusm-input:focus,.nusm-select:focus,.nusm-editor:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 20%,transparent)}.nusm-stores{overflow:auto;padding:0 7px 10px}.nusm-section-label{padding:7px 6px;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.nusm-store{width:100%;display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:7px;padding:7px;border-radius:7px;background:transparent;text-align:left}.nusm-store:hover,.nusm-store[aria-current=true]{background:var(--surface2)}.nusm-store strong{display:block;overflow:hidden;text-overflow:ellipsis}.nusm-store small{color:var(--muted)}.nusm-dot{width:7px;height:7px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent2) 13%,transparent)}.nusm-main{min-width:0;display:flex;flex-direction:column}.nusm-toolbar{height:45px;display:flex;align-items:center;gap:5px;padding:0 10px;border-bottom:1px solid var(--line);background:var(--surface)}.nusm-tab{height:30px;padding:0 10px;border-radius:6px;background:transparent;color:var(--muted)}.nusm-tab:hover,.nusm-tab[aria-selected=true]{background:var(--surface2);color:var(--text)}.nusm-toolbar-spacer{flex:1}.nusm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:29px;padding:0 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface2)}.nusm-btn:hover{border-color:var(--accent);color:var(--accent)}.nusm-btn.primary{border-color:transparent;background:var(--accent);color:white}.nusm-btn.danger:hover{border-color:var(--danger);color:var(--danger)}.nusm-workspace{min-height:0;flex:1;display:grid;grid-template-rows:auto minmax(0,1fr) auto}.nusm-summary{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:1px;background:var(--line);border-bottom:1px solid var(--line)}.nusm-stat{padding:10px 12px;background:var(--surface)}.nusm-stat span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.nusm-stat strong{display:block;margin-top:3px;font-size:13px;overflow:hidden;text-overflow:ellipsis}.nusm-content{min-height:0;display:grid;grid-template-columns:minmax(330px,1fr) minmax(260px,38%)}.nusm-browser{min-width:0;overflow:auto;border-right:1px solid var(--line)}.nusm-browser-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:7px 10px;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(9px);border-bottom:1px solid var(--line)}.nusm-browser-head .nusm-search{flex:1;margin:0}.nusm-row{width:100%;display:grid;grid-template-columns:minmax(140px,1fr) minmax(110px,1fr) 62px;align-items:center;min-height:31px;padding:0 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);background:transparent;text-align:left}.nusm-row:hover,.nusm-row[aria-selected=true]{background:var(--surface2)}.nusm-key{display:flex;align-items:center;gap:5px;min-width:0;font-family:ui-monospace,SFMono-Regular,monospace}.nusm-key span{overflow:hidden;text-overflow:ellipsis}.nusm-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-family:ui-monospace,SFMono-Regular,monospace}.nusm-kind{color:var(--accent);font-size:10px;text-align:right}.nusm-inspector{min-width:0;overflow:auto;background:var(--surface);padding:12px}.nusm-inspector h3{margin:0 0 3px;font-size:13px}.nusm-path{margin:0 0 12px;color:var(--muted);font:11px ui-monospace,SFMono-Regular,monospace;word-break:break-all}.nusm-code{margin:0;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);white-space:pre-wrap;word-break:break-word;font:11px/1.55 ui-monospace,SFMono-Regular,monospace}.nusm-inspector-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.nusm-event{display:grid;grid-template-columns:74px 145px 1fr;gap:10px;padding:7px 10px;border-bottom:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,monospace}.nusm-event time,.nusm-event span:last-child{color:var(--muted)}.nusm-empty{height:100%;display:grid;place-items:center;padding:30px;text-align:center;color:var(--muted)}.nusm-empty svg{margin:auto;color:var(--accent)}.nusm-status{min-height:27px;display:flex;align-items:center;gap:6px;padding:0 10px;border-top:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:11px}.nusm-status.ok{color:var(--accent2)}.nusm-drawer{position:absolute;inset:45px 0 27px auto;z-index:5;width:min(420px,75%);padding:15px;background:var(--surface);border-left:1px solid var(--line);box-shadow:-18px 0 50px #0007;overflow:auto}.nusm-drawer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.nusm-field{display:grid;gap:5px;margin:10px 0;color:var(--muted)}.nusm-field .nusm-input{padding-left:9px}.nusm-editor{min-height:190px;padding:10px;resize:vertical;font:12px/1.55 ui-monospace,SFMono-Regular,monospace}.nusm-error{color:var(--danger)}.nusm-raw{padding:10px}.nusm-raw .nusm-editor{min-height:300px}.nusm-main{position:relative}@media(max-width:760px){.nusm-dt{grid-template-columns:40px 170px minmax(0,1fr)}.nusm-content{grid-template-columns:1fr}.nusm-inspector{display:none}.nusm-summary{grid-template-columns:repeat(2,1fr)}}
`;

const responsiveStyles = `
.nusm-btn:disabled,.nusm-icon:disabled{cursor:not-allowed;opacity:.45}.nusm-inspector-close{display:none}
@media(max-width:760px){.nusm-dt{grid-template-columns:36px minmax(130px,165px) minmax(0,1fr)}.nusm-toolbar{overflow:auto}.nusm-content{position:relative;grid-template-columns:minmax(0,1fr)}.nusm-inspector{display:none}.nusm-inspector.is-open{position:absolute;inset:0;z-index:4;display:block;border-left:0}.nusm-inspector-close{display:grid;float:right}}
`;
const locationStyles = `.nusm-location{display:inline-flex;align-items:center;gap:5px}.nusm-health{width:7px;height:7px;border-radius:50%;background:var(--accent2)}.nusm-health.error{background:var(--danger)}.nusm-health.pending{background:#fbbf24}.nusm-health.warning{background:#fb923c}.nusm-browser ul{list-style:none;margin:0;padding:0}`;
type View = "about" | "memory" | "overview" | "persisted" | "timeline";

const resolveTabIndex = (
  key: string,
  currentIndex: number,
  tabCount: number,
): number | undefined => {
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  return undefined;
};
type EditorState = {
  instanceId: string;
  location: NusmDevtoolsLocation;
  mode: "add" | "edit" | "raw" | "remove";
  path: NusmDevtoolsPath;
  storeId: string;
};
type RetainedEvent = NusmEvent & { devtoolsEventId: string };
type PendingCommand = {
  action: NusmDevtoolsCommandInput["action"];
  instanceId?: string;
  storeId?: string;
  timeoutId: ReturnType<typeof setTimeout>;
};
type ParsedCommandResult = NonNullable<
  ReturnType<typeof parseNusmDevtoolsCommandResult>
>;
const matchesPendingCommand = (
  pending: PendingCommand | undefined,
  result: ParsedCommandResult,
): pending is PendingCommand =>
  Boolean(
    pending &&
      pending.action === result.action &&
      [undefined, result.instanceId].includes(pending.instanceId) &&
      [undefined, result.storeId].includes(pending.storeId),
  );

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy"))
      throw new Error("Clipboard copy is unavailable.");
  } finally {
    textarea.remove();
  }
};

const describeAdapter = (snapshot: NusmDevtoolsSnapshot) =>
  snapshot.adapterName ?? "memory only";
const describeInstance = (snapshot: NusmDevtoolsSnapshot) => {
  const prefix = "nusm-instance-";
  return snapshot.instanceId.startsWith(prefix)
    ? `instance ${snapshot.instanceId.slice(prefix.length)}`
    : `instance ${snapshot.instanceId}`;
};

const adapterGlyph = (snapshot: NusmDevtoolsSnapshot) => {
  const name = snapshot.adapterName?.toLowerCase();
  if (!name) return Cpu;
  if (name.includes("local")) return HardDrive;
  if (name.includes("session")) return Clock3;
  if (name.includes("index")) return Database;
  return Boxes;
};

const AdapterGlyph = ({
  snapshot,
  size = 14,
}: {
  snapshot: NusmDevtoolsSnapshot;
  size?: number;
}) => {
  const Glyph = adapterGlyph(snapshot);
  return <Glyph aria-hidden="true" size={size} />;
};

const snapshotHealth = (snapshot: NusmDevtoolsSnapshot) => {
  if (snapshot.hydration.overall === "error")
    return { label: "Hydration error", tone: "error" } as const;
  if (!snapshot.isReady)
    return { label: "Hydrating", tone: "pending" } as const;
  if ((snapshot.pendingKeys?.length ?? 0) > 0)
    return { label: "Persisting changes", tone: "pending" } as const;
  switch (snapshot.synchronization) {
    case "synchronized":
      return { label: "Ready and synchronized", tone: "ok" } as const;
    case "diverged":
      return { label: "Memory and adapter diverged", tone: "warning" } as const;
    case "not_applicable":
      return { label: "Memory-only store", tone: "ok" } as const;
    default:
      return { label: "Synchronization unknown", tone: "warning" } as const;
  }
};

const countRootDataKeys = (value: unknown): number | undefined => {
  if (typeof value !== "object" || value === null) return 0;
  try {
    return Reflect.ownKeys(value).filter((key) => {
      if (typeof key !== "string" || key === "length") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true;
    }).length;
  } catch {
    return undefined;
  }
};
const isReadySnapshot = (snapshot: NusmDevtoolsSnapshot | undefined) =>
  snapshot?.isReady === true;
let panelSequence = 0;
const toJson = (value: unknown) => stringifyForDevtools(value);

// fallow-ignore-next-line complexity -- devtools workspace composition keeps coordinated navigation and command state atomic.
export function NusmDevtoolsPanel({ theme }: TanStackDevtoolsPluginProps) {
  const clientRef = useRef(getNusmDevtoolsClient());
  const commandSequence = useRef(0);
  const panelId = useRef(`nusm-panel-${++panelSequence}`);
  const pendingCommands = useRef(new Map<string, PendingCommand>());
  const eventCaps = useRef(new Map<string, number>());
  const eventSequence = useRef(0);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | undefined>(undefined);
  const [snapshots, setSnapshots] = useState<Map<string, NusmDevtoolsSnapshot>>(
    new Map(),
  );
  const [events, setEvents] = useState<Map<string, RetainedEvent[]>>(new Map());
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [view, setView] = useState<View>("overview");
  const [storeQuery, setStoreQuery] = useState("");
  const [valueQuery, setValueQuery] = useState("");
  const [inspectionDepth, setInspectionDepth] = useState(16);
  const [inspectionLimit, setInspectionLimit] = useState(2_000);
  const [selectedPath, setSelectedPath] = useState<NusmDevtoolsPath>([]);
  const [editor, setEditor] = useState<EditorState>();
  const [pathDraft, setPathDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [status, setStatus] = useState("Listening for instrumented stores…");
  const [statusOk, setStatusOk] = useState(false);

  useEffect(() => {
    const client = clientRef.current;
    const stopSnapshot = client.on("snapshot", ({ payload }) => {
      const cap = Math.max(1, payload.eventLogCap ?? 100);
      eventCaps.current.set(payload.instanceId, cap);
      setEvents((current) => {
        const next = new Map(current);
        next.set(
          payload.instanceId,
          (next.get(payload.instanceId) ?? []).slice(0, cap),
        );
        return next;
      });
      setSnapshots((current) =>
        new Map(current).set(payload.instanceId, payload),
      );
      setSelectedInstanceId((current) => current ?? payload.instanceId);
      setStatus("Store snapshot received");
      setStatusOk(true);
    });
    const stopEvent = client.on("event", ({ payload }) => {
      const retained: RetainedEvent = {
        ...payload,
        devtoolsEventId: `${panelId.current}-${++eventSequence.current}`,
      };
      setEvents((current) => {
        const next = new Map(current);
        const cap = eventCaps.current.get(payload.instanceId) ?? 100;
        next.set(
          payload.instanceId,
          [retained, ...(next.get(payload.instanceId) ?? [])].slice(0, cap),
        );
        return next;
      });
    });
    const stopResult = client.on("commandResult", ({ payload }) => {
      const result = parseNusmDevtoolsCommandResult(payload);
      if (!result) return;
      const pending = pendingCommands.current.get(result.commandId);
      if (!matchesPendingCommand(pending, result)) return;
      clearTimeout(pending.timeoutId);
      pendingCommands.current.delete(result.commandId);
      setStatus(
        result.error ?? `${result.action.replaceAll("_", " ")} complete`,
      );
      setStatusOk(result.status !== "error");
      if (result.status !== "error") setEditor(undefined);
    });
    client.emit("command", {
      action: "refresh_all",
      commandId: `nusm-panel-sync-${panelId.current}-${++commandSequence.current}`,
    });
    return () => {
      for (const pending of pendingCommands.current.values())
        clearTimeout(pending.timeoutId);
      pendingCommands.current.clear();
      stopResult();
      stopEvent();
      stopSnapshot();
    };
  }, []);
  useLayoutEffect(() => {
    if (!editor) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    drawerRef.current
      ?.querySelector<HTMLElement>(
        'input, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
    return () => {
      previousFocus.current?.focus();
      previousFocus.current = undefined;
    };
  }, [editor]);

  const stores = useMemo(
    () =>
      [...snapshots.values()].filter((snapshot) =>
        `${snapshot.storeId} ${snapshot.adapterName ?? "memory"} ${snapshot.instanceId} ${describeInstance(snapshot)}`
          .toLowerCase()
          .includes(storeQuery.toLowerCase()),
      ),
    [snapshots, storeQuery],
  );
  const selected = selectedInstanceId
    ? snapshots.get(selectedInstanceId)
    : undefined;
  const mutationsDisabled = !selected?.isReady;
  const location: NusmDevtoolsLocation =
    view === "persisted" ? "persisted" : "memory";
  useEffect(() => {
    setInspectionDepth(16);
    setInspectionLimit(2_000);
  }, []);
  const visibleValue = selected
    ? location === "memory"
      ? selected.memory
      : selected.persisted
    : undefined;
  const rows = useMemo(
    () =>
      flattenValue(visibleValue, valueQuery, [], {
        maxDepth: inspectionDepth,
        maxNodes: inspectionLimit,
      }),
    [inspectionDepth, inspectionLimit, visibleValue, valueQuery],
  );
  const selectedRow = rows.find(
    (row) => formatPath(row.path) === formatPath(selectedPath),
  );

  const emit = (command: NusmDevtoolsCommandInput) => {
    const commandId = `nusm-panel-${panelId.current}-${++commandSequence.current}`;
    const timeoutId = setTimeout(() => {
      if (!pendingCommands.current.delete(commandId)) return;
      setStatus(
        `${command.action.replaceAll("_", " ")} timed out. Retry the command.`,
      );
      setStatusOk(false);
    }, 5_000);
    pendingCommands.current.set(commandId, {
      action: command.action,
      instanceId: "instanceId" in command ? command.instanceId : undefined,
      storeId: "storeId" in command ? command.storeId : undefined,
      timeoutId,
    });
    clientRef.current.emit("command", { ...command, commandId });
    setStatus(`${command.action.replaceAll("_", " ")} pending…`);
    setStatusOk(false);
  };

  const copyValue = async (label: string, value: unknown) => {
    try {
      await copyText(toJson(value));
      setStatus(`Copied ${label}`);
      setStatusOk(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusOk(false);
    }
  };

  const openEditor = (
    mode: EditorState["mode"],
    path: NusmDevtoolsPath = [],
  ) => {
    if (!selected?.isReady) {
      setStatus("Wait for hydration to finish before mutating this store.");
      setStatusOk(false);
      return;
    }
    const value =
      mode === "add"
        ? null
        : path.length === 0
          ? visibleValue
          : selectedRow?.value;
    setEditor({
      instanceId: selected.instanceId,
      location,
      mode,
      path,
      storeId: selected.storeId,
    });
    setPathDraft(mode === "add" ? "" : formatPath(path));
    setValueDraft(toJson(value));
  };

  const submitEditor = () => {
    if (!editor) return;
    const editorStore = snapshots.get(editor.instanceId);
    if (!isReadySnapshot(editorStore)) {
      setStatus("Wait for hydration to finish before mutating this store.");
      setStatusOk(false);
      return;
    }
    if (editor.mode === "remove") {
      emit({
        action: "remove_path",
        instanceId: editor.instanceId,
        location: editor.location,
        path: editor.path,
        storeId: editor.storeId,
      });
      return;
    }
    try {
      const value = JSON.parse(valueDraft);
      if (editor.mode === "raw") {
        emit(
          editor.location === "memory"
            ? {
                action: "replace_memory",
                instanceId: editor.instanceId,
                storeId: editor.storeId,
                value,
              }
            : {
                action: "replace_persisted",
                instanceId: editor.instanceId,
                storeId: editor.storeId,
                value,
              },
        );
        return;
      }
      const path = parsePath(pathDraft);
      if (path.length === 0)
        throw new Error(
          "Add and Edit require a non-root JSON path. Use Raw for whole-location replacement.",
        );
      emit({
        action: "set_path",
        instanceId: editor.instanceId,
        location: editor.location,
        path,
        storeId: editor.storeId,
        value,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusOk(false);
    }
  };

  const nav = [
    ["overview", Database, "Stores"],
    ["timeline", Activity, "Timeline"],
    ["about", Info, "About"],
  ] as const;
  const tabs = selected?.adapterName
    ? (["overview", "memory", "persisted", "timeline", "about"] as View[])
    : (["overview", "memory", "timeline", "about"] as View[]);
  const statusBar = (
    <div className={`nusm-status ${statusOk ? "ok" : ""}`}>
      <span className="nusm-location">
        {statusOk ? (
          <Check size={12} />
        ) : (
          <span
            aria-label="Waiting or command error"
            className="nusm-health pending"
            role="status"
          />
        )}
      </span>
      {status}
    </div>
  );

  return (
    <>
      <style>
        {styles}
        {responsiveStyles}
        {locationStyles}
      </style>
      <div
        className="nusm-dt"
        data-testid="nusm-devtools-panel"
        data-theme={theme}
      >
        <nav aria-label="Devtools sections" className="nusm-rail">
          {nav.map(([target, Icon, label]) => (
            <button
              aria-label={label}
              aria-pressed={view === target}
              className="nusm-icon"
              key={target}
              onClick={() => setView(target)}
              type="button"
            >
              <Icon size={16} />
            </button>
          ))}
          <span className="nusm-rail-spacer" />
          <button
            aria-label="Refresh all stores"
            className="nusm-icon"
            onClick={() => {
              for (const store of snapshots.values())
                emit({
                  action: "refresh",
                  instanceId: store.instanceId,
                  storeId: store.storeId,
                });
            }}
            type="button"
          >
            <RefreshCw size={15} />
          </button>
        </nav>
        <aside className="nusm-sidebar">
          <div className="nusm-brand">
            <span className="nusm-mark">
              <NusmLogo
                aria-label="nusm inspector logo"
                height={18}
                width={26}
              />
            </span>{" "}
            nusm inspector
          </div>
          <label className="nusm-search">
            <Search size={14} />
            <input
              aria-label="Search stores"
              className="nusm-input"
              onChange={(event) => setStoreQuery(event.target.value)}
              placeholder="Filter stores…"
              value={storeQuery}
            />
          </label>
          <div className="nusm-stores">
            <div className="nusm-section-label">
              Connected · {stores.length}
            </div>
            {stores.map((store) => (
              <button
                aria-current={selectedInstanceId === store.instanceId}
                className="nusm-store"
                key={store.instanceId}
                onClick={() => {
                  setSelectedInstanceId(store.instanceId);
                  setEditor(undefined);
                  setView((current) =>
                    current === "persisted" && !store.adapterName
                      ? "memory"
                      : current,
                  );
                  setSelectedPath([]);
                }}
                type="button"
              >
                <span
                  className="nusm-location"
                  title={snapshotHealth(store).label}
                >
                  <AdapterGlyph snapshot={store} />
                  <span
                    aria-label={snapshotHealth(store).label}
                    className={`nusm-health ${snapshotHealth(store).tone}`}
                    role="img"
                  />
                </span>
                <span>
                  <strong>{store.storeId}</strong>
                  <small>
                    {describeAdapter(store)} · {describeInstance(store)}
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
            {stores.length === 0 && (
              <div className="nusm-empty">No matching stores</div>
            )}
          </div>
        </aside>
        <main className="nusm-main">
          <div
            aria-label="Store data locations"
            className="nusm-toolbar"
            role="tablist"
          >
            {tabs.map((tab, index) => {
              const active = view === tab;
              const tabId = `nusm-tab-${panelId.current}-${tab}`;
              const panelIdValue = `nusm-panel-${panelId.current}-${tab}`;
              return (
                <button
                  aria-controls={panelIdValue}
                  aria-selected={active}
                  className="nusm-tab"
                  id={tabId}
                  key={tab}
                  onClick={() => {
                    setView(tab);
                    setSelectedPath([]);
                  }}
                  onKeyDown={(event) => {
                    const nextIndex = resolveTabIndex(
                      event.key,
                      index,
                      tabs.length,
                    );
                    if (nextIndex === undefined) return;
                    event.preventDefault();
                    const nextTab = tabs[nextIndex];
                    if (!nextTab) return;
                    setView(nextTab);
                    setSelectedPath([]);
                    const buttons =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      );
                    buttons?.[nextIndex]?.focus();
                  }}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  type="button"
                >
                  <span className="nusm-location">
                    {tab === "memory" ? (
                      <Cpu aria-hidden="true" size={13} />
                    ) : tab === "persisted" && selected ? (
                      <AdapterGlyph size={13} snapshot={selected} />
                    ) : tab === "timeline" ? (
                      <Activity aria-hidden="true" size={13} />
                    ) : tab === "about" ? (
                      <Info aria-hidden="true" size={13} />
                    ) : (
                      <Database aria-hidden="true" size={13} />
                    )}
                    {tab === "persisted" ? selected?.adapterName : tab}
                  </span>
                </button>
              );
            })}
            <span className="nusm-toolbar-spacer" />
            {selected && (
              <>
                <button
                  className="nusm-btn"
                  onClick={() =>
                    emit({
                      action: "refresh",
                      instanceId: selected.instanceId,
                      storeId: selected.storeId,
                    })
                  }
                  type="button"
                >
                  <RefreshCw size={13} /> Refresh
                </button>
                <button
                  className="nusm-btn"
                  disabled={mutationsDisabled}
                  onClick={() => openEditor("add")}
                  type="button"
                >
                  <Plus size={13} /> Add
                </button>
              </>
            )}
          </div>
          {view === "about" ? (
            <div
              aria-labelledby={`nusm-tab-${panelId.current}-about`}
              className="nusm-empty"
              id={`nusm-panel-${panelId.current}-about`}
              role="tabpanel"
            >
              <div>
                <Info size={26} />
                <h3>nusm Devtools</h3>
                <p>
                  Bidirectional state inspection powered by TanStack Devtools.
                </p>
              </div>
            </div>
          ) : !selected ? (
            <div
              aria-labelledby={`nusm-tab-${panelId.current}-${view}`}
              id={`nusm-panel-${panelId.current}-${view}`}
              role="tabpanel"
            >
              {
                <div className="nusm-empty">
                  <div>
                    <Database size={28} />
                    <h3>No instrumented stores yet</h3>
                    <p>
                      Enable <code>devtools: true</code> on a nusm store.
                    </p>
                  </div>
                </div>
              }
            </div>
          ) : (
            <section className="nusm-workspace">
              <div className="nusm-summary">
                <div className="nusm-stat">
                  <span>Store</span>
                  <strong>
                    {selected.storeId} · {describeInstance(selected)}
                  </strong>
                </div>
                <div className="nusm-stat">
                  <span>Adapter</span>
                  <strong>{describeAdapter(selected)}</strong>
                </div>
                <div className="nusm-stat">
                  <span>Hydration</span>
                  <strong>{selected.hydration.overall}</strong>
                </div>
                <div className="nusm-stat">
                  <span>Last write</span>
                  <strong>
                    {selected.lastFlushAt
                      ? new Date(selected.lastFlushAt).toLocaleTimeString()
                      : "—"}
                  </strong>
                </div>
              </div>
              {view === "overview" && (
                <div
                  aria-labelledby={`nusm-tab-${panelId.current}-overview`}
                  id={`nusm-panel-${panelId.current}-overview`}
                  role="tabpanel"
                >
                  {
                    <div className="nusm-content">
                      <div className="nusm-browser">
                        <div className="nusm-empty">
                          <div>
                            <Database size={25} />
                            <h3>
                              {countRootDataKeys(selected.memory) ?? "Unknown"}{" "}
                              memory keys
                            </h3>
                            <p>
                              {selected.adapterName
                                ? `Persisted through ${selected.adapterName}`
                                : "Ephemeral memory store"}
                            </p>
                            <button
                              className="nusm-btn primary"
                              onClick={() => setView("memory")}
                              type="button"
                            >
                              Inspect memory
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="nusm-inspector">
                        <h3>Store health</h3>
                        <p className="nusm-path">
                          {snapshotHealth(selected).label}
                        </p>
                        <pre className="nusm-code">
                          {toJson({
                            pendingKeys: selected.pendingKeys ?? [],
                            persistenceStrategy:
                              selected.persistenceStrategy ?? "none",
                          })}
                        </pre>
                      </div>
                    </div>
                  }
                </div>
              )}
              {(view === "memory" || view === "persisted") && (
                <div
                  aria-labelledby={`nusm-tab-${panelId.current}-${view}`}
                  id={`nusm-panel-${panelId.current}-${view}`}
                  role="tabpanel"
                >
                  {
                    <div className="nusm-content">
                      <div className="nusm-browser">
                        <div className="nusm-browser-head">
                          <label className="nusm-search">
                            <Search size={14} />
                            <input
                              aria-label="Search keys and values"
                              className="nusm-input"
                              onChange={(event) =>
                                setValueQuery(event.target.value)
                              }
                              placeholder="Search paths and values…"
                              value={valueQuery}
                            />
                          </label>
                          <button
                            aria-label="Copy location"
                            className="nusm-btn"
                            onClick={() =>
                              void copyValue(
                                `${location} location`,
                                visibleValue,
                              )
                            }
                            type="button"
                          >
                            <Clipboard size={13} /> Copy location
                          </button>
                          <button
                            aria-label="Edit raw JSON"
                            className="nusm-btn"
                            disabled={mutationsDisabled}
                            onClick={() => openEditor("raw")}
                            type="button"
                          >
                            <Braces size={13} /> Raw
                          </button>
                        </div>
                        {
                          <ul aria-label="Store values">
                            {rows.map((row) => (
                              <li
                                key={`${formatPath(row.path)}:${row.truncated ?? "value"}`}
                              >
                                <button
                                  aria-pressed={
                                    !row.truncated &&
                                    formatPath(selectedPath) ===
                                      formatPath(row.path)
                                  }
                                  className="nusm-row"
                                  onClick={() => {
                                    if (row.truncated === "nodes") {
                                      setInspectionLimit(
                                        (current) => current + 2_000,
                                      );
                                      return;
                                    }
                                    if (row.truncated === "depth") {
                                      setInspectionDepth(
                                        (current) => current + 16,
                                      );
                                      return;
                                    }
                                    setSelectedPath(row.path);
                                  }}
                                  type="button"
                                >
                                  <span
                                    className="nusm-key"
                                    style={{ paddingLeft: row.depth * 12 }}
                                  >
                                    <ChevronRight size={11} />
                                    <span>{row.key || "(empty key)"}</span>
                                  </span>
                                  <span className="nusm-value">
                                    {row.preview}
                                  </span>
                                  <span className="nusm-kind">
                                    {row.truncated ? "more" : row.kind}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        }
                        {rows.length === 0 && (
                          <div className="nusm-empty">
                            {valueQuery
                              ? "No paths match this filter"
                              : "This location is empty"}
                          </div>
                        )}
                      </div>
                      <aside
                        className={`nusm-inspector ${selectedRow ? "is-open" : ""}`}
                      >
                        {selectedRow ? (
                          <>
                            <button
                              aria-label="Close value inspector"
                              className="nusm-icon nusm-inspector-close"
                              onClick={() => setSelectedPath([])}
                              type="button"
                            >
                              <X size={15} />
                            </button>
                            <h3>{selectedRow.key || "(empty key)"}</h3>
                            <p className="nusm-path">
                              {formatPath(selectedRow.path)}
                            </p>
                            <div className="nusm-inspector-actions">
                              <button
                                className="nusm-btn"
                                onClick={() =>
                                  void copyValue("value", selectedRow.value)
                                }
                                type="button"
                              >
                                <Clipboard size={13} /> Copy value
                              </button>
                              <button
                                className="nusm-btn"
                                disabled={mutationsDisabled}
                                onClick={() =>
                                  openEditor("edit", selectedRow.path)
                                }
                                type="button"
                              >
                                <Pencil size={13} /> Edit
                              </button>
                              <button
                                className="nusm-btn danger"
                                disabled={mutationsDisabled}
                                onClick={() =>
                                  openEditor("remove", selectedRow.path)
                                }
                                type="button"
                              >
                                <Trash2 size={13} /> Remove
                              </button>
                            </div>
                            <pre className="nusm-code">
                              {toJson(selectedRow.value)}
                            </pre>
                          </>
                        ) : (
                          <div className="nusm-empty">
                            Select a key to inspect and edit it
                          </div>
                        )}
                      </aside>
                    </div>
                  }
                </div>
              )}
              {view === "timeline" && (
                <div
                  aria-labelledby={`nusm-tab-${panelId.current}-timeline`}
                  id={`nusm-panel-${panelId.current}-timeline`}
                  role="tabpanel"
                >
                  {
                    <div className="nusm-browser">
                      {(events.get(selected.instanceId) ?? []).map((event) => (
                        <div className="nusm-event" key={event.devtoolsEventId}>
                          <time>{new Date(event.ts).toLocaleTimeString()}</time>
                          <strong>{event.type}</strong>
                          <span>
                            {event.detail === undefined
                              ? ""
                              : previewValue(event.detail)}
                          </span>
                        </div>
                      ))}
                      {(events.get(selected.instanceId) ?? []).length === 0 && (
                        <div className="nusm-empty">
                          State transitions will appear here
                        </div>
                      )}
                    </div>
                  }
                </div>
              )}
              {}
            </section>
          )}
          {
            <>
              {statusBar}
              {editor && selected && (
                <aside
                  aria-label={`${editor.mode} value`}
                  aria-modal="true"
                  className="nusm-drawer"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditor(undefined);
                      return;
                    }
                    if (event.key !== "Tab") return;
                    const focusable = Array.from(
                      event.currentTarget.querySelectorAll<HTMLElement>(
                        'input, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
                      ),
                    );
                    const first = focusable[0];
                    const last = focusable.at(-1);
                    if (event.shiftKey && document.activeElement === first) {
                      event.preventDefault();
                      last?.focus();
                    } else if (
                      !event.shiftKey &&
                      document.activeElement === last
                    ) {
                      event.preventDefault();
                      first?.focus();
                    }
                  }}
                  ref={drawerRef}
                  role="dialog"
                >
                  <div className="nusm-drawer-head">
                    <strong>
                      {editor.mode === "add"
                        ? "Add key or item"
                        : editor.mode === "raw"
                          ? `Edit ${editor.location} JSON`
                          : editor.mode === "remove"
                            ? "Confirm removal"
                            : "Edit value"}
                    </strong>
                    <button
                      aria-label="Close editor"
                      className="nusm-icon"
                      onClick={() => setEditor(undefined)}
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {editor.mode !== "raw" && editor.mode !== "remove" && (
                    <label className="nusm-field">
                      JSON path
                      <input
                        aria-label="JSON path"
                        className="nusm-input"
                        onChange={(event) => setPathDraft(event.target.value)}
                        placeholder="profile.name or items[0]"
                        value={pathDraft}
                      />
                    </label>
                  )}
                  {editor.mode !== "remove" && (
                    <label className="nusm-field">
                      JSON value
                      <textarea
                        aria-label="JSON value"
                        className="nusm-editor"
                        onInput={(event) =>
                          setValueDraft(event.currentTarget.value)
                        }
                        value={valueDraft}
                      />
                    </label>
                  )}
                  {editor.mode === "remove" && (
                    <p className="nusm-error">
                      Remove {formatPath(editor.path)} from {editor.location}?
                      This cannot be undone.
                    </p>
                  )}
                  <div className="nusm-inspector-actions">
                    <button
                      className={`nusm-btn ${editor.mode === "remove" ? "danger" : "primary"}`}
                      disabled={mutationsDisabled}
                      onClick={submitEditor}
                      type="button"
                    >
                      {editor.mode === "remove" ? (
                        <>
                          <Trash2 size={13} /> Confirm remove
                        </>
                      ) : (
                        <>
                          <Check size={13} /> Apply change
                        </>
                      )}
                    </button>
                    {editor.location === "memory" &&
                      editor.mode !== "remove" && (
                        <button
                          className="nusm-btn"
                          disabled={mutationsDisabled}
                          onClick={() =>
                            emit({
                              action: "reset_memory",
                              instanceId: editor.instanceId,
                              storeId: editor.storeId,
                            })
                          }
                          type="button"
                        >
                          <RotateCcw size={13} /> Reset memory
                        </button>
                      )}
                  </div>
                </aside>
              )}
            </>
          }
        </main>
      </div>
    </>
  );
}
