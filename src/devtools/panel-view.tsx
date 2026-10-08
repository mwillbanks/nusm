import {
  Braces,
  Clipboard,
  Cpu,
  Database,
  HardDrive,
  Clock3,
  Pencil,
  Search,
  Trash2,
  ChevronRight,
  Boxes,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { NusmDevtoolsSnapshot, NusmEvent } from "../types.js";
import { flattenValue, formatPath, previewValue } from "./panel-model.js";
import type { NusmDevtoolsLocation, NusmDevtoolsPath } from "./types.js";
import { stringifyForDevtools } from "./serialize.js";

export type View = "about" | "memory" | "overview" | "persisted" | "timeline";
export type RetainedEvent = NusmEvent & { devtoolsEventId: string };
type ValueRow = ReturnType<typeof flattenValue>[number];

export const describeAdapter = (snapshot: NusmDevtoolsSnapshot) =>
  snapshot.adapterName ?? "memory only";

export const describeInstance = (snapshot: NusmDevtoolsSnapshot) => {
  const prefix = "nusm-instance-";
  return snapshot.instanceId.startsWith(prefix)
    ? `instance ${snapshot.instanceId.slice(prefix.length)}`
    : `instance ${snapshot.instanceId}`;
};

export const AdapterGlyph = ({
  snapshot,
  size = 14,
}: {
  snapshot: Pick<NusmDevtoolsSnapshot, "adapterName">;
  size?: number;
}) => {
  const name = snapshot.adapterName?.toLowerCase();
  if (!name) return <Cpu aria-hidden="true" size={size} />;
  if (name.includes("local"))
    return <HardDrive aria-hidden="true" size={size} />;
  if (name.includes("session"))
    return <Clock3 aria-hidden="true" size={size} />;
  if (name.includes("index"))
    return <Database aria-hidden="true" size={size} />;
  return <Boxes aria-hidden="true" size={size} />;
};

export const snapshotHealth = (snapshot: NusmDevtoolsSnapshot) => {
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
    const result = Reflect.ownKeys(value).filter((key) => {
      if (typeof key !== "string" || key === "length") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true;
    }).length;
    return result;
  } catch {
    return undefined;
  }
};

type WorkspaceProps = {
  selected: NusmDevtoolsSnapshot;
  view: View;
  panelId: string;
  events: Map<string, RetainedEvent[]>;
  location: NusmDevtoolsLocation;
  visibleValue: unknown;
  valueQuery: string;
  setValueQuery: Dispatch<SetStateAction<string>>;
  rows: ValueRow[];
  selectedPath: NusmDevtoolsPath;
  setSelectedPath: Dispatch<SetStateAction<NusmDevtoolsPath>>;
  selectedRow: ValueRow | undefined;
  setInspectionDepth: Dispatch<SetStateAction<number>>;
  setInspectionLimit: Dispatch<SetStateAction<number>>;
  mutationsDisabled: boolean;
  onCopyValue: (label: string, value: unknown) => void;
  onOpenEditor: (
    mode: "add" | "edit" | "raw" | "remove",
    path?: NusmDevtoolsPath,
  ) => void;
  onViewChange: (view: View) => void;
};

const PanelOverview = ({
  selected,
  panelId,
  onViewChange,
}: Pick<WorkspaceProps, "selected" | "panelId" | "onViewChange">) => (
  <div
    aria-labelledby={`nusm-tab-${panelId}-overview`}
    id={`nusm-panel-${panelId}-overview`}
    role="tabpanel"
  >
    <div className="nusm-content">
      <div className="nusm-browser">
        <div className="nusm-empty">
          <div>
            <Database size={25} />
            <h3>
              {countRootDataKeys(selected.memory) ?? "Unknown"} memory keys
            </h3>
            <p>
              {selected.adapterName
                ? `Persisted through ${selected.adapterName}`
                : "Ephemeral memory store"}
            </p>
            <button
              className="nusm-btn primary"
              onClick={() => onViewChange("memory")}
              type="button"
            >
              Inspect memory
            </button>
          </div>
        </div>
      </div>
      <div className="nusm-inspector">
        <h3>Store health</h3>
        <p className="nusm-path">{snapshotHealth(selected).label}</p>
        <pre className="nusm-code">
          {stringifyForDevtools({
            pendingKeys: selected.pendingKeys ?? [],
            persistenceStrategy: selected.persistenceStrategy ?? "none",
            synchronizationStatus: selected.synchronizationStatus ?? "disabled",
          })}
        </pre>
      </div>
    </div>
  </div>
);

const PanelValues = ({
  location,
  visibleValue,
  valueQuery,
  setValueQuery,
  rows,
  selectedPath,
  setSelectedPath,
  selectedRow,
  setInspectionDepth,
  setInspectionLimit,
  mutationsDisabled,
  onCopyValue,
  onOpenEditor,
  panelId,
}: Pick<
  WorkspaceProps,
  | "location"
  | "visibleValue"
  | "valueQuery"
  | "setValueQuery"
  | "rows"
  | "selectedPath"
  | "setSelectedPath"
  | "selectedRow"
  | "setInspectionDepth"
  | "setInspectionLimit"
  | "mutationsDisabled"
  | "onCopyValue"
  | "onOpenEditor"
  | "panelId"
>) => (
  <div
    aria-labelledby={`nusm-tab-${panelId}-${location}`}
    id={`nusm-panel-${panelId}-${location}`}
    role="tabpanel"
  >
    <div className="nusm-content">
      <div className="nusm-browser">
        <div className="nusm-browser-head">
          <label className="nusm-search">
            <Search size={14} />
            <input
              aria-label="Search keys and values"
              className="nusm-input"
              onChange={(event) => setValueQuery(event.target.value)}
              placeholder="Search paths and values…"
              value={valueQuery}
            />
          </label>
          <button
            aria-label="Copy location"
            className="nusm-btn"
            onClick={() => onCopyValue(`${location} location`, visibleValue)}
            type="button"
          >
            <Clipboard size={13} /> Copy location
          </button>
          <button
            aria-label="Edit raw JSON"
            className="nusm-btn"
            disabled={mutationsDisabled}
            onClick={() => onOpenEditor("raw")}
            type="button"
          >
            <Braces size={13} /> Raw
          </button>
        </div>
        <ul aria-label="Store values">
          {rows.map((row) => (
            <li key={`${formatPath(row.path)}:${row.truncated ?? "value"}`}>
              <button
                aria-pressed={
                  !row.truncated &&
                  formatPath(selectedPath) === formatPath(row.path)
                }
                className="nusm-row"
                onClick={() => {
                  if (row.truncated === "nodes") {
                    setInspectionLimit((current) => current + 2_000);
                    return;
                  }
                  if (row.truncated === "depth") {
                    setInspectionDepth((current) => current + 16);
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
                <span className="nusm-value">{row.preview}</span>
                <span className="nusm-kind">
                  {row.truncated ? "more" : row.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <div className="nusm-empty">
            {valueQuery
              ? "No paths match this filter"
              : "This location is empty"}
          </div>
        )}
      </div>
      <aside className={`nusm-inspector ${selectedRow ? "is-open" : ""}`}>
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
            <p className="nusm-path">{formatPath(selectedRow.path)}</p>
            <div className="nusm-inspector-actions">
              <button
                className="nusm-btn"
                onClick={() => onCopyValue("value", selectedRow.value)}
                type="button"
              >
                <Clipboard size={13} /> Copy value
              </button>
              <button
                className="nusm-btn"
                disabled={mutationsDisabled}
                onClick={() => onOpenEditor("edit", selectedRow.path)}
                type="button"
              >
                <Pencil size={13} /> Edit
              </button>
              <button
                className="nusm-btn danger"
                disabled={mutationsDisabled}
                onClick={() => onOpenEditor("remove", selectedRow.path)}
                type="button"
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
            <pre className="nusm-code">
              {stringifyForDevtools(selectedRow.value)}
            </pre>
          </>
        ) : (
          <div className="nusm-empty">Select a key to inspect and edit it</div>
        )}
      </aside>
    </div>
  </div>
);

const PanelTimeline = ({
  panelId,
  events,
  selected,
}: Pick<WorkspaceProps, "panelId" | "events" | "selected">) => {
  const retained = events.get(selected.instanceId) ?? [];
  return (
    <div
      aria-labelledby={`nusm-tab-${panelId}-timeline`}
      id={`nusm-panel-${panelId}-timeline`}
      role="tabpanel"
    >
      <div className="nusm-browser">
        {retained.map((event) => (
          <div className="nusm-event" key={event.devtoolsEventId}>
            <time>{new Date(event.ts).toLocaleTimeString()}</time>
            <strong>{event.type}</strong>
            <span>
              {event.detail === undefined ? "" : previewValue(event.detail)}
            </span>
          </div>
        ))}
        {retained.length === 0 && (
          <div className="nusm-empty">State transitions will appear here</div>
        )}
      </div>
    </div>
  );
};

export const PanelWorkspace = (props: WorkspaceProps) => (
  <section className="nusm-workspace">
    <div className="nusm-summary">
      <div className="nusm-stat">
        <span>Store</span>
        <strong>
          {props.selected.storeId} · {describeInstance(props.selected)}
        </strong>
      </div>
      <div className="nusm-stat">
        <span>Adapter</span>
        <strong>{describeAdapter(props.selected)}</strong>
      </div>
      <div className="nusm-stat">
        <span>Hydration</span>
        <strong>{props.selected.hydration.overall}</strong>
      </div>
      <div className="nusm-stat">
        <span>Synchronization</span>
        <strong>{props.selected.synchronizationStatus ?? "disabled"}</strong>
      </div>
      <div className="nusm-stat">
        <span>Last write</span>
        <strong>
          {props.selected.lastFlushAt
            ? new Date(props.selected.lastFlushAt).toLocaleTimeString()
            : "—"}
        </strong>
      </div>
    </div>
    {props.view === "overview" && (
      <PanelOverview
        onViewChange={props.onViewChange}
        panelId={props.panelId}
        selected={props.selected}
      />
    )}
    {(props.view === "memory" || props.view === "persisted") && (
      <PanelValues
        location={props.location}
        mutationsDisabled={props.mutationsDisabled}
        onCopyValue={props.onCopyValue}
        onOpenEditor={props.onOpenEditor}
        panelId={props.panelId}
        rows={props.rows}
        selectedPath={props.selectedPath}
        selectedRow={props.selectedRow}
        setInspectionDepth={props.setInspectionDepth}
        setInspectionLimit={props.setInspectionLimit}
        setSelectedPath={props.setSelectedPath}
        setValueQuery={props.setValueQuery}
        valueQuery={props.valueQuery}
        visibleValue={props.visibleValue}
      />
    )}
    {props.view === "timeline" && <PanelTimeline {...props} />}
  </section>
);
