import type { WikiLocation } from '@ado-releases/core';
import type { IExtensionDataManager } from './sdk.js';

/** What a project can override; empty fields fall back to the defaults. */
export interface WikiSettings {
  /** Project of the wiki; default: the current project. */
  wikiProject?: string;
  /** Wiki repository; default: "<wiki project>.wiki" (the project wiki). */
  wiki?: string;
  /** Wiki branch; default: the wiki repository's default branch. */
  branch?: string;
  /** Root page; default: "Releases". */
  root?: string;
}

export function settingsKey(projectId: string): string {
  return `wiki-location-${projectId}`;
}

/** Wiki location for a project from its (possibly empty) settings. */
export function resolveWikiLocation(projectName: string, settings: WikiSettings): WikiLocation {
  const project = settings.wikiProject?.trim() || projectName;
  return {
    project,
    repository: settings.wiki?.trim() || `${project}.wiki`,
    branch: settings.branch?.trim() || undefined,
    root: settings.root?.trim() || 'Releases',
  };
}

export async function loadSettings(data: IExtensionDataManager, projectId: string): Promise<WikiSettings> {
  try {
    return (await data.getValue<WikiSettings>(settingsKey(projectId), { scopeType: 'Default', defaultValue: {} })) ?? {};
  } catch {
    // No settings document yet, or extension data not reachable: use the defaults.
    return {};
  }
}

export async function saveSettings(data: IExtensionDataManager, projectId: string, settings: WikiSettings): Promise<void> {
  const clean: WikiSettings = {};
  for (const [k, v] of Object.entries(settings) as Array<[keyof WikiSettings, string | undefined]>) {
    if (v?.trim()) clean[k] = v.trim();
  }
  await data.setValue(settingsKey(projectId), clean, { scopeType: 'Default' });
}
