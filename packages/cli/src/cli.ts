/**
 * ado-releases CLI
 *
 * Synopsis:
 *   ado-releases notes   --org <url> --project <p> --repository <r> --tag <t> [--previous-tag <t>] [--path <p>]
 *   ado-releases publish --org <url> --project <p> --repository <r> --tag <t> [options]
 *   ado-releases backfill --org <url> --project <p> --repository <r> --prefix <tag prefix> [options]
 *
 * Authentication: ADO_TOKEN (Bearer, e.g. Entra or System.AccessToken) or ADO_PAT (personal access token).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AdoClient,
  compareVersions,
  findPreviousTag,
  generateNotes,
  parseTag,
  publishRelease,
  WikiStore,
} from '@ado-releases/core';

const USAGE = `Usage:
  ado-releases notes    --org URL --project P --repository R --tag T [--previous-tag T] [--path P]
  ado-releases publish  --org URL --project P --repository R --tag T [options]
  ado-releases backfill --org URL --project P --repository R --prefix PREFIX [options]

Generate GitHub-style release notes for Azure DevOps tags and publish them to a project wiki
(release pages + Renovate-compatible releases.json).

Common options:
  --org URL             Organization URL, e.g. https://dev.azure.com/myorg
  --project P           Project of the source repository
  --repository R        Source repository name or id
  --path P              Only changes below this path (monorepos), e.g. /src/tools/acme
  --previous-tag T      Previous tag (default: highest tag of the same package below the new version)

publish / backfill options:
  --tag T               Tag to publish, e.g. tools/acme/v1.2.3 or v1.2.3
  --prefix PREFIX       backfill: tag prefix of the package ("" for v1.2.3 tags); publishes all tags without a release
  --package NAME        Package name (default: tag prefix, or the repository name for v-tags)
  --title TEXT          Release title (default: the version)
  --prerelease          Mark as pre-release (default: when the version has a pre-release part)
  --create-tag-on SHA   Create the annotated tag on this commit if it does not exist
  --wiki-project P      Project of the wiki (default: --project)
  --wiki NAME           Wiki repository (default: <wiki-project>.wiki)
  --wiki-branch B       Wiki branch (default: the wiki repository's default branch)
  --root NAME           Root page for releases (default: Releases)
  --allow-replace       Replace an existing release of the same version
  --dry-run             Do not create tags or push; with --out, write the planned files there
  --out DIR             Directory for --dry-run output
  -h, --help            Show this help

Environment:
  ADO_TOKEN             Bearer token (Entra ID, System.AccessToken)
  ADO_PAT               Personal access token (used when ADO_TOKEN is not set)

Example:
  ADO_TOKEN=... ado-releases publish --org https://dev.azure.com/myorg --project Proj \\
    --repository Images --tag tools/acme/v1.2.3 --path /src/tools/acme --dry-run --out ./out
`;

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      org: { type: 'string' },
      project: { type: 'string' },
      repository: { type: 'string' },
      tag: { type: 'string' },
      prefix: { type: 'string' },
      'previous-tag': { type: 'string' },
      path: { type: 'string' },
      package: { type: 'string' },
      title: { type: 'string' },
      prerelease: { type: 'boolean' },
      'create-tag-on': { type: 'string' },
      'wiki-project': { type: 'string' },
      wiki: { type: 'string' },
      'wiki-branch': { type: 'string' },
      root: { type: 'string' },
      'allow-replace': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const org = values.org ?? fail('--org is required');
  const project = values.project ?? fail('--project is required');
  const repository = values.repository ?? fail('--repository is required');
  const token = process.env.ADO_TOKEN || process.env.ADO_PAT || fail('set ADO_TOKEN or ADO_PAT');
  const client = new AdoClient({
    organizationUrl: org,
    token,
    authScheme: process.env.ADO_TOKEN ? 'bearer' : 'pat',
  });
  const wikiProject = values['wiki-project'] ?? project;
  const store = new WikiStore(client, {
    project: wikiProject,
    repository: values.wiki, // default: the project wiki, found by name or as the hidden *.wiki repository
    branch: values['wiki-branch'],
    root: values.root,
  });

  if (command === 'notes') {
    const tag = values.tag ?? fail('--tag is required');
    const parsed = parseTag(tag) ?? fail(`not a version tag: ${tag}`);
    const repo = await client.getRepository(project, repository);
    const previousTag = values['previous-tag'] ?? (await findPreviousTag(client, project, repo, parsed.prefix, parsed.version));
    const notes = await generateNotes(client, {
      project,
      repository: repo,
      to: { version: tag, type: 'tag' },
      previousTag,
      pathFilter: values.path,
    });
    process.stderr.write(`previous tag: ${previousTag ?? '(none)'}, change type: ${notes.changeType}\n`);
    process.stdout.write(notes.markdown);
    return;
  }

  const common = {
    project,
    repository,
    package: values.package,
    pathFilter: values.path,
    title: values.title,
    prerelease: values.prerelease,
    allowReplace: values['allow-replace'],
    dryRun: values['dry-run'],
  };

  if (command === 'publish') {
    const tag = values.tag ?? fail('--tag is required');
    const res = await publishRelease(client, store, {
      ...common,
      tag,
      previousTag: values['previous-tag'],
      createTagOnCommit: values['create-tag-on'],
    });
    await report(res.files, values.out, values['dry-run']);
    process.stderr.write(
      `${values['dry-run'] ? 'planned' : 'published'} ${res.record.package} ${res.record.version}` +
        ` (previous ${res.record.previousTag ?? 'none'}, ${res.files.length} files${res.wikiCommitId ? `, wiki commit ${res.wikiCommitId}` : ''})\n`,
    );
    return;
  }

  if (command === 'backfill') {
    if (values.prefix === undefined) fail('--prefix is required');
    const prefix = values.prefix;
    const repo = await client.getRepository(project, repository);
    const pkg = values.package ?? (prefix || repo.name);
    const done = new Set((await store.loadPackage(repo.name, pkg)).map((r) => r.version));
    const tags = (await client.listTags(project, repo.id, prefix ? `${prefix}/v` : 'v'))
      .map((t) => ({ tag: t.name, parsed: parseTag(t.name) }))
      .filter((t) => t.parsed && t.parsed.prefix === prefix && !done.has(t.parsed.version))
      .sort((a, b) => compareVersions(a.parsed!.version, b.parsed!.version));
    process.stderr.write(`${tags.length} tags without release\n`);
    for (const t of tags) {
      // the release date comes from the tag (tagger or commit date), see publishRelease
      const res = await publishRelease(client, store, { ...common, tag: t.tag });
      await report(res.files, values.out && join(values.out, t.parsed!.version), values['dry-run']);
      process.stderr.write(`${values['dry-run'] ? 'planned' : 'published'} ${t.tag}\n`);
    }
    return;
  }

  fail(`unknown command ${command}`);
}

async function report(files: Array<{ path: string; content: string }>, out: string | undefined, dryRun: boolean | undefined) {
  if (!dryRun) return;
  if (!out) {
    for (const f of files) process.stdout.write(`${f.path}\n`);
    return;
  }
  for (const f of files) {
    const target = join(out, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  process.stderr.write(`wrote ${files.length} files to ${out}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
