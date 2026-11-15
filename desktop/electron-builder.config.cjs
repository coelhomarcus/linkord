// Installers for `npm run package` (scripts/package.mjs). Nothing is signed
// with a paid certificate: macOS gets an ad-hoc signature (Apple Silicon runs
// nothing without one) and no notarization, Windows none at all. What that
// costs is in docs/DEPLOY.md, "Desktop app".
//
// resources/icon.png and icon-mac.png are drawn from web/public/favicon.svg's
// mark; the macOS one keeps the system's margin around the tile.

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.linkord.desktop',
  productName: 'Linkord',
  directories: { output: 'release', buildResources: 'resources' },
  files: ['dist/**/*', '!dist/**/*.map', 'assets/**/*', 'package.json'],
  artifactName: 'Linkord-${version}-${os}-${arch}.${ext}',
  publish: null,

  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    icon: 'resources/icon-mac.png',
    category: 'public.app-category.social-networking',
    identity: '-',
    // Notarization needs it, and without notarization it only adds entitlements to maintain
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    extendInfo: {
      NSMicrophoneUsageDescription: 'Linkord uses the microphone for calls and voice messages.',
      NSCameraUsageDescription: 'Linkord uses the camera for video calls.',
    },
  },

  // No auto-update yet: no update metadata or block maps next to the installers
  dmg: { writeUpdateInfo: false },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.png',
  },
  nsis: {
    // per-user, no administrator prompt; the app updates by reinstalling
    oneClick: true,
    perMachine: false,
    differentialPackage: false,
  },

  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }],
    icon: 'resources/icon.png',
    category: 'Network',
    maintainer: 'Linkord',
    synopsis: 'Chat and calls on your Linkord server',
  },
};
