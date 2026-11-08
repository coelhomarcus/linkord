import { StatusDot } from './StatusDot';
import { CustomStatusText } from './CustomStatusText';
import { useCustomStatus, useUserStatus } from './statusDisplay';

/** A person's presence dot, read live from the room: for rows rendered in a loop, where a hook per
 * row cannot be called. Size, ring and position come from `className` (see StatusDot). */
export function UserStatusDot({ userId, className, labelled }: { userId: string; className?: string; labelled?: boolean }) {
  return <StatusDot status={useUserStatus(userId)} className={className} labelled={labelled} />;
}

/** A person's custom status, shown only while they appear online. */
export function UserCustomStatus({ userId, className }: { userId: string; className?: string }) {
  return <CustomStatusText custom={useCustomStatus(userId)} className={className} />;
}
