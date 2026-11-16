---
name: nusm
description: Use when building or debugging a nusm store. Covers persistence, hydration, cross-tab sync, React selectors, and TanStack Devtools.
license: MIT
metadata:
  purpose: Choose a store lifetime and apply the nusm APIs for state, storage, sync, and inspection.
  type: core
  library: nusm
  library_version: "1.2.0"
sources:
  - src/index.ts
  - src/config.ts
  - src/nusm.ts
  - src/types.ts
  - src/react/index.ts
  - src/devtools/**
  - src/store/lifecycle.ts
  - src/adapters/**
  - src/sync/**
  - website/content/docs/concepts/persistence.mdx
  - website/content/docs/concepts/hydration.mdx
  - website/content/docs/concepts/synchronization.mdx
  - website/content/docs/devtools.mdx
---

# Work with a nusm store

1. Check the installed nusm version and its public exports.
2. Choose the store lifetime. Start with memory for temporary state.
3. Add an adapter for reload recovery. Give each persisted or synchronized store a stable `storeId`.
4. Use `store.setState` to change state. Subscribe with `useStore` from `nusm/react` in React.
5. Read `store.hydration` after `store.ready` settles. Report a failure through the app's error path.
6. Await `store.dispose()` when the owner ends the store lifetime.

```ts
import { createNusmStore } from "nusm";

const store = createNusmStore({ count: 0 });
store.setState((state) => ({ count: state.count + 1 }));
await store.dispose();
```

For an adapter that implements `subscribe`, configure `sync.validator` even without a sync source.
Use `persist.hydrate.validate` to check the initial read.

## Open a reference when needed

- [Persistence and hydration](references/persistence.md) for storage lifetime, slice isolation, and recovery.
- [Authenticated synchronization](references/synchronization.md) for cross-tab updates and state validation.
- [React and Devtools](references/react-devtools.md) for selector and inspector setup.

For every Devtools integration, explain that snapshots can expose live and saved values.
Keep the inspector off for stores that hold credentials, secrets, or personal data.

Start from the [persisted React store](assets/persisted-store.tsx) or the [synchronized store](assets/synchronized-store.ts).

## Check the result

- Reload the app. Check that persistent fields return and temporary fields reset.
- Close a store while hydration is pending. Handle the rejected `ready` promise.
- For sync, open two authorized tabs. Reject an invalid update and check both tabs for the correct state.
- For Devtools, check the memory, adapter, and timeline views for the same store instance.

Use the [adapter check](scripts/check-adapter.ts) for a custom adapter. Run it from the consuming app with Bun and a test adapter module:

```sh
bun node_modules/nusm/skills/nusm/scripts/check-adapter.ts ./test-adapter.ts
```

Export a test adapter as the module's default value. Use test storage. The check writes and removes one unique key.
