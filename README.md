<p align="center">
  <img src="https://raw.githubusercontent.com/mwillbanks/nusm/refs/heads/main/logo.svg" alt="nusm" height="100" />
</p>

# nusm 
Non Uniform State Manager (nusm) > Pronounced **noose em** (`/ˈnuːs əm/`)
is a persistence-ready wrapper around
[@tanstack/store](https://github.com/TanStack/store) with adapter-based storage.

Explore the full documentation at [mwillbanks.github.io/nusm](https://mwillbanks.github.io/nusm/).

## Features

- Same store semantics as @tanstack/store
- Optional persistence via adapters
- Entire-store or slice-based persistence
- Async hydration with deep merge
- Debounced persistence via @tanstack/pacer
- Adapter events for cross-tab or external updates
- React hooks (via `nusm/react`)
- Optional TanStack Devtools store inspector (`nusm/devtools`)

## Install

```bash
bun add nusm
```

## Quick Start

```ts
import { createNusmStore, createLocalStorageAdapter } from 'nusm'

const store = createNusmStore(
	{ count: 0 },
	{
		storeId: 'counter',
		adapter: createLocalStorageAdapter(),
		persist: { strategy: 'entire' },
	},
)

await store.ready
store.setState((state) => ({ count: state.count + 1 }))
```

## API

### `createNusmStore(initialState, options?)`

Creates a nusm-backed store.

```ts
import { createNusmStore } from 'nusm'

const nusm = createNusmStore(initialState, {
	storeId: 'settings',
	adapter,
	persist: {
		strategy: 'entire',
	},
})
```

Return value:

- A @tanstack/store instance extended with `ready`, readonly `isReady`, and an immutable `hydration` snapshot. `hydration.overall` and each `hydration.byKey` entry report `pending`, `hydrated`, `discarded`, `error`, or `not_configured`; read a fresh snapshot after lifecycle events rather than mutating it.

## Breaking changes and upgrades

nusm now targets the current `@tanstack/store` API directly. The legacy
`Derived` and `Effect` compatibility exports have been removed, and
`useStore` accepts only stores returned by `createNusmStore`.

See the [upgrade guide](docs/UPGRADING.md) before upgrading an existing
integration.

### Persistence strategies

**Entire store**

```ts
persist: { strategy: 'entire' }
```

**Slices**

```ts
persist: {
	strategy: 'slices',
	slices: [
		{
			key: 'todos',
			select: (state) => state.todos,
			apply: (state, sliceValue) => ({ ...state, todos: sliceValue }),
		},
	],
}
```

### Hydration configuration

When a configured persistence unit is missing, nusm writes the corresponding initial entire-store value or selected slice before `ready` resolves. A successfully hydrated store therefore has a real adapter baseline; zero pending keys means those initial writes have completed, not that persistence was skipped. Existing, discarded, and failed adapter values retain their normal hydration policy.

```ts
persist: {
	strategy: 'entire',
	hydrate: {
		discardPersisted: false,
		validate: (persisted) => ({ ok: true, value: persisted }),
		merge: ({ initial, persisted }) => ({ ...initial, ...persisted }),
	},
}
```

## Adapters

Adapters control persistence. They define how nusm reads/writes state and how
external changes (for example, another tab) are observed.

### Adapter interface

```ts
type NusmAdapter = {
	name: string
	getItem(key: string): unknown | null | Promise<unknown | null>
	setItem(key: string, value: unknown): void | Promise<void>
	removeItem(key: string): void | Promise<void>
	getAllKeys?(): string[] | Promise<string[]>
	clear?(): void | Promise<void>
	subscribe?(listener: (event: { type: 'set' | 'remove' | 'clear'; key?: string }) => void): () => void
	resolveKey?(params: { storeId: string; sliceKey?: string; kind: 'entire' | 'slice' }): string
	pacer?: false | { wait?: number; maxWait?: number; leading?: boolean; trailing?: boolean }
}
```

Notes:

- `getAllKeys` is optional adapter-wide enumeration for callers that need it;
  devtools snapshots read configured persistence units through `resolveKey`.
- `resolveKey` lets you control key layout. When omitted, nusm uses
	`nusm:<storeId>:entire` and `nusm:<storeId>:slice:<sliceKey>`.
- `subscribe` should emit adapter events for cross-tab or external updates.
- `pacer` controls debouncing of writes. Use `false` to write immediately.

### Creating a custom adapter

```ts
const memoryAdapter: NusmAdapter = {
	name: 'memory',
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, value),
	removeItem: (key) => store.delete(key),
	getAllKeys: () => Array.from(store.keys()),
	resolveKey: ({ storeId, kind, sliceKey }) =>
		kind === 'entire'
			? `nusm:${storeId}:entire`
			: `nusm:${storeId}:slice:${sliceKey}`,
}
```

### Local Storage

```ts
import { createLocalStorageAdapter } from 'nusm'

const adapter = createLocalStorageAdapter()
```

Options:

- `storage`: a `Storage`-like implementation (defaults to `window.localStorage`).
- `prefix`: key prefix (default: `nusm`).
- `serialize`: custom serializer (default: `superjson.stringify`).
- `deserialize`: custom deserializer (default: `superjson.parse`).
- `pacer`: persistence debouncer configuration.

### Session Storage

```ts
import { createSessionStorageAdapter } from 'nusm'

const adapter = createSessionStorageAdapter()
```

Options:

- `storage`: a `Storage`-like implementation (defaults to `window.sessionStorage`).
- `prefix`: key prefix (default: `nusm`).
- `serialize`: custom serializer (default: `superjson.stringify`).
- `deserialize`: custom deserializer (default: `superjson.parse`).
- `pacer`: persistence debouncer configuration.

### IndexedDB

```ts
import { createIndexDbAdapter } from 'nusm'

const adapter = createIndexDbAdapter({ dbName: 'my-db' })
```

Options:

- `dbName`: database name (default: `nusm`).
- `storeName`: object store name (default: `nusm`).
- `version`: reserved in the public options; the current adapter opens version `1`.
- `serialize`: custom serializer (default: `superjson.stringify`).
- `deserialize`: custom deserializer (default: `superjson.parse`).
- `pacer`: persistence debouncer configuration (default: trailing, 100ms).

## React Hooks

```ts
import { useStore } from 'nusm/react'
```

`useStore` uses React 19's `useSyncExternalStore` and supports selectors and
configurable equality checks.

### `useStore(store, selector?, options?)`

Arguments:

- `store`: a Nusm store instance returned by `createNusmStore`.
- `selector` (optional): function that receives the full state and returns the
	selected slice. Defaults to identity (returns full state).
- `options` (optional): configuration object with:
	- `equal`: when `true`, uses deep equality (`fast-equals` `deepEqual`). When
		`false` or omitted, uses shallow equality (`fast-equals` `shallowEqual`).

Example:

```ts
const store = createNusmStore({ user: { name: 'Ada' } })

const name = useStore(store, (state) => state.user.name)
const user = useStore(store, (state) => state.user, { equal: true })
```

## Tests

```bash
bun test
```

## Build

```bash
bun run build
```

## License

MIT. See [LICENSE](LICENSE).

## TanStack Devtools inspector

nusm ships a framework-neutral event bridge plus an optional React panel built with
TanStack `devtools-utils`. The root `nusm` entry never imports React or the
Devtools shell.

```bash
bun add -d @tanstack/devtools @tanstack/devtools-utils \
  @tanstack/react-devtools lucide-react react react-dom
```

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools"
import { createNusmDevtoolsPlugin } from "nusm/devtools"

const nusmPlugin = createNusmDevtoolsPlugin()

export function DevelopmentTools() {
  return <TanStackDevtools plugins={[nusmPlugin]} />
}
```

Instrument individual stores with `devtools: true` or a named configuration.
The panel provides a compact icon rail, searchable store sidebar, memory and
adapter tabs, path/value filtering, timeline history, copy, add, edit, remove,
raw JSON, reset, and refresh controls. Every mutation is sent through the typed
TanStack event bus and acknowledged by the target store.

Use `createNoOpNusmDevtoolsPlugin()` when a framework integration needs a stable
plugin shape without mounting the inspector. Never enable state inspection in
an untrusted production environment.

See [the full Devtools guide](docs/devtools.md) and the [example walkthrough](example/README.md), then run the standalone showcase from the repository root:

```bash
bun run example:devtools   # Bun server with hot reload
bun run example:test       # React and multi-adapter tests
bun run example:build      # production HTML/CSS/JS bundle
bun run example:serve      # serve the production bundle
```

The [`example` walkthrough](example/README.md) covers a Bun-native React application—no Vite or
similar build system—and exercises memory, localStorage, sessionStorage, and
IndexedDB stores. Its Command center, Stores, and Signals controls select real
visible views, and the canonical nusm mark identifies both the application and
the custom inspector panel. Open `http://127.0.0.1:4173/` during hot-reload development. Production serving keeps the inspector disabled unless `?devtools` is present, so use `http://127.0.0.1:4173/?devtools` only in a trusted environment. See the [browser runtime QA receipt](example/browser-qa.md) for the rebuilt panel, real adapter inspection, live mutation, responsive layout, and console checks.
