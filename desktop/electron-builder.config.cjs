// The Windows installer for `npm run package` (scripts/package.mjs), the only
// system the app ships for. It is not signed; what that costs is in
// docs/DEPLOY.md, "Desktop app".
//
// resources/icon.png is drawn from web/public/favicon.svg's mark.

const [owner, repo] = (process.env.LINKORD_UPDATE_REPO ?? '').split('/');
const updateRepo = owner && repo ? { owner, repo } : null;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.linkord.desktop',
  productName: 'Linkord',
  directories: { output: 'release', buildResources: 'resources' },
  files: ['dist/**/*', '!dist/**/*.map', 'assets/**/*', 'package.json'],
  artifactName: 'Linkord-${version}-${os}-${arch}.${ext}',
  // With a repository (scripts/package.mjs checks it), the build writes the
  // latest*.yml files the app's updater reads from that repository's GitHub
  // releases. Uploading them is the workflow's job (--publish never).
  publish: updateRepo ? { provider: 'github', owner: updateRepo.owner, repo: updateRepo.repo } : null,

  // linkord:// links (src/main/deepLink.ts). This entry covers macOS and
  // Linux builds; the Windows installer ignores it and registers the scheme
  // in resources/installer.nsh
  protocols: [{ name: 'Linkord', schemes: ['linkord'] }],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.png',
  },
  nsis: {
    // per-user, no administrator prompt; the app updates by reinstalling
    oneClick: true,
    perMachine: false,
    differentialPackage: false,
    include: 'resources/installer.nsh',
  },
};
