/** Relative "last seen" copy for a DM subtitle, in the viewer's local calendar. */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function clock(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function formatLastSeen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Offline';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Offline';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThat) / 86_400_000);
  const time = clock(at);

  if (dayDiff === 0) return `Última vez online hoje às ${time}`;
  if (dayDiff === 1) return `Última vez online ontem às ${time}`;

  const date = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
  return `Última vez online em ${date} às ${time}`;
}
