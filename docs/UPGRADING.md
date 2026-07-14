# Upgrading to the current TanStack Store API

This release intentionally removes nusm's temporary compatibility layer for
older `@tanstack/store` APIs. It is a breaking change.

## Removed APIs

`Derived` and `Effect` are no longer part of the nusm API, and their types are
no longer available from nusm internals. Import and use the supported current
TanStack Store primitives directly where needed, or model computed state in
application code.

`useStore` from `nusm/react` now accepts only a store returned by
`createNusmStore`. Do not pass legacy derived-store objects to this hook.

## Store migration

The current `@tanstack/store` API uses functional setters and value-only
subscriptions. Replace direct updates such as:

```ts
store.setState(nextState)
store.subscribe(({ prevVal, currentVal }) => {
  // ...
})
```

with:

```ts
store.setState(() => nextState)
let previousState = store.state
store.subscribe((currentState) => {
  // use previousState and currentState as needed
  previousState = currentState
})
```

## Devtools migration

The current `@tanstack/devtools` plugin lifecycle expects `render` to return
`void`. Move cleanup that was previously returned from `render` into the
plugin's optional `destroy` callback.

## Verification

After migrating, run:

```bash
bun install --frozen-lockfile
bun run build
bun test
```
