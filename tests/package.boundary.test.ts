import { expect, test } from "bun:test";
import * as devtoolsRuntimeExports from "../src/devtools/index";
import {
  createNoOpNusmDevtoolsPlugin,
  createNusmDevtoolsPlugin,
  NoOpNusmReactDevtoolsPanel,
  NusmDevtoolsCore,
  NusmLogo,
  NusmReactDevtoolsPanel,
} from "../src/devtools/index";
import * as rootRuntimeExports from "../src/index";
import {
  configureNusm,
  createBroadcastChannelSyncSource,
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
} from "../src/index";
import * as reactRuntimeExports from "../src/react/index";
import { useStore } from "../src/react/index";

const rootEntry = await Bun.file(
  new URL("../src/index.ts", import.meta.url),
).text();
const metadata = await Bun.file(
  new URL("../package.json", import.meta.url),
).json();

test("keeps the root entry isolated and devtools framework dependencies optional", () => {
  expect(rootEntry).not.toContain("./devtools");
  for (const dependency of [
    "@tanstack/devtools",
    "@tanstack/devtools-utils",
    "lucide-react",
    "react",
    "react-dom",
  ]) {
    expect(metadata.peerDependenciesMeta[dependency].optional).toBe(true);
  }
});

test("publishes the complete runtime surface through each package barrel", () => {
  const rootNames = [
    "createBroadcastChannelSyncSource",
    "createIndexDbAdapter",
    "createLocalStorageAdapter",
    "createNusmStore",
    "createSessionStorageAdapter",
    "configureNusm",
  ] as const;
  const devtoolsNames = [
    "createNoOpNusmDevtoolsPlugin",
    "createNusmDevtoolsPlugin",
    "NoOpNusmReactDevtoolsPanel",
    "NusmDevtoolsCore",
    "NusmLogo",
    "NusmReactDevtoolsPanel",
  ] as const;

  expect(Object.keys(rootRuntimeExports).sort()).toEqual([...rootNames].sort());
  expect(Object.keys(devtoolsRuntimeExports).sort()).toEqual(
    [...devtoolsNames].sort(),
  );
  expect(Object.keys(reactRuntimeExports)).toEqual(["useStore"]);

  const rootValues = [
    createBroadcastChannelSyncSource,
    createIndexDbAdapter,
    createLocalStorageAdapter,
    createNusmStore,
    createSessionStorageAdapter,
    configureNusm,
  ];
  const devtoolsValues = [
    createNoOpNusmDevtoolsPlugin,
    createNusmDevtoolsPlugin,
    NoOpNusmReactDevtoolsPanel,
    NusmDevtoolsCore,
    NusmLogo,
    NusmReactDevtoolsPanel,
  ];

  for (const value of [...rootValues, ...devtoolsValues, useStore]) {
    expect(typeof value).toBe("function");
  }
});
