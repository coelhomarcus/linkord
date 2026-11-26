// The Windows installer for `npm run package` (scripts/package.mjs), the only
// system the app ships for. It is not signed; what that costs is in
// docs/DEPLOY.md, "Desktop app".
//
// resources/icon.png is drawn from web/public/favicon.svg's mark.

const [owner, repo] = (process.env.OVERCORD_UPDATE_REPO ?? '').split('/');
const updateRepo = owner && repo ? { owner, repo } : null;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.overcord.desktop',
  productName: 'Overcord',
  directories: { output: 'release', buildResources: 'resources' },
  files: ['dist/**/*', '!dist/**/*.map', 'assets/**/*', 'package.json'],
  artifactName: 'Overcord-${version}-${os}-${arch}.${ext}',
  // With a repository (scripts/package.mjs checks it), the build writes the
  // overcord.yml manifest for the Overcord updater. Earlier desktop builds
  // look for latest.yml, so they cannot install this separate application.
  publish: updateRepo ? { provider: 'github', ...updateRepo, channel: 'overcord' } : null,

  // Without these the installed, familiar binary would run any script as Node
  // (ELECTRON_RUN_AS_NODE, NODE_OPTIONS), take a debugger (--inspect) or load
  // a swapped app.asar or loose app folder. docs/DEPLOY.md, "Desktop app".
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // One way: cookies written plain stay readable and are encrypted when next
    // written, but turning this off again would leave the store unreadable
    enableCookieEncryption: true,
  },

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
