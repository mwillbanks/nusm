import type { TanStackDevtoolsPluginProps } from "@tanstack/devtools";
import { createRoot, type Root } from "react-dom/client";
import { NusmDevtoolsPanel } from "./panel";

type RootEntry = { root: Root; version: number };
const rootEntries = new WeakMap<HTMLElement, RootEntry>();

export class NusmDevtoolsCore {
  private element: HTMLElement | undefined;
  private version: number;

  constructor() {
    this.element = undefined;
    this.version = 0;
  }

  mount(element: HTMLElement, props: TanStackDevtoolsPluginProps) {
    let entry = rootEntries.get(element);
    if (!entry) {
      entry = { root: createRoot(element), version: 0 };
      rootEntries.set(element, entry);
    }
    entry.version += 1;
    this.element = element;
    this.version = entry.version;
    entry.root.render(<NusmDevtoolsPanel {...props} />);
  }

  unmount() {
    const element = this.element;
    const version = this.version;
    this.element = undefined;
    if (!element) return;
    queueMicrotask(() => {
      const entry = rootEntries.get(element);
      if (!entry || entry.version !== version) return;
      rootEntries.delete(element);
      entry.root.unmount();
    });
  }
}
