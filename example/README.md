# nusm Devtools example

This standalone Bun and React application demonstrates how to build, inspect, and safely mutate nusm stores across memory, localStorage, sessionStorage, and IndexedDB. It intentionally uses Bun directly—there is no Vite or application framework.

## What the example demonstrates

| Store | Adapter | What to try |
| --- | --- | --- |
| Workspace Pulse | Memory only | Add or complete tasks, filter live state, and edit `focusMinutes` from the inspector. |
| Preferences | localStorage | Change durable UI preferences and inspect the persisted adapter tab. |
| Live Session | sessionStorage | Advance session state and compare live memory with the current browser session. |
| Activity Archive | IndexedDB | Record durable activity and inspect nested event records. |

Every persistent store writes a missing initial value before `store.ready` resolves. The adapter tabs therefore start with real values and report synchronized health with no pending keys. Reload tests prove that later localStorage, sessionStorage, and IndexedDB values hydrate into a new store lifecycle.

## Prerequisites

- Bun 1.3 or newer.
- A modern browser with localStorage, sessionStorage, and IndexedDB.
- The repository checkout, because the example deliberately resolves `nusm` through `file:../src`.

Install both the library and example dependencies from the repository root:

```bash
bun install
bun install --cwd example
```

## Run with hot reload

From the repository root:

```bash
bun run example:devtools
```

This builds nusm, starts Bun with hot reload at `http://127.0.0.1:4173/`, and enables the active inspector plugin. Open the TanStack trigger in the lower-right corner and select **nusm**.

You can also work entirely inside this package after its dependencies are installed:

```bash
cd example
bun run dev
```

## Explore the application

1. Switch among **Command center**, **Stores**, and **Signals**. Each control selects one labelled application view rather than scrolling to an anchor.
2. Interact with each store and wait for the `4 of 4 stores ready` indicator before testing persistent controls.
3. Open TanStack Devtools and select **nusm**.
4. Select a store from the searchable sidebar. The adapter and stable runtime instance discriminator are shown before any mutation.
5. Compare **Overview**, **Memory**, the configured adapter tab, **Timeline**, and **About**.
6. Search paths or values, select a row, and use copy, add, edit, remove, raw JSON, refresh, or memory reset.
7. Edit `workspace-pulse.focusMinutes` in Memory and watch the Signals ring update after the correlated `set path complete` acknowledgement.

Memory edits affect live state only. Persisted-location edits affect the configured adapter only, which makes intentional divergence visible instead of silently feeding an adapter edit back into memory. Reload the page to observe persisted browser values hydrate again.

## Reuse the store pattern

The stores live in [`src/stores.ts`](src/stores.ts). A persistent store needs an adapter, a persistence strategy, a stable display id, and optional Devtools instrumentation:

```ts
import { createLocalStorageAdapter, createNusmStore } from "nusm"

export const preferences = createNusmStore(
  { accent: "violet", theme: "midnight" },
  {
    adapter: createLocalStorageAdapter(),
    devtools: { name: "Preferences", eventLogCap: 150 },
    persist: { strategy: "entire" },
    storeId: "preferences",
  },
)

await preferences.ready
```

For slices, configure `persist.strategy` as `"slices"` and give each slice a unique logical key. Custom adapter `resolveKey` implementations must return one stable, non-empty physical key per configured persistence unit.

## Mount the optional panel

The panel and its React/TanStack dependencies are optional. The root `nusm` entrypoint never imports them. An application that opts in imports the dedicated entrypoint and creates the plugin once:

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools"
import { createNusmDevtoolsPlugin } from "nusm/devtools"

const nusmPlugin = createNusmDevtoolsPlugin()

export function DevelopmentTools() {
  return <TanStackDevtools plugins={[nusmPlugin]} />
}
```

Render that component only in a trusted development environment. If an integration requires a stable plugin shape without inspection UI, use `createNoOpNusmDevtoolsPlugin()`.

## Test and build

Run the example-specific suites from the repository root:

```bash
bun run example:test
bun run example:build
```

The tests exercise React navigation, readiness guards, real browser-adapter persistence, reload hydration, optional plugin behavior, static asset traversal rejection, and the live store interactions used by the panel.

Serve the production bundle:

```bash
PORT=4173 bun run example:serve
```

Production mode selects the no-op plugin by default. To inspect this local production build explicitly, open `http://127.0.0.1:4173/?devtools`. Do not expose that opt-in on an untrusted deployment because store snapshots may contain sensitive application data.

## Further reading

- [Root nusm README](../README.md)
- [Devtools integration guide](../docs/devtools.md)
- [Browser QA receipt](browser-qa.md)
