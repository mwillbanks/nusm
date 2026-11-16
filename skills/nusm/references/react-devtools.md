# React and Devtools

## Connect React

1. Create one store for each owner lifetime.
2. Pass the store to `useStore` from `nusm/react`.
3. Select the fields each component uses.
4. Enable `{ equal: true }` if the selection needs deep equality.
5. Wait for hydration at the owner boundary if the first view needs saved state.

The hook uses shallow equality by default. The root `nusm` export works without React.

## Connect the inspector

1. Use the same trusted development flag for the store and Devtools shell.
2. Keep inspection off for stores that hold credentials, secrets, or personal data.
3. Enable the store's `devtools` option only in trusted development.
4. Return `null` from the shell in production. Mount a child inspector only in development.
5. In that child, create `createNusmDevtoolsPlugin()` from `nusm/devtools` once.
6. Pass the plugin to `TanStackDevtools` from `@tanstack/react-devtools`.

The display name does not set `storeId`. If two store labels match, select the correct runtime instance.

Memory edits affect live state. Adapter edits affect saved values. Use the timeline and both views to find the source of a change.

If a host needs a placeholder plugin, use `createNoOpNusmDevtoolsPlugin()`. Keep the production inspector unmounted.
