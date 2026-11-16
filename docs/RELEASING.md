# Release nusm

## Write the changelog

Put user-facing changes under `## NEXT_RELEASE` at the top of
[CHANGELOG.md](../CHANGELOG.md). Add the heading when you start the next release.
Use Conventional Commits to select the next version. Use the changelog to describe
the changes and their effect on users. Keep older sections intact. Use absolute
links to documentation so that they work on GitHub and the docs site.

## Review the release

After changes merge to `main`, Release Please proposes a version in a release PR.
The release workflow stamps the first changelog heading with that version. It
dispatches CI for the exact commit after stamping. Verify the authored notes,
the proposed version, and passing CI on that commit before you merge.

If the stamper finds changed authored content, synchronize the release PR with
the latest `main` and rerun the release workflow. If CI reports a different
commit, check the current release PR head and qualify that head before merging.
Rerun the failed Release workflow to resume stamping or dispatch CI. The rerun
can find an existing pending release PR if Release Please makes no update.
A correctly stamped rerun leaves the changelog unchanged.

Merge the PR to create the bare version tag and GitHub release. The docs site
generates its release pages from the tagged changelog sections. Pending notes do
not appear on the site. The publish job verifies the tag, tests the tarball,
attaches the authored GitHub release notes, and publishes the same tarball.

## Recover publication

Dispatch the Release workflow from the tag of an existing final GitHub release.
Use the same bare tag for the workflow ref and `release_tag` input.

```sh
gh workflow run release.yml --ref 1.2.1 -f release_tag=1.2.1
```

The retry verifies that the event commit matches the tagged source for npm
provenance. If npm already has that version, the retry compares the published
integrity with the local tarball.

## Configure GitHub and npm

Allow GitHub Actions to create pull requests in the repository settings.
Review and approve any blocked PR workflow runs in GitHub. The release workflow
also dispatches the CI workflow after it stamps the current release PR.

Configure the `nusm` trusted publisher on npm for repository
`mwillbanks/nusm` and workflow `release.yml`. Enable direct publication with
`npm publish` for this trusted publisher. Use a GitHub-hosted runner so npm can
verify the workflow identity and add provenance.
