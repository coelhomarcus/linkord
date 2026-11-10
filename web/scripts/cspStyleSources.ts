/** The crop dialog's runtime stylesheet (react-easy-crop assigns this exact
 * string to a `<style>` element). The web build writes it to
 * `csp-style-sources.json`; the server hashes it into `style-src-elem`. */
export function reactEasyCropStyleSource(moduleSource: string): string | null {
  const match = moduleSource.match(/var styles_default = ("(?:\\.|[^"\\])*")/);
  if (!match?.[1]) return null;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === 'string' && value.includes('.reactEasyCrop_Container') ? value : null;
  } catch {
    return null;
  }
}
