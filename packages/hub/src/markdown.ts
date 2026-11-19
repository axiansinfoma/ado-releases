import DOMPurify from 'dompurify';
import { marked } from 'marked';

let hooked = false;

/** Markdown -> sanitized HTML. Links open in a new tab: the hub runs inside an iframe. */
export function renderMarkdown(markdown: string): string {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
