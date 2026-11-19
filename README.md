# Releases for Azure DevOps

GitHub-style releases for Azure Repos. Azure DevOps has tags but no releases. This project adds them:

- **Release notes from merged pull requests.** For a new tag, it collects the pull requests merged since the previous tag of the same package and groups them by [conventional commit](https://www.conventionalcommits.org/) type: breaking changes, features, fixes, other. Each line names the PR's author, as on GitHub (`… by Jane Doe in !123`). A `## Release notes` section in a PR description is included verbatim.
- **Release pages in the project wiki.** One page per release, an overview per package and per repository. They are readable by people and stored outside your source repositories.
- **A `releases.json` per package for [Renovate](https://docs.renovatebot.com/).** It uses the [custom datasource](https://docs.renovatebot.com/modules/datasource/custom/) format with `changelogContent`, so Renovate PRs for your internal packages carry release notes, as they do for packages on GitHub.

Status: early development. Available: a **Releases** page in Azure Repos, the pipeline task **Publish release**, a CLI and the core library they share.

## How it works

```
source repository                 project wiki repository (e.g. MyProject.wiki)
  tag tools/acme/v1.2.3   ──────►   /Releases.md                                   index of repositories
                                    /Releases/<repo>.md                            repository overview
                                    /Releases/<repo>/<package>.md                  package overview, latest notes
                                    /Releases/<repo>/<package>/1.2.3.md            one page per release
                                    /.releases/<repo>/<package>/releases.json      for Renovate
                                    /.releases/<repo>/<package>/index.json         all release records
```

- **Packages.** A tag `<prefix>/v<semver>` belongs to package `<prefix>`. This covers monorepos with one tag series per module, e.g. `tools/acme/v1.2.3`. A plain `v<semver>` tag belongs to a package named like the repository.
- **Previous tag.** By default it is the highest tag of the same package below the new version. For a stable version, pre-release tags are skipped, so the notes of `1.2.0` cover everything since `1.1.0`.
- **Writes.** Each publish is one atomic commit to the wiki repository, made through the Git Pushes API. If the branch moved meanwhile, it retries.
- **Data folder.** Files under `/.releases/` don't show in the wiki tree, and they use plain names so other tools can build their URLs.

## Releases page in Azure Repos

The extension adds **Repos › Releases** next to Tags. For the selected Git repository it shows:

- **The release list**, newest first. Each release has Latest / Pre-release badges, rendered notes, links to the tag, the changes since the previous tag and the wiki page, and a filter by package in monorepos.
- **Draft a new release**, as on GitHub:
  1. Choose the package (tag prefix) and either an existing tag without a release or a new version. A new tag is created on the chosen branch when you publish.
  2. **Generate release notes** from the PRs since the previous tag. The previous tag is detected automatically (the latest stable tag of the package below the version) and can be overridden. For a new tag, the next version is proposed from the PR titles: `feat` → minor, `fix` → patch, `!` → major. The title is filled as `<package> v<version>` (`v<version>` for repository-level tags) unless you typed your own.
  3. Edit the notes with a Markdown preview, mark the release as a pre-release if needed, and publish.
- **A release page** (`?view=release&package=…&version=…`), which you can link to directly. It has **Edit** (title, notes, pre-release) and **Delete**. Delete removes the release from the wiki; the git tag stays.
- **Settings** per project: wiki project, wiki repository, branch and root page. They default to the project wiki, its default branch and `Releases`. The project wiki is `<project>.wiki`, or, after a project rename (the wiki repository keeps its old name), the project's only hidden `*.wiki` repository.

The page acts as the signed-in user. Publishing needs **Contribute** on the wiki repository, and **Create tag** on the repository when the page creates a new tag.

## Pipeline task: Publish release

Add it after the step that creates the tag:

```yaml
- task: PublishRelease@0
  inputs:
    tag: tools/acme/v$(version)
    pathFilter: /src/tools/acme      # monorepos: only changes of this package
    # previousTag:                   # default: detected
    # ifExists: skip                 # skip | fail | replace (default skip, safe for re-runs)
    # wiki: MyProject.wiki           # default: the project wiki (found automatically)
    # dryRun: true                   # plan only, no tag, no push
```

The task uses the job access token. The build service identity (`<Project> Build Service (<org>)`) needs these permissions:
- **Contribute** on the wiki repository: Project settings → Repositories → `<Project>.wiki`.
- **Read** on the source repository.
- **Create tag**, only if you use `createTagOnCommit`.

Output variables: `releaseVersion`, `releaseUrl`, `wikiCommitId`. The release notes are also attached to the run summary.

## CLI

For local checks and for backfilling releases of existing tags:

```sh
npm ci && npm run build
export ADO_TOKEN=...        # Entra bearer token; or ADO_PAT=... for a personal access token

# print the notes a tag would get
node packages/cli/dist/cli.js notes --org https://dev.azure.com/myorg --project Proj \
  --repository Images --tag tools/acme/v1.2.3 --path /src/tools/acme

# plan a release without writing anything
node packages/cli/dist/cli.js publish --org https://dev.azure.com/myorg --project Proj \
  --repository Images --tag tools/acme/v1.2.3 --path /src/tools/acme --dry-run --out ./out

# publish releases for all existing tags of a package (oldest first, dated by the tagged commit)
node packages/cli/dist/cli.js backfill --org https://dev.azure.com/myorg --project Proj \
  --repository Images --prefix tools/acme --path /src/tools/acme
```

`--help` lists all options.

## Renovate

Define a custom datasource that reads the package's `releases.json` from the wiki repository, then point your dependencies at it:

```json
{
  "customDatasources": {
    "images": {
      "defaultRegistryUrlTemplate": "https://dev.azure.com/myorg/Proj/_apis/git/repositories/Proj.wiki/items?path=/.releases/Images/{{packageName}}/releases.json&versionDescriptor.version=wikiMaster&$format=octetStream&api-version=7.1",
      "format": "json"
    }
  },
  "hostRules": [
    { "matchHost": "dev.azure.com", "hostType": "custom.images", "token": "{{ secrets.ADO_TOKEN }}" }
  ]
}
```

Renovate's own Azure DevOps token is registered for host type `azure` and is not sent with custom datasource requests, hence the extra host rule. Renovate embeds the notes of the target version. It does not combine the notes of skipped intermediate versions; each release page links its full history.

## Development

See [AGENTS.md](AGENTS.md) for structure, commands and conventions.

## Releasing

1. Set the version and merge it to `main`. The script updates both the extension and the pipeline task, because Azure DevOps agents only download a task again when its version is higher:

   ```sh
   node scripts/version.mjs set 0.2.0
   ```

2. Publish a GitHub release with the tag `v0.2.0`. The [Publish](.github/workflows/publish.yml) workflow then:
   - checks that the tag matches both versions;
   - tests, builds and packages the extension;
   - publishes it to the Visual Studio Marketplace and waits up to 12 minutes for the Marketplace validation (a validation error fails the run; still pending only warns);
   - attaches the `.vsix` to the release, also when the Marketplace publish fails or the release is a pre-release.

   For a pre-release, the workflow packages but doesn't publish. Run it manually to package only (`dry_run`, the default) or to publish without a release.

Publishing uses no stored secret. It uses the Marketplace's [trusted publishing](https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview?view=azure-devops#publish-with-oidc-trusted-publishing): the workflow exchanges a GitHub OIDC token for a publisher credential that is valid for 15 minutes and passes it to `tfx` where it expects a PAT. One-time setup:

1. In the Marketplace, open the publisher (Manage publisher), select **Trusted Publishing** and create a policy:
   - provider GitHub Actions
   - repository owner and repository of this repository
   - workflow `publish.yml`
   - environment `marketplace`
2. Create the GitHub environment `marketplace`. Optionally limit it to tags and reviewers.

While the extension is private (`"public": false` in `vss-extension.json`), share it with organizations once in the Marketplace; updates keep the sharing.

## License

[MPL-2.0](LICENSE)
