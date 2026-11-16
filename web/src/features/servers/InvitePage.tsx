import { useParams } from 'react-router';
import { OpenInDesktopApp } from '@/features/desktopApp/OpenInDesktopApp';
import { desktopInviteLink } from '@/features/desktopApp/desktopLinks';
import { InviteLinkCard } from './InviteLinkCard';

/** `/invite/<code>`: the link opened directly, after signing in if needed. */
export function InvitePage() {
  const { code = '' } = useParams();
  return (
    <main className="grid h-full place-items-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <InviteLinkCard code={code} page />
        <OpenInDesktopApp link={desktopInviteLink(code)} className="w-full" />
      </div>
    </main>
  );
}
