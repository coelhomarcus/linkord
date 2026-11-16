// Builds the Windows installer with the Linkord server's address baked in,
// unsigned (see docs/DEPLOY.md, "Desktop app"). Windows is the only system
// the app ships for.
//
//   LINKORD_URL=https://chat.example.com npm run package --prefix desktop
//   LINKORD_URL=... npm run package --prefix desktop -- --dir
//   LINKORD_URL=... LINKORD_UPDATE_REPO=owner/repo npm run package --prefix desktop
//
// Anything after `--` goes to electron-builder (--dir...). The installer
// lands in desktop/release/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAppUrl } from '../dist/main/appUrl.js';
import { parseUpdateRepo } from '../dist/main/updates.js';

const root = path.resolve(import.meta.dirname, '..');
const resolved = resolveAppUrl({ argv: [], env: { LINKORD_URL: process.env.LINKORD_URL }, isPackaged: true });
if (!resolved.ok) {
  console.error(resolved.reason === 'missing'
    ? 'Set LINKORD_URL to the address of the Linkord server the app should open.'
    : `LINKORD_URL ${resolved.value} is not usable (${resolved.reason}): https, or http only for localhost.`);
  process.exit(1);
}

// Optional: where the app looks for updates (GitHub releases of owner/repo).
// electron-builder.config.cjs reads the same variable for the latest*.yml files.
const updateRepoValue = process.env.LINKORD_UPDATE_REPO?.trim();
const updateRepo = updateRepoValue ? parseUpdateRepo(updateRepoValue) : null;
if (updateRepoValue && !updateRepo) {
  console.error(`LINKORD_UPDATE_REPO ${updateRepoValue} is not a GitHub repository (owner/repo).`);
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'dist/app-config.json'), JSON.stringify({
  url: resolved.url.origin,
  ...(updateRepo ? { updateRepo: `${updateRepo.owner}/${updateRepo.repo}` } : {}),
}));
console.log(`Packaging for ${resolved.url.origin}${updateRepo ? `, updates from github.com/${updateRepo.owner}/${updateRepo.repo}` : ', without updates'}`);

const builder = path.join(root, 'node_modules/.bin/electron-builder');
const result = spawnSync(builder, ['--config', 'electron-builder.config.cjs', '--win', '--publish', 'never', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
