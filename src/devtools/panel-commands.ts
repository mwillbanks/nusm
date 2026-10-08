import type { Dispatch, SetStateAction } from "react";
import { flattenValue, formatPath, parsePath } from "./panel-model.js";
import { stringifyForDevtools } from "./serialize.js";
import type { EditorState } from "./panel-editor.js";
import type {
  NusmDevtoolsCommandInput,
  NusmDevtoolsLocation,
  NusmDevtoolsPath,
} from "./types.js";
import type { getNusmDevtoolsClient } from "./protocol.js";

type DevtoolsClient = ReturnType<typeof getNusmDevtoolsClient>;
type PendingCommand = {
  action: NusmDevtoolsCommandInput["action"];
  instanceId?: string;
  storeId?: string;
  timeoutId: ReturnType<typeof setTimeout>;
};
type EditorRow = ReturnType<typeof flattenValue>[number] | undefined;

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

const editorValue = (
  mode: EditorState["mode"],
  path: NusmDevtoolsPath,
  visibleValue: unknown,
  selectedRow: EditorRow,
) =>
  mode === "add" ? null : path.length === 0 ? visibleValue : selectedRow?.value;

const submitEditorValue = ({
  editor,
  valueDraft,
  pathDraft,
  emit,
  reportError,
}: {
  editor: EditorState | undefined;
  valueDraft: string;
  pathDraft: string;
  emit: (command: NusmDevtoolsCommandInput) => void;
  reportError: (error: unknown) => void;
}) => {
  if (!editor) return;
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
    reportError(error);
  }
};

export const createPanelCommands = ({
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
}: {
  client: DevtoolsClient;
  editor: EditorState | undefined;
  location: NusmDevtoolsLocation;
  nextCommandId: (prefix: string) => string;
  panelId: string;
  pathDraft: string;
  pendingCommands: { current: Map<string, PendingCommand> };
  selected: { instanceId: string; storeId: string } | undefined;
  selectedRow: EditorRow;
  setEditor: Dispatch<SetStateAction<EditorState | undefined>>;
  setPathDraft: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setStatusOk: Dispatch<SetStateAction<boolean>>;
  setValueDraft: Dispatch<SetStateAction<string>>;
  valueDraft: string;
  visibleValue: unknown;
}) => {
  const emit = (command: NusmDevtoolsCommandInput) => {
    const commandId = nextCommandId(`nusm-panel-${panelId}`);
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
    client.emit("command", { ...command, commandId });
    setStatus(`${command.action.replaceAll("_", " ")} pending…`);
    setStatusOk(false);
  };

  const copyValue = async (label: string, value: unknown) => {
    try {
      await copyText(stringifyForDevtools(value));
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
    const selectedSnapshot = selected as {
      instanceId: string;
      storeId: string;
    };
    setEditor({
      instanceId: selectedSnapshot.instanceId,
      location,
      mode,
      path,
      storeId: selectedSnapshot.storeId,
    });
    setPathDraft(mode === "add" ? "" : formatPath(path));
    setValueDraft(
      stringifyForDevtools(editorValue(mode, path, visibleValue, selectedRow)),
    );
  };

  const submitEditor = () =>
    submitEditorValue({
      editor,
      emit,
      pathDraft,
      reportError: (error) => {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusOk(false);
      },
      valueDraft,
    });

  return { copyValue, emit, openEditor, submitEditor };
};
