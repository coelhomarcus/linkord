type Highlight = (input: string) => string;
type GrammarModule = { language: () => Highlight };

// Each grammar is its own package, imported on first use: a code preview in
// one language never drags the other grammars into the main bundle.
export const GRAMMARS: Record<string, () => Promise<GrammarModule>> = {
  bash: () => import('@twinkleplop/bash'),
  css: () => import('@twinkleplop/css'),
  diff: () => import('@twinkleplop/diff'),
  go: () => import('@twinkleplop/go'),
  html: () => import('@twinkleplop/html'),
  javascript: () => import('@twinkleplop/javascript'),
  markdown: () => import('@twinkleplop/markdown'),
  python: () => import('@twinkleplop/python'),
  rust: () => import('@twinkleplop/rust'),
  sql: () => import('@twinkleplop/sql'),
  svelte: () => import('@twinkleplop/svelte'),
  toml: () => import('@twinkleplop/toml'),
  tsx: () => import('@twinkleplop/tsx'),
  typescript: () => import('@twinkleplop/typescript'),
  yaml: () => import('@twinkleplop/yaml'),
};

// Names people type after ``` plus the ids the server derives from file
// extensions, mapped onto a grammar. Only languages whose output was checked
// by eye belong here: SCSS through the CSS grammar mislabels `$vars` as
// selectors and INI through TOML mislabels `;` comments, so those (and
// languages with no grammar, like Java or C) stay plain instead of wrong.
export const ALIASES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'javascript', jsonc: 'javascript',
  jsx: 'tsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python',
  sh: 'bash', shell: 'bash', shellscript: 'bash', zsh: 'bash',
  yml: 'yaml',
  rs: 'rust',
  golang: 'go',
  md: 'markdown',
  patch: 'diff',
  xml: 'html', vue: 'html',
};

// The only markup the highlighter writes. Its output goes into
// dangerouslySetInnerHTML, so it is checked before use: a grammar update that
// stopped escaping the source would otherwise let a message inject forms,
// links or fake panels, which the CSP does not block. Every `<` must open
// one of these tags; the scan is linear and cheap next to the highlighting.
const OTHER_MARKUP = /<(?!\/?(?:pre|code|span)(?: class="[\w -]*")?>)/;

/** Whether `html` holds only `<pre>`, `<code>` and `<span>` tags with at most
 * a plain `class` attribute, so everything else in it is escaped text. */
export function isHighlighterMarkup(html: string): boolean {
  return !OTHER_MARKUP.test(html);
}

const highlighters = new Map<string, Promise<Highlight>>();

function getHighlighter(grammar: string): Promise<Highlight> {
  let pending = highlighters.get(grammar);
  if (!pending) {
    pending = GRAMMARS[grammar]!().then((mod) => mod.language());
    highlighters.set(grammar, pending);
  }
  return pending;
}

/** Renders `code` to a self-contained, already-escaped HTML string (the
 * highlighter escapes the source text itself; only its own fixed
 * <pre>/<code>/<span> markup wraps it), or null when the language isn't
 * recognized/supported, or the output holds any other markup, so the caller
 * can fall back to a plain <pre>. Never throws. */
export async function highlightCode(code: string, language: string | null): Promise<string | null> {
  if (!language) return null;
  const name = language.toLowerCase();
  const grammar = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  if (!Object.hasOwn(GRAMMARS, grammar)) return null;
  try {
    const highlight = await getHighlighter(grammar);
    const html = highlight(code.replace(/\n$/, ''));
    return isHighlighterMarkup(html) ? html : null;
  } catch {
    return null;
  }
}
