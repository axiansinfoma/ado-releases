import {
  findPreviousTag,
  formatTag,
  generateNotes,
  isPrerelease,
  listPackageTags,
  listTagPrefixes,
  parseSemVer,
  proposeVersion,
  publishRelease,
  releaseTitle,
  type PackageTag,
  type ReleaseRecord,
  type VersionRef,
} from '@ado-releases/core';
import { useEffect, useMemo, useState } from 'react';
import { defaultBranchName, withStore, type Env } from '../env.js';
import { describeError, isValidPrefix, packageOf, pathFilterCandidate, prefixOf, tagsWithoutRelease } from '../model.js';
import { NotesEditor } from './NotesEditor.js';

const NEW_PACKAGE = '\u0000new';

interface PackageData {
  tags: PackageTag[];
  records: ReleaseRecord[];
}

/** "Draft a new release": choose or create a tag, generate notes, edit, publish. */
export function DraftRelease({ env, initialPackage, initialTag }: { env: Env; initialPackage?: string; initialTag?: string }) {
  const repoName = env.repo.name;
  const [prefixes, setPrefixes] = useState<string[]>();
  const [branches, setBranches] = useState<Array<{ name: string; objectId: string }>>([]);
  const [choice, setChoice] = useState<string>(initialPackage !== undefined ? prefixOf(initialPackage, repoName) : '');
  const [newPrefix, setNewPrefix] = useState('');
  const prefix = choice === NEW_PACKAGE ? newPrefix.trim() : choice;

  const [data, setData] = useState<PackageData>();
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [existingTag, setExistingTag] = useState('');
  const [version, setVersion] = useState('');
  const [versionTouched, setVersionTouched] = useState(false);
  // version proposed from the changes by the last "Generate release notes"
  const [proposed, setProposed] = useState<string>();
  const [target, setTarget] = useState(defaultBranchName(env.repo));
  const [previousTag, setPreviousTag] = useState('');
  // the automatic previous tag (latest release before this version), independent of a manual choice
  const [autoPrevious, setAutoPrevious] = useState<string>();
  const [title, setTitle] = useState('');
  // title last filled by "Generate release notes"; a title the user typed is never overwritten
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [prerelease, setPrerelease] = useState<boolean>();
  const [pathFilter, setPathFilter] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'' | 'notes' | 'publish'>('');
  const [error, setError] = useState<string>();

  // Packages (tag prefixes) and branches of the repository.
  useEffect(() => {
    withStore(env, async (client, store) => {
      const [tagPrefixes, packages, branchList] = await Promise.all([
        listTagPrefixes(client, env.host.project.name, env.repo),
        store.listPackages(repoName),
        client.listBranches(env.host.project.name, env.repo.id),
      ]);
      const all = new Set([...tagPrefixes, ...packages.map((p) => prefixOf(p.package, repoName))]);
      return { prefixes: [...all].sort(), branches: branchList };
    })
      .then((r) => {
        setPrefixes(r.prefixes);
        setBranches(r.branches);
        if (initialPackage === undefined && r.prefixes.length && !r.prefixes.includes('')) setChoice(r.prefixes[0]!);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [env, repoName, initialPackage]);

  // Tags, releases and the default path filter of the chosen package.
  useEffect(() => {
    if (!isValidPrefix(prefix) || (choice === NEW_PACKAGE && !prefix)) {
      setData({ tags: [], records: [] });
      return;
    }
    let cancelled = false;
    withStore(env, async (client, store) => {
      const [tags, records] = await Promise.all([
        listPackageTags(client, env.host.project.name, env.repo, prefix),
        store.loadPackage(repoName, packageOf(prefix, repoName)),
      ]);
      const candidate = pathFilterCandidate(prefix);
      const exists = candidate
        ? await client.pathExists(env.host.project.name, env.repo.id, candidate, defaultBranchName(env.repo))
        : false;
      return { tags, records, path: exists ? candidate! : '' };
    })
      .then((r) => {
        if (cancelled) return;
        setData({ tags: r.tags, records: r.records });
        setPathFilter(r.path);
        const open = tagsWithoutRelease(r.tags, r.records);
        const wanted = initialTag && open.find((t) => t.tag === initialTag);
        if (wanted || open.length) {
          setMode('existing');
          setExistingTag((wanted || open[0]!).tag);
        } else {
          setMode('new');
          setExistingTag('');
        }
        setPreviousTag('');
        setProposed(undefined);
      })
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [env, prefix, choice, repoName, initialTag]);

  const openTags = useMemo(() => (data ? tagsWithoutRelease(data.tags, data.records) : []), [data]);
  const newTag = version && parseSemVer(version) ? formatTag(prefix, version) : '';
  const tag = mode === 'existing' ? existingTag : newTag;
  const tagVersion = mode === 'existing' ? data?.tags.find((t) => t.tag === existingTag)?.version : version;
  const effectivePrerelease = prerelease ?? (tagVersion ? isPrerelease(tagVersion) : false);
  const tagTaken = mode === 'new' && !!newTag && !!data?.tags.some((t) => t.tag === newTag);

  /** The automatic previous tag: the highest stable tag of the package below the version. */
  const automaticPrevious = async (): Promise<string | undefined> => {
    if (!data) return undefined;
    if (tagVersion) {
      return withStore(env, (client) => findPreviousTag(client, env.host.project.name, env.repo, prefix, tagVersion));
    }
    // New tag without a version yet: everything since the highest stable tag.
    return data.tags.find((t) => !isPrerelease(t.version))?.tag ?? data.tags[0]?.tag;
  };

  // Keep the "Automatic (…)" label current, whatever is selected manually.
  useEffect(() => {
    let cancelled = false;
    setAutoPrevious(undefined);
    automaticPrevious()
      .then((t) => !cancelled && setAutoPrevious(t ?? ''))
      .catch(() => !cancelled && setAutoPrevious(undefined));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefix, tagVersion]);

  const resolvePrevious = async (): Promise<string | undefined> => previousTag || (await automaticPrevious());

  const generate = async () => {
    setBusy('notes');
    setError(undefined);
    try {
      const previous = await resolvePrevious();
      const to: VersionRef = mode === 'existing' ? { version: existingTag, type: 'tag' } : { version: target, type: 'branch' };
      const generated = await withStore(env, (client) =>
        generateNotes(client, {
          project: env.host.project.name,
          repository: env.repo,
          to,
          previousTag: previous,
          pathFilter: pathFilter.trim() || undefined,
        }),
      );
      setNotes(generated.markdown);
      let releaseVersion = tagVersion;
      if (mode === 'new' && data) {
        const next = proposeVersion(data.tags.map((t) => t.version), generated.changeType);
        setProposed(next);
        // a version the user typed (or the browser filled in) is kept; the proposal is shown next to it
        if (!versionTouched) {
          releaseVersion = next;
          setVersion(next);
        }
      }
      if (releaseVersion && (!title.trim() || title === generatedTitle)) {
        const next = releaseTitle(prefix, releaseVersion);
        setTitle(next);
        setGeneratedTitle(next);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    setBusy('publish');
    setError(undefined);
    try {
      if (!tag) throw new Error(mode === 'new' ? 'Enter a version like 1.2.3.' : 'Choose a tag.');
      if (tagTaken) throw new Error(`Tag ${newTag} already exists. Choose it under "Existing tag".`);
      const commit = mode === 'new' ? branches.find((b) => b.name === target)?.objectId : undefined;
      if (mode === 'new' && !commit) throw new Error(`Branch ${target} not found.`);
      const res = await withStore(env, (client, store) =>
        publishRelease(client, store, {
          project: env.host.project.name,
          repository: env.repo.id,
          tag,
          previousTag: previousTag || undefined,
          package: packageOf(prefix, repoName),
          pathFilter: pathFilter.trim() || undefined,
          title: title.trim() || undefined,
          prerelease: effectivePrerelease,
          notes: notes.trim() ? notes : undefined,
          createTagOnCommit: commit,
          // the extension token has vso.code_write; annotated tags would need vso.code_manage
          tagType: 'lightweight',
          publishedBy: env.host.user.displayName,
        }),
      );
      env.navigate({ view: 'release', package: res.record.package, version: res.record.version });
    } catch (e) {
      setError(describeError(e));
      setBusy('');
    }
  };

  if (!prefixes) {
    return (<><Back env={env} />{error ? <div className="error">{error}</div> : <div className="muted">Loading…</div>}</>);
  }

  return (
    <>
      <Back env={env} />
      <h1>Draft a new release</h1>
      <div className="form">
        <label>
          Package
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {prefixes.map((p) => (
              <option key={p || '(repo)'} value={p}>
                {p ? `${p}  (tags ${p}/v…)` : `${repoName}  (tags v…)`}
              </option>
            ))}
            {!prefixes.includes('') && <option value="">{repoName} (tags v…)</option>}
            <option value={NEW_PACKAGE}>New package…</option>
          </select>
        </label>
        {choice === NEW_PACKAGE && (
          <label>
            Tag prefix of the new package
            <input value={newPrefix} placeholder="tools/my-tool" onChange={(e) => setNewPrefix(e.target.value)} />
            {!isValidPrefix(newPrefix.trim()) && <span className="field-error">Use path segments of letters, digits, ".", "_" and "-".</span>}
          </label>
        )}

        <fieldset>
          <legend>Tag</legend>
          <label className="inline">
            <input type="radio" checked={mode === 'existing'} disabled={!openTags.length} onChange={() => setMode('existing')} />
            Existing tag without release
          </label>
          <label className="inline">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            Create a new tag
          </label>
          {mode === 'existing' ? (
            <select value={existingTag} onChange={(e) => setExistingTag(e.target.value)}>
              {openTags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag}
                </option>
              ))}
            </select>
          ) : (
            <div className="row">
              <label>
                Version
                <input
                  value={version}
                  placeholder="1.2.3"
                  autoComplete="off"
                  onChange={(e) => {
                    setVersion(e.target.value.trim().replace(/^v/, ''));
                    setVersionTouched(true);
                  }}
                />
                {version && !parseSemVer(version) && <span className="field-error">Not a semantic version.</span>}
                {tagTaken && <span className="field-error">Tag {newTag} already exists.</span>}
                {newTag && !tagTaken && <span className="muted">Tag: {newTag}</span>}
                {proposed && proposed !== version && (
                  <span className="muted">
                    Suggested from the changes: {proposed}{' '}
                    <button
                      className="link"
                      onClick={() => {
                        setVersion(proposed);
                        setVersionTouched(false);
                        if (!title.trim() || title === generatedTitle) {
                          const next = releaseTitle(prefix, proposed);
                          setTitle(next);
                          setGeneratedTitle(next);
                        }
                      }}
                    >
                      Use
                    </button>
                  </span>
                )}
              </label>
              <label>
                Target
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>

        <div className="row">
          <label>
            Previous tag
            <select value={previousTag} onChange={(e) => setPreviousTag(e.target.value)}>
              <option value="">Automatic{autoPrevious !== undefined ? ` (${autoPrevious || 'none'})` : ''}</option>
              {data?.tags
                .filter((t) => t.tag !== tag)
                .map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Path filter
            <input value={pathFilter} placeholder="(whole repository)" onChange={(e) => setPathFilter(e.target.value)} />
          </label>
        </div>

        <label>
          Title
          <input value={title} placeholder={tagVersion || 'Defaults to the version'} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className="notes-header">
          <span>Release notes</span>
          <button className="secondary" disabled={!!busy || (mode === 'existing' && !existingTag)} onClick={() => void generate()}>
            {busy === 'notes' ? 'Generating…' : 'Generate release notes'}
          </button>
        </div>
        <NotesEditor value={notes} onChange={setNotes} placeholder="Leave empty to generate the notes when publishing." />

        <label className="inline">
          <input type="checkbox" checked={effectivePrerelease} onChange={(e) => setPrerelease(e.target.checked)} />
          Set as a pre-release
        </label>

        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="primary" disabled={!!busy || !tag || tagTaken} onClick={() => void publish()}>
            {busy === 'publish' ? 'Publishing…' : 'Publish release'}
          </button>
          {mode === 'new' && newTag && <span className="muted">Creates tag {newTag} on {target}.</span>}
        </div>
      </div>
    </>
  );
}

function Back({ env }: { env: Env }) {
  return (
    <div className="toolbar">
      <button className="link" onClick={() => env.navigate({ view: 'list' })}>
        ← Releases
      </button>
    </div>
  );
}
