import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

/** Only pictures from the app itself are drawn. Any other one would be
 * fetched by every reader's browser from wherever the file's author points,
 * handing over their IP address, so it shows as a link instead. */
function isOwnOrigin(src: string): boolean {
  try { return new URL(src, window.location.href).origin === window.location.origin; } catch { return false; }
}

const components: Components = {
  img: ({ src, alt }) => {
    if (typeof src !== 'string' || !src) return null;
    if (isOwnOrigin(src)) return <img src={src} alt={alt ?? ''} />;
    return <a href={src} target="_blank" rel="noopener noreferrer">{alt || src}</a>;
  },
};

// Split into its own chunk (see TextPreviewCard's React.lazy import of this
// module) — react-markdown + remark-gfm + rehype-sanitize only cost bytes
// for a viewer who actually opens a markdown preview, not the main bundle.
export default function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>{content}</ReactMarkdown>
    </div>
  );
}
