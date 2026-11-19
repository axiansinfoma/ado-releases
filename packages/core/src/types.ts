/**
 * A published release of one package (release stream) of a repository.
 * This is the record stored as metadata on each release page in the wiki;
 * every other file (overviews, .order, releases.json) is derived from these.
 */
export interface ReleaseRecord {
  /** Schema version of this record. */
  schema: 1;
  /** Repository name, e.g. "Container-Images". */
  repository: string;
  /** Package (release stream) inside the repository, e.g. "build-tools/cert-agent". Equals the repository name for single-package repos. */
  package: string;
  /** Version without prefix, e.g. "0.14.4". */
  version: string;
  /** Full tag name without refs/tags/, e.g. "build-tools/cert-agent/v0.14.4". */
  tag: string;
  /** Previous tag the notes were generated against, if any. */
  previousTag?: string;
  /** Commit the tag points to. */
  commit: string;
  /** Release title, defaults to the version. */
  title: string;
  /** Release notes in Markdown. */
  notes: string;
  /** Pre-release (not stable). */
  prerelease: boolean;
  /** ISO timestamp of publication. */
  publishedAt: string;
  /** Display name of whoever published the release. */
  publishedBy?: string;
}

/** Where releases are stored: a git repository backing an Azure DevOps wiki. */
export interface WikiLocation {
  /** Project that holds the wiki. */
  project: string;
  /**
   * Wiki repository name or id, e.g. "MyProject.wiki". When omitted, the project wiki is found:
   * "<project>.wiki", or the project's only hidden "*.wiki" repository (after a project rename the
   * wiki repository keeps its old name).
   */
  repository?: string;
  /** Wiki name used in web URLs. Defaults to the repository name. */
  wikiName?: string;
  /** Branch, e.g. "wikiMaster". Resolved from the repository default branch when omitted. */
  branch?: string;
  /** Root folder for release pages, without leading/trailing slash. Default "Releases". */
  root?: string;
}

/** A change entry used to build release notes. */
export interface ChangeEntry {
  pullRequestId?: number;
  title: string;
  url?: string;
  /** Text of a "Release notes" section in the PR description, if any. */
  releaseNotes?: string;
  commitId?: string;
  /** Display name of the PR's creator, or the commit author for changes without a PR. */
  author?: string;
}

/** Item of a git push: add or edit a file with full text content. */
export interface FileChange {
  path: string;
  content: string;
}
