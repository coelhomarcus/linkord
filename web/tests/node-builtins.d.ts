/** Narrow Node builtins used by tests that must stay in tsconfig.app
 * (no `@types/node` — that would leak into production sources). */
declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>;
}
