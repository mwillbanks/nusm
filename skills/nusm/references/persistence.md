# Persistence and hydration

## Choose storage

1. Omit the adapter for memory state.
2. Use session storage to retain state across reloads in one tab.
3. Use local storage for small values that must survive a tab close.
4. Use IndexedDB for larger values or when asynchronous storage suits the app.

Use a stable `storeId` for persisted state. For slice storage, give each slice a unique key. Apply each slice to its own fields.

Browser adapters need browser storage. Create them at the client boundary or pass a storage implementation for tests.

The local storage adapter subscribes to storage events. Supply `sync.validator` for adapters that implement `subscribe`. nusm requires the validator even without a sync source. Use `persist.hydrate.validate` separately for initial reads. Share one validator when both inputs use the same state shape.

## Restore state

- Await `store.ready` before you use hydrated values for decisions.
- Check `hydration.overall` and `hydration.byKey` for errors or discarded values.
- Check saved data with `persist.hydrate.validate`. Return `{ ok: true, value }` to migrate older data.
- Use `discardPersisted` for an intentional reset. Report read and write failures with `onError`.

Entire-store hydration deep merges objects and replaces arrays by default. Slice hydration uses each slice's `apply` function.

A missing value gets an initial baseline. Rejected or unreadable saved data does not trigger that baseline write.

Disposal can reject pending `ready` with an `AbortError`. Await disposal to finish cleanup. Handle its `AggregateError` when cleanup fails.

## Test a custom adapter

Return `null` for a missing key. Throw on a read failure. Use decoded values at the adapter boundary. Return an unsubscribe function for adapter events.
