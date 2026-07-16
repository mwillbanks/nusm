# Changelog

# [1.1.0](https://github.com/mwillbanks/nusm/compare/0.1.0...1.1.0) (2026-07-16)


### Features

* add optional nusm devtools inspector ([2e7f134](https://github.com/mwillbanks/nusm/commit/2e7f134c688dd261272aa3e4b8d3ed02cea5a613))

### Breaking Changes

- Remove the legacy `Derived` and `Effect` compatibility API; nusm now uses the current `@tanstack/store` contracts directly.
- Restrict `useStore` to nusm stores returned by `createNusmStore`.

### Changed

- Upgrade Bun workspace dependencies and align devtools integration with the current lifecycle API.

# 0.1.0 (2026-01-15)


### Features

* initial ([e71025b](https://github.com/mwillbanks/nusm/commit/e71025b7be9a0458bc3d58c6756a5b996e1c54fb))
