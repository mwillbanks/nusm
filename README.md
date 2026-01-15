<p align="center">
  <img src="./logo.svg" alt="nusm" height="100" />
</p>

# nusm 
Non Uniform State Manager (nusm) > Pronounced **noose em** (/ˈnuːs əm/)
is a persistence-ready wrapper around
[@tanstack/store](https://github.com/TanStack/store) with adapter-based storage

## Features

- Same store semantics as @tanstack/store
- Optional persistence via adapters
- Entire-store or slice-based persistence
- Async hydration with deep merge
- Debounced persistence via @tanstack/pacer
- Adapter events for cross-tab or external updates
- React hooks (via `nusm/react`)
- @tanstack/devtools event support (panel coming soon)

## Install

```bash
bun install `nusm`
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

- A @tanstack/store instance extended with `ready` (resolves when hydration completes).

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

- `getAllKeys` enables more complete persisted snapshots.
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

### IndexDB

```ts
import { createIndexDbAdapter } from 'nusm'

const adapter = createIndexDbAdapter({ dbName: 'my-db' })
```

Options:

- `dbName`: database name (default: `nusm`).
- `storeName`: object store name (default: `nusm`).
- `version`: database version (default: `1`).
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
