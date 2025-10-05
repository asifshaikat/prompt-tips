import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = (new JSDOM('')).window;
const DOMPurify = createDOMPurify(window);

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(md) {
  const raw = typeof md === 'string' ? md : '';
  const html = marked.parse(raw);
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p','br','strong','em','b','i','code','pre','blockquote',
      'ul','ol','li','a','h1','h2','h3','h4','h5','h6'
    ],
    ALLOWED_ATTR: ['href','title','target','rel'],
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style','img','video','iframe','script']
  });
  return clean;
}
