# Changelog

# [1.2.0](https://github.com/mwillbanks/nusm/compare/1.1.1...1.2.0) (2026-10-08)

### Bug Fixes

- await hydration replay callbacks ([bcba339](https://github.com/mwillbanks/nusm/commit/bcba339546e6f8dfeab2f89f3124ac99a8606fe4))
- await hydration replay publishing ([2999eb4](https://github.com/mwillbanks/nusm/commit/2999eb4ba6a059ae9ce8e6f54011189fbc85b4f3))
- clear react doctor findings ([b2501dd](https://github.com/mwillbanks/nusm/commit/b2501dd0fef24dbc41e94c336627cc61295fede6))
- enforce store disposal boundaries ([42798ae](https://github.com/mwillbanks/nusm/commit/42798aeadcdc14d6429fe5c154856aba08f07902))
- make synchronization convergence safe ([52f5de8](https://github.com/mwillbanks/nusm/commit/52f5de8ea0f4d307c7d8cc8cc6a2b5df586640d8))
- preserve hydration-time sync updates ([3f27b0e](https://github.com/mwillbanks/nusm/commit/3f27b0e2d92d4deb731df2135805d975ff9c2d38))
- preserve optimistic sync readiness ([9f75d88](https://github.com/mwillbanks/nusm/commit/9f75d8876e7b5e59b07174cd6383025477f625fd))
- preserve validation for sync opt-outs ([d61b009](https://github.com/mwillbanks/nusm/commit/d61b009210ed90fcef34a87b000dd16ae0579e08))
- serialize hydration-time sync replay ([8bc2941](https://github.com/mwillbanks/nusm/commit/8bc294119cf63d90c31710b0a785687357e79b31))
- support plain Node ESM imports ([b4e5306](https://github.com/mwillbanks/nusm/commit/b4e530645ebc21ebb134d2b49453ff5f44f7e743))
- validate synchronized state changes ([4d70864](https://github.com/mwillbanks/nusm/commit/4d70864a859310babbcf6436796146145b99dd3f))

### Features

- authenticate broadcast synchronization ([03fe2c2](https://github.com/mwillbanks/nusm/commit/03fe2c2bee8eff907549abbc3ec242dda5d88f0c))
- cross-tab implementation ([601fe9a](https://github.com/mwillbanks/nusm/commit/601fe9acb7302b5dbd776bd3fa403d8417721066))

## [1.1.1](https://github.com/mwillbanks/nusm/compare/1.1.0...1.1.1) (2026-08-03)

### Bug Fixes

- add Bun types to docs ([9378bc7](https://github.com/mwillbanks/nusm/commit/9378bc721521edc7aeb37fd4ab13005a3893c9a3))
- CHANGELOG to remove Unreleased section ([e1bbd91](https://github.com/mwillbanks/nusm/commit/e1bbd919f7a3406fb5ba9670575ec9a5e12a3ed5))
- honor Pages base path ([5229af1](https://github.com/mwillbanks/nusm/commit/5229af12aab2a4266e5c9cb78cd5e5ad36b9ca38))
- repair Pages deployment ([2ece953](https://github.com/mwillbanks/nusm/commit/2ece9530e8eaec34ccc82d9ca3d662efe4a75e6b))

### Features

- add docs ([133b242](https://github.com/mwillbanks/nusm/commit/133b242e1cf288fa3b10f9c2f955b29db50fe3d1))

# [1.1.0](https://github.com/mwillbanks/nusm/compare/0.1.0...1.1.0) (2026-07-16)

### Features

- add optional nusm devtools inspector ([2e7f134](https://github.com/mwillbanks/nusm/commit/2e7f134c688dd261272aa3e4b8d3ed02cea5a613))

### Breaking Changes

- Remove the legacy `Derived` and `Effect` compatibility API; nusm now uses the current `@tanstack/store` contracts directly.
- Restrict `useStore` to nusm stores returned by `createNusmStore`.

### Changed

- Upgrade Bun workspace dependencies and align devtools integration with the current lifecycle API.

# 0.1.0 (2026-01-15)

### Features

- initial ([e71025b](https://github.com/mwillbanks/nusm/commit/e71025b7be9a0458bc3d58c6756a5b996e1c54fb))
