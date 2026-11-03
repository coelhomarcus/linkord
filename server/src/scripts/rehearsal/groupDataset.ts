import type { Pool } from 'pg';

// A database as it looked right before servers existed (schema level 0042),
// with every kind of row that hangs off a group: history, files, reactions,
// read markers, pins, a pending invitation and its DM card, a call invite
// card, soundboard clips, a bot with its webhook, a report, a suspended group,
// an untitled one and an empty one. The rehearsal migrates it and proves each
// of those survives the move into servers.

export const GROUP_USERS = { ana: 'pt-BR', ben: 'en-US', cy: 'pt-BR' } as const;

/** group id → owner name (null: no members left) */
export const GROUP_OWNERS: Record<string, keyof typeof GROUP_USERS | null> = {
  'grp-team': 'ana',
  'grp-untitled': 'ben',
  'grp-suspended': 'ana',
  'grp-empty': null,
  'bot-news': 'ben',
  // no owner at all: the gate refuses 0043 until the repair names one
  'grp-orphan': 'cy',
};

export interface GroupSeedManifest {
  users: Record<keyof typeof GROUP_USERS, string>;
  counts: {
    groups: number;
    groupMembers: number;
    groupReadMarkers: number;
    messages: number;
    attachments: number;
    reactions: number;
    invitations: number;
    sounds: number;
    webhooks: number;
  };
  callInviteMessageId: number;
}

export async function seedGroupDataset(pool: Pool): Promise<GroupSeedManifest> {
  const users = {} as Record<keyof typeof GROUP_USERS, string>;
  for (const [name, locale] of Object.entries(GROUP_USERS) as [keyof typeof GROUP_USERS, string][]) {
    users[name] = `u-${name}`;
    await pool.query("insert into users (id, username, display_name, password_hash, locale) values ($1, $2, $3, 'not-a-real-hash', $4)", [users[name], name, name.toUpperCase(), locale]);
  }
  const conv = (id: string, type: string, title: string, status = 'active', dmKey: string | null = null) =>
    pool.query('insert into conversations (id, type, title, avatar, status, dm_key, last_message_at, updated_at) values ($1,$2,$3,$4,$5,$6, now(), now())',
      [id, type, title, type === 'direct' ? '' : `/uploads/avatar-${id}`, status, dmKey]);
  const member = (conversationId: string, user: keyof typeof GROUP_USERS, role: string, extra: { pinned?: boolean } = {}) =>
    pool.query('insert into conversation_members (conversation_id, user_id, role, pinned_at) values ($1,$2,$3,$4)', [conversationId, users[user], role, extra.pinned ? new Date() : null]);
  const message = async (conversationId: string, author: keyof typeof GROUP_USERS | null, text: string): Promise<number> =>
    (await pool.query<{ id: number }>('insert into messages (conversation_id, author_id, text) values ($1,$2,$3) returning id', [conversationId, author ? users[author] : null, text])).rows[0]!.id;

  await conv('grp-team', 'group', 'Equipe');
  await member('grp-team', 'ana', 'owner');
  await member('grp-team', 'ben', 'member', { pinned: true });
  await member('grp-team', 'cy', 'member');
  await conv('grp-untitled', 'group', '');
  await member('grp-untitled', 'ben', 'owner');
  await member('grp-untitled', 'ana', 'member');
  await conv('grp-suspended', 'group', 'Suspenso', 'suspended');
  await member('grp-suspended', 'ana', 'owner');
  await conv('grp-empty', 'group', 'Vazio');
  await conv('bot-news', 'bot', 'News');
  await member('bot-news', 'ben', 'owner');
  await member('bot-news', 'cy', 'member');
  await conv('grp-orphan', 'group', 'Órfão');
  await member('grp-orphan', 'cy', 'member');
  await conv('dm-ana-cy', 'direct', '', 'active', [users.ana, users.cy].sort().join(':'));
  await member('dm-ana-cy', 'ana', 'member');
  await member('dm-ana-cy', 'cy', 'member');

  const m1 = await message('grp-team', 'ana', 'bem-vindos');
  const m2 = await message('grp-team', 'ben', 'hello');
  await message('grp-untitled', 'ana', 'sem título');
  await message('grp-suspended', 'ana', 'antes da suspensão');
  await message('grp-empty', null, 'de uma conta apagada');
  await pool.query("insert into webhooks (id, conversation_id, token_hash, created_by) values ('wh-news', 'bot-news', 'hash', $1)", [users.ben]);
  await pool.query("insert into messages (conversation_id, text, webhook_id) values ('bot-news', 'deploy ok', 'wh-news')");
  await pool.query("insert into attachments (id, message_id, file_name, mime_type, size) values ('grpfile000000000000000000000001', $1, 'foto.png', 'image/png', 1234)", [m1]);
  await pool.query("insert into message_reactions (message_id, user_id, emoji) values ($1,$2,'👍'), ($1,$3,'🎉')", [m1, users.ben, users.cy]);
  await pool.query("update conversation_members set last_read_message_id = $1 where conversation_id = 'grp-team' and user_id in ($2, $3)", [m2, users.ana, users.ben]);

  await pool.query("insert into group_invitations (id, conversation_id, inviter_id, invitee_id) values ('inv-cy', 'grp-untitled', $1, $2)", [users.ben, users.cy]);
  await pool.query("insert into messages (conversation_id, author_id, text, kind, group_invitation_id) values ('dm-ana-cy', $1, '', 'group_invite', 'inv-cy')", [users.ana]);
  const callInvite = (await pool.query<{ id: number }>(
    "insert into messages (conversation_id, author_id, text, kind, call_conversation_id) values ('dm-ana-cy', $1, '', 'call_invite', 'grp-team') returning id", [users.ana])).rows[0]!.id;
  await pool.query("insert into group_sounds (id, conversation_id, uploader_id, name, size, duration_ms) values ('snd-1', 'grp-team', $1, 'airhorn', 2048, 1200)", [users.ana]);
  await pool.query("insert into reports (id, reporter_id, target_type, target_id, category) values ('rep-1', $1, 'group', 'grp-team', 'spam')", [users.cy]);

  const count = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    users,
    callInviteMessageId: callInvite,
    counts: {
      groups: await count("select count(*) as n from conversations where type in ('group','bot')"),
      groupMembers: await count("select count(*) as n from conversation_members m join conversations c on c.id = m.conversation_id where c.type in ('group','bot')"),
      groupReadMarkers: await count("select count(*) as n from conversation_members m join conversations c on c.id = m.conversation_id where c.type in ('group','bot') and m.last_read_message_id is not null"),
      messages: await count('select count(*) as n from messages'),
      attachments: await count('select count(*) as n from attachments'),
      reactions: await count('select count(*) as n from message_reactions'),
      invitations: await count('select count(*) as n from group_invitations'),
      sounds: await count('select count(*) as n from group_sounds'),
      webhooks: await count('select count(*) as n from webhooks'),
    },
  };
}
