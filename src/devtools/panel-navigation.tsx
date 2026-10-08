import {
  Activity,
  ChevronRight,
  Cpu,
  Database,
  Info,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { NusmLogo } from "./nusm-logo.js";
import {
  AdapterGlyph,
  describeAdapter,
  describeInstance,
  snapshotHealth,
  type View,
} from "./panel-view.js";
import type { NusmDevtoolsSnapshot } from "../types.js";
import type { NusmDevtoolsCommandInput, NusmDevtoolsPath } from "./types.js";
import type { EditorState } from "./panel-editor.js";

type Emit = (command: NusmDevtoolsCommandInput) => void;

export const PanelNavigation = ({
  view,
  snapshots,
  stores,
  selectedInstanceId,
  setSelectedInstanceId,
  setEditor,
  setView,
  setSelectedPath,
  storeQuery,
  setStoreQuery,
  emit,
}: {
  view: View;
  snapshots: Map<string, NusmDevtoolsSnapshot>;
  stores: NusmDevtoolsSnapshot[];
  selectedInstanceId: string | undefined;
  setSelectedInstanceId: Dispatch<SetStateAction<string | undefined>>;
  setEditor: Dispatch<SetStateAction<EditorState | undefined>>;
  setView: Dispatch<SetStateAction<View>>;
  setSelectedPath: Dispatch<SetStateAction<NusmDevtoolsPath>>;
  storeQuery: string;
  setStoreQuery: Dispatch<SetStateAction<string>>;
  emit: Emit;
}) => {
  const nav = [
    ["overview", Database, "Stores"],
    ["timeline", Activity, "Timeline"],
    ["about", Info, "About"],
  ] as const;
  return (
    <>
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
            <NusmLogo aria-label="nusm inspector logo" height={18} width={26} />
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
          <div className="nusm-section-label">Connected · {stores.length}</div>
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
    </>
  );
};

export const PanelToolbar = ({
  tabs,
  view,
  panelId,
  selectedAdapterName,
  selectedInstanceId,
  selectedStoreId,
  mutationsDisabled,
  emit,
  onOpenEditor,
  setView,
  setSelectedPath,
}: {
  tabs: View[];
  view: View;
  panelId: string;
  selectedAdapterName: string | undefined;
  selectedInstanceId: string | undefined;
  selectedStoreId: string | undefined;
  mutationsDisabled: boolean;
  emit: Emit;
  onOpenEditor: (mode: "add" | "edit" | "raw" | "remove") => void;
  setView: Dispatch<SetStateAction<View>>;
  setSelectedPath: Dispatch<SetStateAction<NusmDevtoolsPath>>;
}) => {
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
  return (
    <div
      aria-label="Store data locations"
      className="nusm-toolbar"
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const active = view === tab;
        const tabId = `nusm-tab-${panelId}-${tab}`;
        const panelIdValue = `nusm-panel-${panelId}-${tab}`;
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
              const nextIndex = resolveTabIndex(event.key, index, tabs.length);
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
              ) : tab === "persisted" && selectedAdapterName ? (
                <AdapterGlyph
                  size={13}
                  snapshot={{ adapterName: selectedAdapterName }}
                />
              ) : tab === "timeline" ? (
                <Activity aria-hidden="true" size={13} />
              ) : tab === "about" ? (
                <Info aria-hidden="true" size={13} />
              ) : (
                <Database aria-hidden="true" size={13} />
              )}
              {tab === "persisted" ? selectedAdapterName : tab}
            </span>
          </button>
        );
      })}
      <span className="nusm-toolbar-spacer" />
      {selectedInstanceId !== undefined && selectedStoreId !== undefined && (
        <>
          <button
            className="nusm-btn"
            onClick={() =>
              emit({
                action: "refresh",
                instanceId: selectedInstanceId,
                storeId: selectedStoreId,
              })
            }
            type="button"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            className="nusm-btn"
            disabled={mutationsDisabled}
            onClick={() => onOpenEditor("add")}
            type="button"
          >
            <Plus size={13} /> Add
          </button>
        </>
      )}
    </div>
  );
};
