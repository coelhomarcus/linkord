import type { InviteOutcome } from '@/shared/api/api';
import { i18n } from '@/shared/i18n/init';

export function describeInviteOutcome(outcome: InviteOutcome): string {
  return i18n.t(`conversations:outcome.${outcome}`);
}
