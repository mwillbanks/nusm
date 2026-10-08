# Dependency upgrades

## Scope and discovery

Inspect repository instructions, manifests, lockfiles, package-manager configuration,
and CI commands before changing dependencies. Record the starting Git state and
preserve unrelated changes.

Run `bun outdated -r` in each independently installed project. Include private
source-linked manifests, which can exist without their own lockfile. Separate
direct dependencies, development tools, optional peers, and transitive overrides.

Use the registry's stable `latest` tag unless the project intentionally tracks a
prerelease. Keep public peer ranges compatible with supported consumers; updating
development dependencies does not automatically justify narrowing peer support.

## Review before upgrading

For each version change, inspect primary release notes, changelogs, published
metadata, exports, and declarations. Check:

- Runtime and engine requirements, module formats, and export paths.
- Breaking API changes and changed defaults.
- Framework, plugin, and peer compatibility.
- Serialization, equality, persistence, and lifecycle behavior.
- Security fixes and behavior affected by transitive dependency changes.
- Build, test, formatting, linting, and release-tool configuration.

When release notes are incomplete, inspect the published package or source changes
for the APIs the repository actually consumes. Distinguish verified compatibility
from assumptions. Ask for a decision when alternatives change public behavior,
architecture, or the supported runtime floor.

Keep package-specific review notes and scan artifacts outside committed source.
Commit only durable implementation, tests, configuration, and user-facing
documentation changes required by the upgrade.

## Apply changes

Use the package manager to update manifests and lockfiles. Never edit generated
lockfile resolution data manually. Run `bun update --latest -r` in each independent
project when the intended scope includes direct major-version upgrades.

Synchronize source-linked package requirements with the published package.
Retain appropriate peer ranges and document intentional compatibility changes.
Do not force every transitive dependency to its newest major version: consumers
must support the overridden version.

Review overrides against the resolved lockfiles. Remove an unused override only
after proving that no installed consumer or intended security policy needs it.
For active security overrides, verify that upgrades retain the protection.

Keep tooling migrations coherent across package scripts, staged-file hooks,
configuration, CI, and development documentation. Use installed binaries rather
than commands that download tools implicitly.

## Validate

Run focused checks first, followed by every applicable repository gate:

1. Formatting checks and affected-target typechecks.
2. Lint and focused behavioral tests.
3. Full package tests with the configured coverage threshold.
4. Declaration and production builds.
5. Example tests and builds.
6. Website typecheck, static build, and generated-output checks.
7. Frozen-lockfile installation for every independent project.
8. Dependency vulnerability scanning.
9. Package dry-run and `git diff --check`.
10. Final source, configuration, documentation, and lockfile review.

Use the website's configured deployment base path for both its build and
verification commands. Exercise changed observable behavior; do not add tests
that only inflate coverage or weaken assertions to accommodate an upgrade.

Rerun `bun outdated -r` after updating. Confirm source-linked manifests remain
aligned. Treat a successful install as dependency resolution evidence, not proof
of behavioral compatibility.

If validation fails, diagnose and remediate the cause, then rerun all affected
downstream gates. Do not weaken security or coverage requirements to pass.

## Deliver

Review every changed file, including formatter churn and generated lockfile
changes. Stage only intended paths. Create a Conventional Commit only when
requested and after all applicable gates pass. Do not push or publish without
separate authorization.
