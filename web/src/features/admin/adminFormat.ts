import { i18n } from '@/shared/i18n/init';

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Compact date for table cells (`07/10/2026 04:34`): the long form is for detail pages. */
export function formatWhenShort(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A date with no time (`07/10/2026`): for columns where the hour adds nothing, like when an account was created. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const ACTION_LABELS: Record<string, string> = {
  'user.suspend': 'Conta suspensa', 'user.grant_admin': 'Admin concedido', 'user.revoke_admin': 'Admin removido', 'storage.sweep_orphans': 'Órfãos coletados', 'storage.orphan_delete': 'Falha ao apagar órfão', 'user.reactivate': 'Conta reativada', 'user.revoke_sessions': 'Sessões revogadas', 'user.delete': 'Conta excluída',
  'user.delete.avatar_cleanup': 'Limpeza da foto', 'group.suspend': 'Grupo suspenso', 'group.reactivate': 'Grupo reativado',
  'group.assign_owner': 'Dono atribuído', 'group.delete': 'Grupo excluído', 'group.owner_succession': 'Sucessão de dono',
  'bot.suspend': 'Bot suspenso', 'bot.reactivate': 'Bot reativado', 'bot.assign_owner': 'Dono do bot atribuído', 'bot.delete': 'Bot excluído',
  'bot.revoke_webhook': 'Webhook revogado', 'server.suspend': 'Servidor suspenso', 'server.reactivate': 'Servidor reativado',
  'server.assign_owner': 'Dono atribuído', 'server.delete': 'Servidor excluído', 'server.owner_succession': 'Sucessão de dono', 'webhook.revoke': 'Webhook revogado',
  'message.delete': 'Mensagem apagada', 'message.attachment.remove': 'Anexo removido', 'call.kick': 'Removido da chamada', 'call.move': 'Movido de canal de voz','report.view': 'Evidência aberta',
  'report.claim': 'Denúncia assumida', 'report.resolve': 'Denúncia resolvida', 'report.dismiss': 'Denúncia dispensada',
};

export function actionLabel(action: string): string {
  const fallback = ACTION_LABELS[action] ?? action;
  return i18n.t(`admin:actions.${action}` as never, { defaultValue: fallback });
}

/** A local calendar day (`yyyy-mm-dd`, as a date input gives it), or null when it is not a real date. */
function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // 2026-02-31 would silently roll over to March: reject it instead
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? { y, m, d } : null;
}

/** Start of a local calendar day as an ISO instant. */
export function dayStartIso(day: string): string | undefined {
  const parsed = parseDay(day);
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d).toISOString() : undefined;
}

/** The instant just after a local calendar day ends — the EXCLUSIVE upper bound
 * the server expects for "up to and including this day". */
export function nextDayStartIso(day: string): string | undefined {
  const parsed = parseDay(day);
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d + 1).toISOString() : undefined;
}

const REPORT_TARGET_LABEL = { user: 'Conta', server: 'Servidor', group: 'Grupo', message: 'Mensagem' } as const;

export function reportTargetLabel(target: string): string {
  const fallback = REPORT_TARGET_LABEL[target as keyof typeof REPORT_TARGET_LABEL] ?? target;
  return i18n.t(`admin:audit.${target}` as never, { defaultValue: fallback });
}

export const REPORT_RESOLUTION_LABEL: Record<string, string> = {
  no_action: 'Resolvida sem ação', user_suspended: 'Conta suspensa', server_suspended: 'Servidor suspenso', group_suspended: 'Grupo suspenso', message_deleted: 'Mensagem apagada',
};

export function reportResolutionLabel(value: string | null | undefined): string {
  if (!value) return i18n.t('admin:common.unknown' as never);
  const key = value === 'no_action' ? 'noAction' : value === 'user_suspended' ? 'userSuspended' : value === 'server_suspended' ? 'serverSuspended' : value === 'group_suspended' ? 'groupSuspended' : value === 'message_deleted' ? 'messageDeleted' : null;
  return i18n.t(key ? `admin:resolution.${key}` as never : 'admin:common.unknown' as never, { defaultValue: REPORT_RESOLUTION_LABEL[value] ?? value });
}
