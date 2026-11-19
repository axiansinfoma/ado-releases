import { compareUrl, tagUrl, type GitRepository, type ReleaseRecord } from '@ado-releases/core';
import { renderMarkdown } from '../markdown.js';

export interface ReleaseCardProps {
  record: ReleaseRecord;
  repo: GitRepository;
  isLatest: boolean;
  /** Web URL of the release page in the wiki. */
  wikiUrl?: string;
  showPackage: boolean;
  onOpen?: () => void;
  children?: React.ReactNode;
}

/** One release like on a GitHub releases page: header, badges, links, rendered notes. */
export function ReleaseCard({ record, repo, isLatest, wikiUrl, showPackage, onOpen, children }: ReleaseCardProps) {
  const heading = record.title && record.title !== record.version ? `${record.title}` : record.version;
  return (
    <article className="release">
      <aside className="release-meta">
        <div className="release-date" title={record.publishedAt}>
          {record.publishedAt.slice(0, 10)}
        </div>
        {record.publishedBy && <div className="muted">{record.publishedBy}</div>}
        <a className="tag-link" href={tagUrl(repo, record.tag)} target="_top">
          {record.tag}
        </a>
        <div className="muted mono">{record.commit.slice(0, 8)}</div>
      </aside>
      <div className="release-body">
        <header className="release-header">
          <h2>
            {onOpen ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onOpen();
                }}
              >
                {heading}
              </a>
            ) : (
              heading
            )}
          </h2>
          {isLatest && <span className="badge latest">Latest</span>}
          {record.prerelease && <span className="badge prerelease">Pre-release</span>}
          {showPackage && <span className="badge package">{record.package}</span>}
        </header>
        <div className="release-links">
          {record.previousTag && (
            <a href={compareUrl(repo, record.previousTag, { version: record.tag, type: 'tag' })} target="_top">
              Changes since {record.previousTag}
            </a>
          )}
          {wikiUrl && (
            <a href={wikiUrl} target="_top">
              Wiki page
            </a>
          )}
        </div>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(record.notes) }} />
        {children}
      </div>
    </article>
  );
}
