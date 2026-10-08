# React Doctor false positives

These findings are intentional configuration entry points that React Doctor's
static module graph cannot discover.

## `package.json` dependency findings

- `@bun-security-scanner/osv`: Bun loads this package through
  `[install.security].scanner` in `bunfig.toml:1-2`. Removing it disables the
  repository's configured OSV install scanner.
- `@release-it/conventional-changelog`: release-it loads this package through
  the `package.json:113-119` plugin configuration. It is not imported by
  application source.
- `conventional-changelog-conventionalcommits`: the release-it changelog
  plugin resolves this preset by configuration. It is a runtime release tool,
  not an application import.

## `testSetup.ts` unused-file finding

Bun loads `testSetup.ts` as the test preload through `bunfig.toml:4-16`.
The file registers happy-dom, test matchers, cleanup, and the test transport
fixture before every test file. It is intentionally not imported by a source
entry point, and deleting it breaks the configured test environment.
