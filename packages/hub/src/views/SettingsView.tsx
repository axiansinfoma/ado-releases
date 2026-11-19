import { useEffect, useState } from 'react';
import type { Env } from '../env.js';
import { describeError } from '../model.js';
import { loadSettings, resolveWikiLocation, saveSettings, type WikiSettings } from '../settings.js';

/** Where this project's releases are stored. Empty fields use the defaults. */
export function SettingsView({ env }: { env: Env }) {
  const [settings, setSettings] = useState<WikiSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    env.host
      .dataManager()
      .then((dm) => loadSettings(dm, env.host.project.id))
      .then(setSettings)
      .catch((e: unknown) => setError(describeError(e)));
  }, [env]);

  const defaults = resolveWikiLocation(env.host.project.name, {});
  const field = (key: keyof WikiSettings, label: string, placeholder: string) => (
    <label>
      {label}
      <input
        value={settings?.[key] ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          setSaved(false);
          setSettings({ ...settings, [key]: e.target.value });
        }}
      />
    </label>
  );

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveSettings(await env.host.dataManager(), env.host.project.id, settings);
      await env.reloadSettings();
      setSaved(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <button className="link" onClick={() => env.navigate({ view: 'list' })}>
          ← Releases
        </button>
      </div>
      <h1>Settings</h1>
      <p className="muted">
        Where releases of this project are stored. Empty fields use the defaults. Pipelines using the{' '}
        <code>PublishRelease@0</code> task need the same values as task inputs.
      </p>
      {!settings ? (
        error ? <div className="error">{error}</div> : <div className="muted">Loading…</div>
      ) : (
        <div className="form">
          {field('wikiProject', 'Wiki project', defaults.project)}
          {field('wiki', 'Wiki repository', 'project wiki (found automatically)')}
          {field('branch', 'Wiki branch', "the wiki repository's default branch")}
          {field('root', 'Root page', defaults.root ?? 'Releases')}
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="muted">Saved. Current wiki: {env.wiki.repository}</span>}
          </div>
        </div>
      )}
    </>
  );
}
