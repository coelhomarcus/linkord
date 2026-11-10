import type { PublicUser, RoleSummary } from '@/shared/types/protocol';

/** One entry of the composer's "@" list. */
export type MentionCandidate =
  | { kind: 'user'; user: PublicUser }
  | { kind: 'role'; role: RoleSummary }
  | { kind: 'group'; name: 'everyone' | 'here' };

const MAX_ROLE_RESULTS = 5;

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The roles and groups a query offers in a server channel: only what would
 * notify someone if sent, so the list never suggests a mention that pings
 * nobody. Without MENTION_EVERYONE that is the roles marked mentionable;
 * with it, every role and @everyone/@here. @everyone's own role is never one. */
export function roleAndGroupCandidates(query: string, roles: readonly RoleSummary[], canMentionEveryone: boolean): MentionCandidate[] {
  const q = fold(query);
  const matchingRoles = roles
    .filter((role) => !role.isDefault && (role.mentionable || canMentionEveryone) && fold(role.name).startsWith(q))
    .sort((a, b) => b.position - a.position)
    .slice(0, MAX_ROLE_RESULTS)
    .map((role): MentionCandidate => ({ kind: 'role', role }));
  const groups = canMentionEveryone
    ? (['everyone', 'here'] as const).filter((name) => name.startsWith(q)).map((name): MentionCandidate => ({ kind: 'group', name }))
    : [];
  return [...matchingRoles, ...groups];
}

const roleMentionToken = (roleId: string) => `<@&${roleId}>`;

/** What picking an entry puts in place of the "@query", followed by a space. */
export function mentionInsertion(candidate: MentionCandidate): string {
  if (candidate.kind === 'user') return `@${candidate.user.username} `;
  if (candidate.kind === 'role') return `${roleMentionToken(candidate.role.id)} `;
  return `@${candidate.name} `;
}

export function mentionCandidateKey(candidate: MentionCandidate): string {
  if (candidate.kind === 'user') return `user:${candidate.user.id}`;
  if (candidate.kind === 'role') return `role:${candidate.role.id}`;
  return `group:${candidate.name}`;
}
