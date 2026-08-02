# nusm Devtools

The optional nusm inspector is a native TanStack Devtools plugin. It uses
`createReactPanel` and `createReactPlugin` from `@tanstack/devtools-utils/react`
for the framework lifecycle while nusm stores communicate through the
framework-neutral TanStack `EventClient`.

## Install

```bash
bun add -d @tanstack/devtools @tanstack/devtools-utils \
  @tanstack/react-devtools lucide-react react react-dom
```

All Devtools and React packages are optional peers. Importing `nusm` or
`nusm/react` does not load the inspector; only `nusm/devtools` crosses the
optional boundary.

## Connect a store

```ts
import { createLocalStorageAdapter, createNusmStore } from "nusm"

export const settings = createNusmStore(
  { profile: { displayName: "Ada" }, shortcuts: true },
  {
    adapter: createLocalStorageAdapter(),
    devtools: { name: "Settings", eventLogCap: 200 },
    persist: { strategy: "entire" },
    storeId: "settings",
  },
)
```

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools"
import { createNusmDevtoolsPlugin } from "nusm/devtools"

const nusmPlugin = createNusmDevtoolsPlugin()

export function DevelopmentTools() {
  return (
    <TanStackDevtools
      config={{ defaultOpen: false, position: "bottom-right", triggerMode: "floating" }}
      plugins={[nusmPlugin]}
    />
  )
}
```

Create the plugin once rather than during each application render. For an SSR
or production branch that must preserve the same shape, export and use
`createNoOpNusmDevtoolsPlugin`.

## Inspector workflow

- The icon rail switches between connected stores, timeline, and panel details.
- The store sidebar filters by store id or adapter and shows connection state.
- Overview, Memory, adapter, and Timeline tabs keep volatile and persisted data
  visibly distinct.
- The path browser searches keys, paths, and value previews. Select a row to
  inspect formatted JSON, copy it, edit it, or remove it.
- Add accepts paths such as `profile.name` and `items[0]`. Raw mode replaces an
  entire memory or persisted value after JSON validation.
- Reset affects memory only. Refresh requests a new snapshot without mutation.
- Light and dark colors follow the TanStack shell theme. Dense layouts collapse
  the inspector drawer on narrow panels while keeping keyboard focus visible.

## Bidirectional protocol

Stores emit `snapshot`, `hydration`, and bounded `event` messages. The panel
emits serializable `command` messages and waits for matching `commandResult`
acknowledgements. Path writes use `set_path`; deletion uses `remove_path`. Each
store-scoped command includes both a unique runtime instance id and its display
store id, memory or persisted location, a JSON path, and a unique command id.
The panel indexes snapshots, events, editor sessions, and acknowledgements by
instance id, so duplicate or normalization-colliding display names remain visible
and a mutation reaches exactly one store. Instance sequences are stored in a
process-global symbol registry, preventing duplicated bundles and hot reloads from
reusing an identity. The sidebar, summary, accessible name, and store search expose
the runtime discriminator before a developer issues a mutation. The broadcast `refresh_all` command is
the sole identity exception. Unsafe prototype segments and invalid array gaps are
rejected before state is changed.

Memory edits deliberately affect only live memory. Persisted edits deliberately
affect only the configured adapter. Store snapshots publish producer-owned
synchronization state, so the panel reports synchronized, divergent, pending, or
unknown health without comparing lossy display projections.

On first hydration, a missing entire-store value or slice is written from the
valid initial state before `ready` resolves. The resulting adapter tab contains
the same baseline as memory, `lastFlushAt` records the seed, and an empty pending
list indicates the write finished. Existing, discarded, or unreadable values are
not silently replaced by this baseline behavior.

Slice `apply` functions must be isolated to the value returned by their matching
`select`. Before writing multiple missing baselines, nusm validates that applying
them preserves every selected initial value; mutually interacting definitions
reject hydration without writing a misleading persisted baseline.

Slice identities are validated before any adapter read or write. Logical slice
keys must be unique, and every adapter-resolved physical key must be non-empty
and unique. nusm resolves each configured physical key once and reuses that
stable identity for hydration, persistence, external events, and Devtools
commands. A custom `resolveKey` implementation is called once per configured
unit and must return a distinct valid key for each unit. Adapter clear events reset
only configured slices to their initial selected values; live fields outside those
slices are preserved. Entire-store persistence continues to reset the whole state.

## Bun example

The independent [`example`](../example) package uses Bun HTML imports and
`Bun.serve` for hot reload, bundling, production serving, and tests.

```bash
bun run example:devtools
bun run example:test
bun run example:build
bun run example:serve
```

The showcase mounts four real stores: ephemeral workspace state, localStorage
preferences, a sessionStorage session, and IndexedDB activity history. It
resolves `nusm` from the current checkout through `file:../src`, disables each
stateful interaction until its store reports `isReady`, and includes persistence
proofs for all three browser adapters. Command center, Stores, and Signals are
controlled accessible views rather than scroll anchors, and both the shell and
custom panel use the canonical nusm logo. Open the TanStack trigger at the
lower-right and select `nusm` to inspect them. The active panel is enabled by Bun
hot-module development or an explicit `?devtools` query parameter; production
serving otherwise selects the shape-compatible no-op plugin and omits the shell. The
checked-in [`browser-qa.md`](../example/browser-qa.md) receipt records the rebuilt
browser runtime, real adapter tabs, live bidirectional mutation, console health,
and production traversal checks.

## Security

Devtools snapshots can contain credentials, personal data, or internal state.
Keep instrumentation and the panel out of untrusted production builds. Copy and
editing are explicit user gestures. Mutations accept round-trippable JSON data,
reject accessors and Proxy values, and never intentionally invoke accessors. JavaScript
provides no trap-free portable Proxy detection, so an unsupported Proxy may observe the
validation attempt before the command is rejected; do not expose hostile Proxy state to
development tooling.
