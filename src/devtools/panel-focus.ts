import { useLayoutEffect, useRef } from "react";
import type { EditorState } from "./panel-editor.js";

export const usePanelFocus = (editor: EditorState | undefined) => {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | undefined>(undefined);

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

  return drawerRef;
};
