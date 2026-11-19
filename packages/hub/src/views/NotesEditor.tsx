import { useState } from 'react';
import { renderMarkdown } from '../markdown.js';

/** Markdown editor with Write / Preview tabs. */
export function NotesEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="notes-editor">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={!preview} className={!preview ? 'tab active' : 'tab'} onClick={() => setPreview(false)}>
          Write
        </button>
        <button role="tab" aria-selected={preview} className={preview ? 'tab active' : 'tab'} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="markdown preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value || '_Nothing to preview._') }} />
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={16} placeholder={placeholder} spellCheck />
      )}
    </div>
  );
}
