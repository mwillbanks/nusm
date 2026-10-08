import type { TanStackDevtoolsPluginProps } from "@tanstack/devtools";
import { Check, Database, Info } from "lucide-react";
import { PanelEditor } from "./panel-editor.js";
import { PanelNavigation, PanelToolbar } from "./panel-navigation.js";
import { PanelWorkspace, type View } from "./panel-view.js";
import { usePanelController } from "./panel-controller.js";

const styles = `
.nusm-dt{--bg:#090b10;--surface:#0f131b;--surface2:#151b25;--line:#273142;--text:#e8edf6;--muted:#8f9bad;--accent:#a78bfa;--accent2:#6ee7d8;--danger:#fb7185;height:100%;min-height:360px;display:grid;grid-template-columns:44px 230px minmax(0,1fr);overflow:hidden;background:var(--bg);color:var(--text);font:12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark}.nusm-dt[data-theme=light]{--bg:#f5f7fb;--surface:#fff;--surface2:#f0f3f9;--line:#dce2ec;--text:#182033;--muted:#647084;--accent:#6d28d9;--accent2:#087f72;--danger:#dc2949;color-scheme:light}.nusm-dt *{box-sizing:border-box}.nusm-rail{display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 5px;background:#07090d;border-right:1px solid var(--line)}.nusm-dt[data-theme=light] .nusm-rail{background:#e9edf5}.nusm-icon,.nusm-btn,.nusm-tab,.nusm-store,.nusm-row{border:0;color:inherit;font:inherit;cursor:pointer}.nusm-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:7px;background:transparent;color:var(--muted)}.nusm-icon:hover,.nusm-icon[aria-pressed=true]{background:var(--surface2);color:var(--accent)}.nusm-rail-spacer{flex:1}.nusm-sidebar{min-width:0;border-right:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column}.nusm-brand{height:45px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line);font-weight:700;letter-spacing:.01em}.nusm-mark{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;background:linear-gradient(135deg,var(--accent),#5b21b6);color:white}.nusm-search{position:relative;margin:10px}.nusm-search svg{position:absolute;left:9px;top:9px;color:var(--muted)}.nusm-input,.nusm-select,.nusm-editor{width:100%;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--text);font:inherit;outline:none}.nusm-input{height:32px;padding:0 9px 0 30px}.nusm-input:focus,.nusm-select:focus,.nusm-editor:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 20%,transparent)}.nusm-stores{overflow:auto;padding:0 7px 10px}.nusm-section-label{padding:7px 6px;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.nusm-store{width:100%;display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:7px;padding:7px;border-radius:7px;background:transparent;text-align:left}.nusm-store:hover,.nusm-store[aria-current=true]{background:var(--surface2)}.nusm-store strong{display:block;overflow:hidden;text-overflow:ellipsis}.nusm-store small{color:var(--muted)}.nusm-dot{width:7px;height:7px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent2) 13%,transparent)}.nusm-main{min-width:0;display:flex;flex-direction:column}.nusm-toolbar{height:45px;display:flex;align-items:center;gap:5px;padding:0 10px;border-bottom:1px solid var(--line);background:var(--surface)}.nusm-tab{height:30px;padding:0 10px;border-radius:6px;background:transparent;color:var(--muted)}.nusm-tab:hover,.nusm-tab[aria-selected=true]{background:var(--surface2);color:var(--text)}.nusm-toolbar-spacer{flex:1}.nusm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:29px;padding:0 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface2)}.nusm-btn:hover{border-color:var(--accent);color:var(--accent)}.nusm-btn.primary{border-color:transparent;background:var(--accent);color:white}.nusm-btn.danger:hover{border-color:var(--danger);color:var(--danger)}.nusm-workspace{min-height:0;flex:1;display:grid;grid-template-rows:auto minmax(0,1fr) auto}.nusm-summary{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:1px;background:var(--line);border-bottom:1px solid var(--line)}.nusm-stat{padding:10px 12px;background:var(--surface)}.nusm-stat span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.nusm-stat strong{display:block;margin-top:3px;font-size:13px;overflow:hidden;text-overflow:ellipsis}.nusm-content{min-height:0;display:grid;grid-template-columns:minmax(330px,1fr) minmax(260px,38%)}.nusm-browser{min-width:0;overflow:auto;border-right:1px solid var(--line)}.nusm-browser-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:7px 10px;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(9px);border-bottom:1px solid var(--line)}.nusm-browser-head .nusm-search{flex:1;margin:0}.nusm-row{width:100%;display:grid;grid-template-columns:minmax(140px,1fr) minmax(110px,1fr) 62px;align-items:center;min-height:31px;padding:0 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);background:transparent;text-align:left}.nusm-row:hover,.nusm-row[aria-selected=true]{background:var(--surface2)}.nusm-key{display:flex;align-items:center;gap:5px;min-width:0;font-family:ui-monospace,SFMono-Regular,monospace}.nusm-key span{overflow:hidden;text-overflow:ellipsis}.nusm-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-family:ui-monospace,SFMono-Regular,monospace}.nusm-kind{color:var(--accent);font-size:10px;text-align:right}.nusm-inspector{min-width:0;overflow:auto;background:var(--surface);padding:12px}.nusm-inspector h3{margin:0 0 3px;font-size:13px}.nusm-path{margin:0 0 12px;color:var(--muted);font:11px ui-monospace,SFMono-Regular,monospace;word-break:break-all}.nusm-code{margin:0;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);white-space:pre-wrap;word-break:break-word;font:11px/1.55 ui-monospace,SFMono-Regular,monospace}.nusm-inspector-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.nusm-event{display:grid;grid-template-columns:74px 145px 1fr;gap:10px;padding:7px 10px;border-bottom:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,monospace}.nusm-event time,.nusm-event span:last-child{color:var(--muted)}.nusm-empty{height:100%;display:grid;place-items:center;padding:30px;text-align:center;color:var(--muted)}.nusm-empty svg{margin:auto;color:var(--accent)}.nusm-status{min-height:27px;display:flex;align-items:center;gap:6px;padding:0 10px;border-top:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:11px}.nusm-status.ok{color:var(--accent2)}.nusm-drawer{margin:0;color:var(--text);border:0;position:absolute;inset:45px 0 27px auto;z-index:5;width:min(420px,75%);padding:15px;background:var(--surface);border-left:1px solid var(--line);box-shadow:-18px 0 50px #0007;overflow:auto}.nusm-drawer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.nusm-field{display:grid;gap:5px;margin:10px 0;color:var(--muted)}.nusm-field .nusm-input{padding-left:9px}.nusm-editor{min-height:190px;padding:10px;resize:vertical;font:12px/1.55 ui-monospace,SFMono-Regular,monospace}.nusm-error{color:var(--danger)}.nusm-raw{padding:10px}.nusm-raw .nusm-editor{min-height:300px}.nusm-main{position:relative}@media(max-width:760px){.nusm-dt{grid-template-columns:40px 170px minmax(0,1fr)}.nusm-content{grid-template-columns:1fr}.nusm-inspector{display:none}.nusm-summary{grid-template-columns:repeat(2,1fr)}}
`;

const responsiveStyles = `
.nusm-btn:disabled,.nusm-icon:disabled{cursor:not-allowed;opacity:.45}.nusm-inspector-close{display:none}
@media(max-width:760px){.nusm-dt{grid-template-columns:36px minmax(130px,165px) minmax(0,1fr)}.nusm-toolbar{overflow:auto}.nusm-content{position:relative;grid-template-columns:minmax(0,1fr)}.nusm-inspector{display:none}.nusm-inspector.is-open{position:absolute;inset:0;z-index:4;display:block;border-left:0}.nusm-inspector-close{display:grid;float:right}}
`;
const locationStyles = `.nusm-location{display:inline-flex;align-items:center;gap:5px}.nusm-health{width:7px;height:7px;border-radius:50%;background:var(--accent2)}.nusm-health.error{background:var(--danger)}.nusm-health.pending{background:#fbbf24}.nusm-health.warning{background:#fb923c}.nusm-browser ul{list-style:none;margin:0;padding:0}`;

export function NusmDevtoolsPanel({ theme }: TanStackDevtoolsPluginProps) {
  const {
    copyValue,
    drawerRef,
    emit,
    editor,
    events,
    location,
    mutationsDisabled,
    openEditor,
    panelId,
    pathDraft,
    rows,
    selected,
    selectedInstanceId,
    selectedPath,
    selectedRow,
    setEditor,
    setInspectionDepth,
    setInspectionLimit,
    setPathDraft,
    setSelectedInstanceId,
    setSelectedPath,
    setStoreQuery,
    setValueDraft,
    setValueQuery,
    setView,
    snapshots,
    status,
    statusOk,
    storeQuery,
    stores,
    submitEditor,
    valueDraft,
    valueQuery,
    view,
    visibleValue,
  } = usePanelController();

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
        <PanelNavigation
          emit={emit}
          setEditor={setEditor}
          setSelectedInstanceId={setSelectedInstanceId}
          setSelectedPath={setSelectedPath}
          setStoreQuery={setStoreQuery}
          setView={setView}
          snapshots={snapshots}
          storeQuery={storeQuery}
          stores={stores}
          selectedInstanceId={selectedInstanceId}
          view={view}
        />
        <main className="nusm-main">
          <PanelToolbar
            emit={emit}
            mutationsDisabled={mutationsDisabled}
            onOpenEditor={(mode) => openEditor(mode)}
            panelId={panelId}
            selectedAdapterName={selected?.adapterName}
            selectedInstanceId={selected?.instanceId}
            selectedStoreId={selected?.storeId}
            setSelectedPath={setSelectedPath}
            setView={setView}
            tabs={tabs}
            view={view}
          />
          {view === "about" ? (
            <div
              aria-labelledby={`nusm-tab-${panelId}-about`}
              className="nusm-empty"
              id={`nusm-panel-${panelId}-about`}
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
              aria-labelledby={`nusm-tab-${panelId}-${view}`}
              id={`nusm-panel-${panelId}-${view}`}
              role="tabpanel"
            >
              <div className="nusm-empty">
                <div>
                  <Database size={28} />
                  <h3>No instrumented stores yet</h3>
                  <p>
                    Enable <code>devtools: true</code> on a nusm store.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <PanelWorkspace
              events={events}
              location={location}
              mutationsDisabled={mutationsDisabled}
              onCopyValue={(label, value) => void copyValue(label, value)}
              onOpenEditor={openEditor}
              onViewChange={setView}
              panelId={panelId}
              rows={rows}
              selected={selected}
              selectedPath={selectedPath}
              selectedRow={selectedRow}
              setInspectionDepth={setInspectionDepth}
              setInspectionLimit={setInspectionLimit}
              setSelectedPath={setSelectedPath}
              setValueQuery={setValueQuery}
              valueQuery={valueQuery}
              view={view}
              visibleValue={visibleValue}
            />
          )}
          {statusBar}
          {editor && selected && (
            <PanelEditor
              drawerRef={drawerRef}
              editor={editor}
              emit={emit}
              mutationsDisabled={mutationsDisabled}
              pathDraft={pathDraft}
              setEditor={setEditor}
              setPathDraft={setPathDraft}
              setValueDraft={setValueDraft}
              submitEditor={submitEditor}
              valueDraft={valueDraft}
            />
          )}
        </main>
      </div>
    </>
  );
}
