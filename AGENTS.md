# AGENTS.md

Notes for coding agents working on this repository.

## Structure

npm workspaces, TypeScript (ESM, `nodenext`), Node >= 20.

| Path | What |
|---|---|
| `packages/core` | Library used by everything else. **Isomorphic:** only `fetch`, no Node APIs, because the planned extension page runs it in the browser. |
| `packages/core/src/ado.ts` | Minimal Azure DevOps Git REST client: repos, tags, commit ranges, commit→PR lookup, items, pushes. |
| `packages/core/src/notes.ts` | Release notes from PRs between two versions. |
| `packages/core/src/render.ts` | Release page (with the record as hidden metadata), package and repository overviews, Renovate `releases.json`. |
| `packages/core/src/store.ts` | `WikiStore`: wiki repository layout, planning the files of a publish, atomic push with retry. |
| `packages/core/src/release.ts` | `publishRelease`: tag → previous tag → notes → record → store. `findPreviousTag`. |
| `packages/core/src/wikiname.ts` | Wiki page title ↔ git file name encoding (space → `-`, `-` → `%2D`, …). |
| `packages/cli` | CLI (`notes`, `publish`, `backfill`), bundled with esbuild to `dist/cli.js`. |
| `packages/task` | Azure Pipelines task `PublishRelease@0`. It reads `INPUT_*` and `ENDPOINT_AUTH_SYSTEMVSSCONNECTION` directly; there is no `azure-pipelines-task-lib` at runtime. Bundled as CommonJS to `dist/PublishReleaseV0` by `scripts/build.mjs`. |
| `vss-extension.json` | Extension manifest (`tfx`). The task contribution's `name` is its on-disk path. |

## Commands

```sh
npm ci
npm run typecheck   # all workspaces
npm test            # vitest; core and task
npm run build       # core (tsc) before cli and task (esbuild); the order comes from the workspaces list
npx tfx-cli@0.24.2 extension create --manifest-globs vss-extension.json   # needs file(1)
```

In memory-limited dev containers, wrap these in `memguard --` where available.

## Conventions and pitfalls

- **Commit range semantics.** In `GET commits`, `itemVersion` is the *old* version and `compareVersion` the *new* one. Swapping them returns 0 commits.
- **Commit → PR lookup.** Query both `lastMergeCommit` (squash/rebase merges, where the commit is the PR's merge commit) and `commit` (commit contained in the PR) in one `pullrequestquery` call.
- **Housekeeping commits.** Commits without a PR whose subject contains `[skip ci]` / `***NO_CI***` are left out of the notes.
- **Wiki file names.** Page files use the wiki encoding (`wikiname.ts`). Data files under `/.releases/` use plain names, because consumers build URLs to them. Every derived file can be rebuilt from `index.json` (and from the metadata comment on each release page).
- **Push changeType.** It must be `add` for new files and `edit` for existing ones; the store lists existing files on every attempt.
- **Tests.** They run against `packages/core/test/fake-ado.ts`, an in-memory fake of the endpoints. Extend it when the client uses a new endpoint, and probe the real API first, read-only.
- **Help text.** Keep the CLI `USAGE` text, the `task.json` inputs and the README in sync with the options.
- **Nothing organisation-specific in this repository.** No org or project names, URLs or internal package names, except in tests using fake names.
