/**
 * Azure DevOps wiki page names <-> git file names.
 * In a wiki repository a page title is stored as file name with spaces as "-" and
 * special characters percent-encoded ("-" as "%2D", ":" as "%3A", ...).
 * See https://learn.microsoft.com/azure/devops/project/wiki/wiki-file-structure
 */

const ENCODE: Record<string, string> = {
  '%': '%25',
  '-': '%2D',
  ':': '%3A',
  '<': '%3C',
  '>': '%3E',
  '*': '%2A',
  '?': '%3F',
  '|': '%7C',
  '"': '%22',
  '#': '%23',
};

/** Page title -> file name segment (without ".md"). Slashes are not allowed in a segment. */
export function encodePageName(title: string): string {
  if (title.includes('/') || title.includes('\\')) {
    throw new Error(`wiki page name must not contain slashes: ${title}`);
  }
  let out = '';
  for (const ch of title) {
    out += ch === ' ' ? '-' : (ENCODE[ch] ?? ch);
  }
  return out;
}

/** File name segment -> page title. */
export function decodePageName(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Page path segments -> git file path of the page, e.g. ["Releases","a-b"] -> "/Releases/a%2Db.md". */
export function pageFilePath(segments: string[]): string {
  return '/' + segments.map(encodePageName).join('/') + '.md';
}

/** Page path segments -> git folder holding the page's subpages. */
export function pageFolderPath(segments: string[]): string {
  return '/' + segments.map(encodePageName).join('/');
}

/** Page path for web URLs: decoded titles joined by "/". */
export function pagePath(segments: string[]): string {
  return '/' + segments.join('/');
}
