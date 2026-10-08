import { Check, RotateCcw, Trash2, X } from "lucide-react";
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type {
  NusmDevtoolsCommandInput,
  NusmDevtoolsLocation,
  NusmDevtoolsPath,
} from "./types.js";
import { formatPath } from "./panel-model.js";

export type EditorState = {
  instanceId: string;
  location: NusmDevtoolsLocation;
  mode: "add" | "edit" | "raw" | "remove";
  path: NusmDevtoolsPath;
  storeId: string;
};

type Emit = (command: NusmDevtoolsCommandInput) => void;

const onEditorKeyDown = (
  event: KeyboardEvent<HTMLDialogElement>,
  setEditor: Dispatch<SetStateAction<EditorState | undefined>>,
) => {
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
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
};

const EditorFields = ({
  editor,
  pathDraft,
  valueDraft,
  setPathDraft,
  setValueDraft,
}: {
  editor: EditorState;
  pathDraft: string;
  valueDraft: string;
  setPathDraft: Dispatch<SetStateAction<string>>;
  setValueDraft: Dispatch<SetStateAction<string>>;
}) => (
  <>
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
          onInput={(event) => setValueDraft(event.currentTarget.value)}
          value={valueDraft}
        />
      </label>
    )}
    {editor.mode === "remove" && (
      <p className="nusm-error">
        Remove {formatPath(editor.path)} from {editor.location}? This cannot be
        undone.
      </p>
    )}
  </>
);

const EditorActions = ({
  editor,
  mutationsDisabled,
  submitEditor,
  emit,
}: {
  editor: EditorState;
  mutationsDisabled: boolean;
  submitEditor: () => void;
  emit: Emit;
}) => (
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
    {editor.location === "memory" && editor.mode !== "remove" && (
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
);

export const PanelEditor = ({
  editor,
  drawerRef,
  pathDraft,
  valueDraft,
  mutationsDisabled,
  setEditor,
  setPathDraft,
  setValueDraft,
  submitEditor,
  emit,
}: {
  editor: EditorState;
  drawerRef: RefObject<HTMLDialogElement | null>;
  pathDraft: string;
  valueDraft: string;
  mutationsDisabled: boolean;
  setEditor: Dispatch<SetStateAction<EditorState | undefined>>;
  setPathDraft: Dispatch<SetStateAction<string>>;
  setValueDraft: Dispatch<SetStateAction<string>>;
  submitEditor: () => void;
  emit: Emit;
}) => (
  <dialog
    open
    aria-label={`${editor.mode} value`}
    aria-modal="true"
    className="nusm-drawer"
    onKeyDown={(event) => onEditorKeyDown(event, setEditor)}
    ref={drawerRef}
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
    <EditorFields
      editor={editor}
      pathDraft={pathDraft}
      setPathDraft={setPathDraft}
      setValueDraft={setValueDraft}
      valueDraft={valueDraft}
    />
    <EditorActions
      editor={editor}
      emit={emit}
      mutationsDisabled={mutationsDisabled}
      submitEditor={submitEditor}
    />
  </dialog>
);
