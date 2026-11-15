import { systemPreferences, type Session } from 'electron';
import { isPermissionGranted, systemMediaKinds } from './permissions.js';

// On macOS the page's grant is not enough: the app also needs the system's
// privacy switch for the microphone or camera. Asking here shows the system
// prompt the first time, at the moment the person starts a call, instead of
// handing the page a stream that turns out silent or black.
async function systemAllowsMedia(mediaTypes: readonly string[]): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  for (const kind of systemMediaKinds(mediaTypes)) {
    if (!(await systemPreferences.askForMediaAccess(kind))) return false;
  }
  return true;
}

export function installPermissionHandlers(session: Session, appOrigin: string): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    if (!isPermissionGranted({ permission, requestingUrl: details.requestingUrl, appOrigin, mediaTypes })) {
      callback(false);
      return;
    }
    if (permission !== 'media') {
      callback(true);
      return;
    }
    systemAllowsMedia(mediaTypes).then(callback, () => callback(false));
  });

  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionGranted({ permission, requestingUrl: requestingOrigin, appOrigin }));
}
