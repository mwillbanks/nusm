# Authenticated synchronization

1. Create a source with `createBroadcastChannelSyncSource`.
2. Give authorized tabs the same namespace and runtime-provisioned key.
3. Give each synchronized store a stable `storeId`.
4. Check incoming state before it reaches memory or storage.
5. Await `store.ready` and test updates across tabs.
6. Dispose each store when its owner closes.

Use at least 32 random bytes or a non-extractable HMAC SHA-256 key with `sign` and `verify` permissions. Supply the key at runtime. Keep it out of source code, logs, and persisted state. A different key per tab prevents the tabs from connecting.

Check the full state shape. Return `false` to reject a candidate. Return `true` to accept it unchanged. Return `{ ok: true, value }` to accept normalized state.

A global source enables sync for stores with a `storeId`. Set `sync: false` to opt out of configured sync sources. Adapter subscriptions can still receive storage events. A subscribed adapter with `sync: false` needs a global `sync.validator`. Use an adapter without `subscribe` to prevent adapter events. Use `optimistic: true` only when the app can proceed before peers converge.

Use trusted browser contexts on the same origin. HMAC authenticates messages. It does not encrypt state or protect against a compromised app.
