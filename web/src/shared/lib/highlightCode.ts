type Highlight = (input: string) => string;
type GrammarModule = { language: () => Highlight };

// Each grammar is its own package, imported on first use: a code preview in
// one language never drags the other grammars into the main bundle.
const GRAMMARS: Record<string, () => Promise<GrammarModule>> = {
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
const ALIASES: Record<string, string> = {
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
 * recognized/supported so the caller can fall back to a plain <pre>. Never
 * throws. */
export async function highlightCode(code: string, language: string | null): Promise<string | null> {
  if (!language) return null;
  const name = language.toLowerCase();
  const grammar = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  if (!Object.hasOwn(GRAMMARS, grammar)) return null;
  try {
    const highlight = await getHighlighter(grammar);
    return highlight(code.replace(/\n$/, ''));
  } catch {
    return null;
  }
}
