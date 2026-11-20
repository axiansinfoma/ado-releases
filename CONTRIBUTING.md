# Contributing

Thanks for your interest. Issues and pull requests are welcome.

- **Bugs and ideas:** open an [issue](https://github.com/axiansinfoma/ado-releases/issues). For bugs, include what you did, what you expected and what happened, and the extension version.
- **Pull requests:** keep them focused. Use a [Conventional Commits](https://www.conventionalcommits.org/) title (`feat:`, `fix:`, `docs:`, …), since release notes are generated from them. Update the README and [AGENTS.md](AGENTS.md) in the same pull request when your change makes them outdated.
- **No organization-specific content:** no organization, project or package names of real Azure DevOps organizations, except fake names in tests.

## Development

Requirements: Node.js 20 or later (CI uses 24) and npm.

```sh
npm ci
npm run typecheck   # all workspaces
npm test            # vitest
npm run build       # core, CLI, task and Releases page
npx tfx-cli@0.24.2 extension create --manifest-globs vss-extension.json   # package the .vsix
```

[AGENTS.md](AGENTS.md) describes the structure, the conventions and the pitfalls of the Azure DevOps APIs.

### Dev extension

Every push to `main` (and every GitHub pre-release) publishes the private extension **Releases (dev)** (`ado-releases-dev`), so changes can be tried in Azure DevOps before a release. It is built from the same code by `scripts/dev-manifest.mjs`:

- its own extension ID, name and pipeline task (`PublishReleaseDev@0`, own task ID), so it can be installed next to the public extension;
- the Releases page appears as **Releases (dev)**;
- version `0.0.<workflow run number>`, which only grows.

It is shared with the organizations in the repository variable `DEV_SHARE_WITH` (space-separated). Install it there once from **Organization settings › Extensions › Shared**; updates install automatically. Without the variable, share it once by hand under **Manage publisher**.

To try a change from a fork, publish the `.vsix` under your own Marketplace publisher (set `publisher` in `vss-extension.json`).

## Releasing

Maintainers release from GitHub:

1. Set the version and merge it to `main`. The script updates both the extension and the pipeline task, because Azure DevOps agents only download a task again when its version is higher:

   ```sh
   node scripts/version.mjs set 1.2.3
   ```

2. Publish a GitHub release with the tag `v1.2.3`. The [Publish](.github/workflows/publish.yml) workflow then:
   - checks that the tag matches both versions;
   - tests, builds and packages the extension;
   - publishes it to the Visual Studio Marketplace and waits up to 12 minutes for the Marketplace validation (a validation error fails the run; a validation that is still pending only warns);
   - attaches the `.vsix` to the release, also when the Marketplace publish fails or the release is a pre-release.

   For a pre-release, the workflow publishes the dev extension instead (see below). Run it manually to package only (`dry_run`, the default) or to publish either channel without a release.

Publishing uses no stored secret. It uses the Marketplace's [trusted publishing](https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview?view=azure-devops#publish-with-oidc-trusted-publishing): the workflow exchanges a GitHub OIDC token for a publisher credential that is valid for 15 minutes and passes it to `tfx` where it expects a personal access token. One-time setup:

1. In the Marketplace, open the publisher (**Manage publisher**), select **Trusted Publishing** and create a policy:
   - provider: GitHub Actions
   - repository owner and repository: this repository
   - workflow: `publish.yml`
   - environment: `marketplace`
2. Create the GitHub environment `marketplace`. Optionally restrict it to tags and require reviewers.

While the extension is private (`"public": false` in `vss-extension.json`), share it with organizations once in the Marketplace; updates keep the sharing.
