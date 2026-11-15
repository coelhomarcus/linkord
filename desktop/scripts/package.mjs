// Builds the desktop installers for this machine's system with the Linkord
// server's address baked in, unsigned (see docs/DEPLOY.md, "Desktop app").
//
//   LINKORD_URL=https://chat.example.com npm run package --prefix desktop
//   LINKORD_URL=... npm run package --prefix desktop -- --mac --arm64
//
// Anything after `--` goes to electron-builder (targets, --dir, --arm64...).
// The installers land in desktop/release/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAppUrl } from '../dist/main/appUrl.js';

const root = path.resolve(import.meta.dirname, '..');
const resolved = resolveAppUrl({ argv: [], env: { LINKORD_URL: process.env.LINKORD_URL }, isPackaged: true });
if (!resolved.ok) {
  console.error(resolved.reason === 'missing'
    ? 'Set LINKORD_URL to the address of the Linkord server the app should open.'
    : `LINKORD_URL ${resolved.value} is not usable (${resolved.reason}): https, or http only for localhost.`);
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'dist/app-config.json'), JSON.stringify({ url: resolved.url.origin }));
console.log(`Packaging for ${resolved.url.origin}`);

const builder = path.join(root, 'node_modules/.bin/electron-builder');
const result = spawnSync(builder, ['--config', 'electron-builder.config.cjs', '--publish', 'never', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
