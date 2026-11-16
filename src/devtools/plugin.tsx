import type { TanStackDevtoolsPluginProps } from "@tanstack/devtools";
import type { JSX } from "react";
import {
  createReactPanel,
  createReactPlugin,
} from "@tanstack/devtools-utils/react";
import { NusmDevtoolsCore } from "./core.js";

export { NusmDevtoolsCore } from "./core.js";

type DevtoolsPanel = (props: TanStackDevtoolsPluginProps) => JSX.Element;
type DevtoolsPluginFactory = ReturnType<typeof createReactPlugin>[0];

const [panel, noOpPanel] = createReactPanel<
  TanStackDevtoolsPluginProps,
  NusmDevtoolsCore
>(NusmDevtoolsCore);

export const NusmReactDevtoolsPanel: DevtoolsPanel = panel;
export const NoOpNusmReactDevtoolsPanel: DevtoolsPanel = noOpPanel;

const [createPlugin, createNoOpPlugin] = createReactPlugin({
  Component: NusmReactDevtoolsPanel,
  defaultOpen: false,
  id: "nusm",
  name: "nusm",
});

export const createNusmDevtoolsPlugin: DevtoolsPluginFactory = createPlugin;
export const createNoOpNusmDevtoolsPlugin: DevtoolsPluginFactory =
  createNoOpPlugin;
