# Persistence identity migration

This release requires every persisted store to declare a stable `storeId`.
Devtools names are display labels only and never provide persistence identity.

## Migrate persisted stores

Add an explicit `storeId` to every store that configures an adapter:

```ts
const settings = createNusmStore(
  { theme: "system" },
  {
    adapter: createLocalStorageAdapter(),
    persist: { strategy: "entire" },
    storeId: "settings",
    sync: {
      validator: (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as { theme?: unknown }).theme === "string",
    },
  },
);
```

Keep the identifier stable across releases. If an earlier nusm version derived
its physical key from a Devtools name, migrate that value to the new
`nusm:<storeId>:entire` key before releasing the update. Slice keys use
`nusm:<storeId>:slice:<sliceKey>`.

Review custom adapters as well. Their `resolveKey` implementation must return a
stable, non-empty, unique key for every configured persistence unit.
