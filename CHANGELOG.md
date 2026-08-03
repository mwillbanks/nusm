# Changelog

## [1.1.1](https://github.com/mwillbanks/nusm/compare/1.1.0...1.1.1) (2026-08-03)

### Bug Fixes

* add Bun types to docs ([9378bc7](https://github.com/mwillbanks/nusm/commit/9378bc721521edc7aeb37fd4ab13005a3893c9a3))
* CHANGELOG to remove Unreleased section ([e1bbd91](https://github.com/mwillbanks/nusm/commit/e1bbd919f7a3406fb5ba9670575ec9a5e12a3ed5))
* honor Pages base path ([5229af1](https://github.com/mwillbanks/nusm/commit/5229af12aab2a4266e5c9cb78cd5e5ad36b9ca38))
* repair Pages deployment ([2ece953](https://github.com/mwillbanks/nusm/commit/2ece9530e8eaec34ccc82d9ca3d662efe4a75e6b))

### Features

* add docs ([133b242](https://github.com/mwillbanks/nusm/commit/133b242e1cf288fa3b10f9c2f955b29db50fe3d1))

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
