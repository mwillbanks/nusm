import type { TanStackDevtoolsPluginProps } from "@tanstack/devtools";
import {
  createReactPanel,
  createReactPlugin,
} from "@tanstack/devtools-utils/react";
import { NusmDevtoolsCore } from "./core.js";

export { NusmDevtoolsCore } from "./core.js";

export const [NusmReactDevtoolsPanel, NoOpNusmReactDevtoolsPanel] =
  createReactPanel<TanStackDevtoolsPluginProps, NusmDevtoolsCore>(
    NusmDevtoolsCore,
  );

export const [createNusmDevtoolsPlugin, createNoOpNusmDevtoolsPlugin] =
  createReactPlugin({
    Component: NusmReactDevtoolsPanel,
    defaultOpen: false,
    id: "nusm",
    name: "nusm",
  });
