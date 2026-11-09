import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '../../../src/modules/servers/permissions.js';

// A permission is only real when the server checks it AND the interface lets
// whoever holds it use it. This fails when a flag is added (or loses its last
// use) on either side, so a switch in the role editor never again promises
// what nothing does (SPEAK and STREAM once were such switches).
//
// It reads the sources rather than running them: "is PERMISSIONS.X read
// anywhere" is a coarse check, but the gaps it exists for were exactly flags
// read nowhere.

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SERVER_SRC = path.join(ROOT, 'server/src');
const WEB_SRC = path.join(ROOT, 'web/src');

// the definitions themselves, and scripts (a seed granting a flag is not a use of it)
const SERVER_EXCLUDED = [path.join(SERVER_SRC, 'modules/servers/permissions.ts'), path.join(SERVER_SRC, 'scripts')];
const WEB_EXCLUDED = [path.join(WEB_SRC, 'features/servers/permissionBits.ts'), path.join(WEB_SRC, 'features/servers/permissionCatalog.ts')];

/** Flags the interface uses without reading the bit, with why. Keep it short. */
const WEB_IMPLICIT: Partial<Record<keyof typeof PERMISSIONS, string>> = {
  VIEW_CHANNEL: 'the server leaves channels a member cannot see out of their summary, so the client never has one to hide',
};

function sources(dir: string, excluded: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (excluded.some((e) => full === e || full.startsWith(e + path.sep))) continue;
    if (entry.isDirectory()) out.push(...sources(full, excluded));
    else if (/\.tsx?$/.test(entry.name)) out.push(fs.readFileSync(full, 'utf8'));
  }
  return out;
}

const uses = (files: string[], name: string) => files.some((text) => new RegExp(`PERMISSIONS\\.${name}\\b`).test(text));

describe('permission coverage', () => {
  const server = sources(SERVER_SRC, SERVER_EXCLUDED);
  const web = sources(WEB_SRC, WEB_EXCLUDED);

  for (const name of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
    it(`${name} is checked by the server and used by the interface`, () => {
      assert.ok(uses(server, name), `nothing in server/src checks PERMISSIONS.${name}`);
      if (!WEB_IMPLICIT[name]) assert.ok(uses(web, name), `nothing in web/src reads PERMISSIONS.${name}: who holds it has nowhere to use it`);
    });
  }

  it('lists as implicit only flags that exist', () => {
    for (const name of Object.keys(WEB_IMPLICIT)) assert.ok(name in PERMISSIONS, `${name} is not a permission`);
  });
});
