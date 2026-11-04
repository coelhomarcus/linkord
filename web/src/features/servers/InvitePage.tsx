import { useParams } from 'react-router';
import { InviteLinkCard } from './InviteLinkCard';

/** `/invite/<code>`: the link opened directly, after signing in if needed. */
export function InvitePage() {
  const { code = '' } = useParams();
  return (
    <main className="grid h-full place-items-center p-6">
      <InviteLinkCard code={code} page />
    </main>
  );
}
