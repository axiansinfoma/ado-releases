# AGENTS.md

Notes for coding agents working on this repository.

## Structure

npm workspaces, TypeScript (ESM, `nodenext`), Node >= 20.

| Path | What |
|---|---|
| `packages/core` | Library used by everything else. **Isomorphic:** only `fetch`, no Node APIs, because the hub runs it in the browser. |
| `packages/core/src/ado.ts` | Minimal Azure DevOps Git REST client: repos, tags, commit ranges, commit→PR lookup, items, pushes. |
| `packages/core/src/notes.ts` | Release notes from PRs between two versions. |
| `packages/core/src/render.ts` | Release page (with the record as hidden metadata), package and repository overviews, Renovate `releases.json`. |
| `packages/core/src/store.ts` | `WikiStore`: wiki repository layout, `publish` / `remove` (one read-plan-push loop with retry), `listPackages`, `loadPackage`. |
| `packages/core/src/release.ts` | `publishRelease`: tag → previous tag → notes → record → store. `findPreviousTag`, `listPackageTags`, `listTagPrefixes`, `proposeVersion`. |
| `packages/core/src/wikiname.ts` | Wiki page title ↔ git file name encoding (space → `-`, `-` → `%2D`, …). |
| `packages/cli` | CLI (`notes`, `publish`, `backfill`), bundled with esbuild to `dist/cli.js`. |
| `packages/task` | Azure Pipelines task `PublishRelease@0`. It reads `INPUT_*` and `ENDPOINT_AUTH_SYSTEMVSSCONNECTION` directly; there is no `azure-pipelines-task-lib` at runtime. Bundled as CommonJS to `dist/PublishReleaseV0` by `scripts/build.mjs`. |
| `packages/hub` | The "Releases" repo hub: React 19, `azure-devops-extension-sdk` 5 (host services declared locally in `src/sdk.ts`), `marked` + `DOMPurify`. Views in `src/views`, UI-independent logic in `src/model.ts` and `src/settings.ts`. Bundled as one IIFE to `dist/releases.{html,js,css}` by `scripts/build.mjs`; packaged as `hub/` in the vsix. |
| `images/` | `icon.svg` is the source of the icons. `extension-icon.png` (128 px, Marketplace and extension list) and `packages/task/icon.png` (32 px, task assistant) are rendered from it, e.g. with `@resvg/resvg-js`. Re-render both when the SVG changes. |
| `scripts/dev-manifest.mjs` | Derives the private dev extension `ado-releases-dev` (own task id/name, "Releases (dev)" hub, version `0.0.<run>`) into the gitignored `vss-extension.dev.json` + `package-dev/`. Published by `publish.yml` on every push to `main`. |
| `SECURITY.md`, `.github/ISSUE_TEMPLATE/` | Private vulnerability reporting; bug and feature forms. |
| `vss-extension.json` | Extension manifest (`tfx`). The task contribution's `name` is its on-disk path. The hub contribution's `uri` is relative to the vsix (`hub/releases.html`). Keep `version` equal to the task version in `packages/task/task.json`. `galleryFlags: ["Preview"]` while below 1.0; `links`/`repository`/`branding` shape the Marketplace listing. |

## Commands

```sh
npm ci
npm run typecheck   # all workspaces
npm test            # vitest; core and task
npm run build       # core (tsc) before cli, task and hub (esbuild); the order comes from the workspaces list
(cd packages/hub && node scripts/build.mjs --dev)   # unminified hub with inline source maps
npx tfx-cli@0.24.2 extension create --manifest-globs vss-extension.json   # needs file(1)
node scripts/version.mjs set X.Y.Z   # extension + task version together; `check [vX.Y.Z]` in CI/publish
```

Releases (steps and one-time setup in `CONTRIBUTING.md`): publishing a GitHub release `vX.Y.Z` runs `.github/workflows/publish.yml` (Marketplace trusted publishing: GitHub OIDC token exchanged for a short-lived publisher credential, passed to `tfx` as a PAT; environment `marketplace`, no stored secret). Never change only one of the two versions: agents only fetch a task whose version increased.

In memory-limited dev containers, wrap these in `memguard --` where available.

## Conventions and pitfalls

- **Commit range semantics.** In `GET commits`, `itemVersion` is the *old* version and `compareVersion` the *new* one. Swapping them returns 0 commits.
- **Commit → PR lookup.** Query both `lastMergeCommit` (squash/rebase merges, where the commit is the PR's merge commit) and `commit` (commit contained in the PR) in one `pullrequestquery` call.
- **Housekeeping commits.** Commits without a PR whose subject contains `[skip ci]` / `***NO_CI***` are left out of the notes.
- **Project wiki discovery.** Without a configured wiki repository, `AdoClient.findProjectWikiRepository` tries `<project>.wiki`, then the project's only hidden `*.wiki` repository (`includeHidden=true`); a renamed project keeps its old wiki repository name. TF401019 means "does not exist or no permission", so report 404s as "not found or not accessible", not as permission errors.
- **Wiki file names.** Page files use the wiki encoding (`wikiname.ts`). Data files under `/.releases/` use plain names, because consumers build URLs to them. Every derived file can be rebuilt from `index.json` (and from the metadata comment on each release page).
- **Push changeType.** It must be `add` for new files and `edit` for existing ones; the store lists existing files on every attempt.
- **Tests.** They run against `packages/core/test/fake-ado.ts`, an in-memory fake of the endpoints. Extend it when the client uses a new endpoint, and probe the real API first, read-only.
- **Help text.** Keep the CLI `USAGE` text, the `task.json` inputs and the README in sync. The README is also the Marketplace details page: link repository files with absolute GitHub URLs, not relative paths with the options.
- **Nothing organisation-specific in this repository.** No org or project names, URLs or internal package names, except in tests using fake names.
- **Hub UI library.** No `azure-devops-ui` (it peers on React 16) and no `azure-devops-extension-api` (it peers on SDK <= 4). Styling uses the theme CSS variables the host injects (`--background-color`, `--text-primary-color`, `--communication-background`, `--palette-neutral-*`), with light-theme fallbacks in `styles.css`.
- **Release date.** `releasedAt` (Renovate's `releaseTimestamp`) is the tag's date: `taggedBy.date` of an annotated tag (`GET annotatedtags/{tag objectId}`, returned *without* time zone, UTC), else the tagged commit's committer date, or the publish time for a tag the publish creates. `publishedAt` is when the record was written. Use `releaseDate()`, which falls back to `publishedAt` for older records.
- **Tags from the hub.** `POST annotatedtags` needs the scope `vso.code_manage`; the extension token only has `vso.code_write` and gets a 401 (which the browser reports as a CORS error, because error responses carry no CORS headers). The hub therefore creates lightweight tags through `POST refs` (`tagType: 'lightweight'`); the pipeline task keeps annotated tags (the job token has no scope limit).
- **Hub tokens.** `SDK.getAccessToken()` tokens expire, so create a client per operation (`withStore` in `src/env.ts`). The token has the manifest scopes (`vso.code_write`); changing `scopes` makes every organization re-authorize the extension.
- **Links in the hub.** Links to Azure DevOps pages use `target="_top"` and Markdown links open in a new tab. The hub runs in an iframe.
