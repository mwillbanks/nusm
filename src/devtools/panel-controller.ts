import { useMemo, useState } from "react";
import { flattenValue, formatPath } from "./panel-model.js";
import { getNusmDevtoolsClient } from "./protocol.js";
import { describeInstance } from "./panel-view.js";
import { usePanelEventBridge } from "./panel-events.js";
import { createPanelCommands } from "./panel-commands.js";
import { usePanelFocus } from "./panel-focus.js";
import { usePanelState } from "./panel-state.js";
import type { NusmDevtoolsLocation } from "./types.js";

let panelSequence = 0;

export const usePanelController = () => {
  const [client] = useState(() => getNusmDevtoolsClient());
  const [panelId] = useState(() => `nusm-panel-${++panelSequence}`);
  const panelState = usePanelState();
  const {
    editor,
    inspectionDepth,
    inspectionLimit,
    pathDraft,
    selectedPath,
    setEditor,
    setInspectionDepth,
    setInspectionLimit,
    setPathDraft,
    setSelectedPath,
    setStoreQuery,
    setValueDraft,
    setValueQuery,
    setView,
    storeQuery,
    valueDraft,
    valueQuery,
    view,
  } = panelState;
  const drawerRef = usePanelFocus(editor);
  const eventBridge = usePanelEventBridge({ client, panelId, setEditor });
  const {
    events,
    nextCommandId,
    pendingCommands,
    selectedInstanceId,
    setSelectedInstanceId,
    snapshots,
    setStatus,
    setStatusOk,
    status,
    statusOk,
  } = eventBridge;

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
  const rows = useMemo(() => {
    const value = selected
      ? location === "memory"
        ? selected.memory
        : selected.persisted
      : undefined;
    return flattenValue(value, valueQuery, [], {
      maxDepth: inspectionDepth,
      maxNodes: inspectionLimit,
    });
  }, [inspectionDepth, inspectionLimit, location, selected, valueQuery]);
  const visibleValue = selected
    ? location === "memory"
      ? selected.memory
      : selected.persisted
    : undefined;
  const selectedRow = useMemo(
    () => rows.find((row) => formatPath(row.path) === formatPath(selectedPath)),
    [rows, selectedPath],
  );

  const { copyValue, emit, openEditor, submitEditor } = createPanelCommands({
    client,
    editor,
    location,
    nextCommandId,
    panelId,
    pathDraft,
    pendingCommands,
    selected,
    selectedRow,
    setEditor,
    setPathDraft,
    setStatus,
    setStatusOk,
    setValueDraft,
    valueDraft,
    visibleValue,
  });

  return {
    client,
    drawerRef,
    emit,
    editor,
    events,
    inspectionDepth,
    inspectionLimit,
    location,
    mutationsDisabled,
    openEditor,
    copyValue,
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
  };
};
