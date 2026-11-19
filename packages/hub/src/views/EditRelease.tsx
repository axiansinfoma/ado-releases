import type { ReleaseRecord } from '@ado-releases/core';
import { useEffect, useState } from 'react';
import { withStore, type Env } from '../env.js';
import { describeError } from '../model.js';
import { NotesEditor } from './NotesEditor.js';

/** Edit title, notes and pre-release flag of a published release (the tag stays as it is). */
export function EditRelease({ env, pkg, version }: { env: Env; pkg: string; version: string }) {
  const [record, setRecord] = useState<ReleaseRecord>();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [prerelease, setPrerelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    withStore(env, (_c, store) => store.loadPackage(env.repo.name, pkg))
      .then((records) => {
        const r = records.find((x) => x.version === version);
        if (!r) throw new Error(`Release ${pkg} ${version} not found.`);
        setRecord(r);
        setTitle(r.title === r.version ? '' : r.title);
        setNotes(r.notes);
        setPrerelease(r.prerelease);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [env, pkg, version]);

  const save = async () => {
    if (!record) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated: ReleaseRecord = { ...record, title: title.trim() || record.version, notes, prerelease };
      await withStore(env, (_c, store) => store.publish(updated, env.repo.webUrl, { allowReplace: true }));
      env.navigate({ view: 'release', package: pkg, version });
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <button className="link" onClick={() => env.navigate({ view: 'release', package: pkg, version })}>
          ← {pkg} {version}
        </button>
      </div>
      <h1>Edit release {version}</h1>
      {!record ? (
        error ? <div className="error">{error}</div> : <div className="muted">Loading…</div>
      ) : (
        <div className="form">
          <div className="muted">
            Tag {record.tag} · published {record.publishedAt.slice(0, 10)}
          </div>
          <label>
            Title
            <input value={title} placeholder={record.version} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <span>Release notes</span>
          <NotesEditor value={notes} onChange={setNotes} />
          <label className="inline">
            <input type="checkbox" checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} />
            Set as a pre-release
          </label>
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Update release'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => env.navigate({ view: 'release', package: pkg, version })}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
