import { useState } from "react";
import type { NusmDevtoolsPath } from "./types.js";
import type { EditorState } from "./panel-editor.js";
import type { View } from "./panel-view.js";

export const usePanelState = () => {
  const [view, setView] = useState<View>("overview");
  const [storeQuery, setStoreQuery] = useState("");
  const [valueQuery, setValueQuery] = useState("");
  const [inspectionDepth, setInspectionDepth] = useState(16);
  const [inspectionLimit, setInspectionLimit] = useState(2_000);
  const [selectedPath, setSelectedPath] = useState<NusmDevtoolsPath>([]);
  const [editor, setEditor] = useState<EditorState>();
  const [pathDraft, setPathDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");

  return {
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
  };
};
