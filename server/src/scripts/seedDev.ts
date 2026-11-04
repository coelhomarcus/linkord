import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import {
  channelPermissionOverwrites, conversationMembers, conversations, friendships, messages, notifications, serverCategories,
  serverMemberRoles, serverMembers, serverRoles, servers, users, webhooks,
} from '../db/schema.js';
import { hashPassword } from '../modules/auth/password.js';
import { PERMISSIONS } from '../modules/servers/permissions.js';
import { defaultServerTemplate } from '../modules/servers/serverTemplate.js';
import { generateWebhookToken, hashWebhookToken } from '../modules/bots/webhooksRepository.js';

const accountIds = {
  ana: '10000000-0000-4000-8000-000000000001',
  bruno: '10000000-0000-4000-8000-000000000002',
  carla: '10000000-0000-4000-8000-000000000003',
  davi: '10000000-0000-4000-8000-000000000004',
} as const;
const conversationIds = {
  direct: '20000000-0000-4000-8000-000000000001',
  general: '20000000-0000-4000-8000-000000000002',
  announcements: '20000000-0000-4000-8000-000000000003',
  secondDirect: '20000000-0000-4000-8000-000000000004',
  voice: '20000000-0000-4000-8000-000000000005',
} as const;
const serverIds = {
  server: '40000000-0000-4000-8000-000000000001',
  everyone: '40000000-0000-4000-8000-000000000002',
  moderators: '40000000-0000-4000-8000-000000000003',
  textCategory: '40000000-0000-4000-8000-000000000004',
  voiceCategory: '40000000-0000-4000-8000-000000000005',
  readOnly: '40000000-0000-4000-8000-000000000006',
  webhook: '40000000-0000-4000-8000-000000000007',
} as const;
const requestId = '30000000-0000-4000-8000-000000000001';
const password = 'LinkordDev123!';

async function seed(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') throw new Error('Development mode is required.');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('A local database is required.');

  const passwordHash = await hashPassword(password);
  const joinedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const time = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(users).values([
      { id: accountIds.ana, username: 'ana', email: 'ana@linkord.test', displayName: 'Ana Costa', avatarColor: 'fuchsia', bio: 'Testando o Linkord no celular.', passwordHash },
      { id: accountIds.bruno, username: 'bruno', email: 'bruno@linkord.test', displayName: 'Bruno Lima', avatarColor: 'blue', bio: 'Design e conversas.', passwordHash },
      { id: accountIds.carla, username: 'carla', email: 'carla@linkord.test', displayName: 'Carla Souza', avatarColor: 'green', bio: 'Projetos em grupo.', passwordHash },
      { id: accountIds.davi, username: 'davi', email: 'davi@linkord.test', displayName: 'Davi Rocha', avatarColor: 'orange', bio: 'Sempre por aqui.', passwordHash },
    ]).onConflictDoNothing();

    const friendship = (id: string, a: string, b: string, requestedBy: string, status: string) => ({
      id, userLowId: a < b ? a : b, userHighId: a < b ? b : a, requestedBy, status,
      ...(status === 'accepted' ? { acceptedAt: joinedAt } : {}),
    });
    await tx.insert(friendships).values([
      friendship('30000000-0000-4000-8000-000000000002', accountIds.ana, accountIds.bruno, accountIds.ana, 'accepted'),
      friendship('30000000-0000-4000-8000-000000000003', accountIds.ana, accountIds.davi, accountIds.ana, 'accepted'),
      friendship(requestId, accountIds.ana, accountIds.carla, accountIds.carla, 'pending'),
    ]).onConflictDoNothing();

    const directKey = (a: string, b: string) => [a, b].sort().join(':');
    await tx.insert(conversations).values([
      { id: conversationIds.direct, type: 'direct', dmKey: directKey(accountIds.ana, accountIds.bruno), createdBy: accountIds.ana, createdAt: joinedAt },
      { id: conversationIds.secondDirect, type: 'direct', dmKey: directKey(accountIds.ana, accountIds.davi), createdBy: accountIds.ana, createdAt: joinedAt },
    ]).onConflictDoNothing();
    await tx.insert(conversationMembers).values([
      { conversationId: conversationIds.direct, userId: accountIds.ana, joinedAt },
      { conversationId: conversationIds.direct, userId: accountIds.bruno, joinedAt },
      { conversationId: conversationIds.secondDirect, userId: accountIds.ana, joinedAt },
      { conversationId: conversationIds.secondDirect, userId: accountIds.davi, joinedAt },
    ]).onConflictDoNothing();

    // one server from the template, plus a read-only announcements channel fed
    // by a webhook and a hoisted moderators role — enough to see channels,
    // roles and permissions working
    const template = defaultServerTemplate('pt-BR');
    const [textCategory, voiceCategory] = template.categories;
    await tx.insert(servers).values({ id: serverIds.server, name: 'Equipe do projeto', ownerId: accountIds.ana, createdAt: joinedAt }).onConflictDoNothing();
    await tx.insert(serverRoles).values([
      { id: serverIds.everyone, serverId: serverIds.server, name: '@everyone', position: 0, permissions: template.everyonePermissions, isDefault: true },
      { id: serverIds.moderators, serverId: serverIds.server, name: 'Moderação', color: '#3ba55c', position: 1, hoist: true,
        permissions: PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MOVE_MEMBERS },
    ]).onConflictDoNothing();
    await tx.insert(serverCategories).values([
      { id: serverIds.textCategory, serverId: serverIds.server, name: textCategory!.name, position: 0 },
      { id: serverIds.voiceCategory, serverId: serverIds.server, name: voiceCategory!.name, position: 1 },
    ]).onConflictDoNothing();
    await tx.insert(conversations).values([
      { id: conversationIds.general, type: 'text', title: textCategory!.channels[0]!.name, serverId: serverIds.server, categoryId: serverIds.textCategory, position: 0, createdBy: accountIds.ana, createdAt: joinedAt },
      { id: conversationIds.announcements, type: 'text', title: 'avisos', topic: 'Só o bot do projeto escreve aqui.', serverId: serverIds.server, categoryId: serverIds.textCategory, position: 1, permissionsSynced: false, createdBy: accountIds.ana, createdAt: joinedAt },
      { id: conversationIds.voice, type: 'voice', title: voiceCategory!.channels[0]!.name, serverId: serverIds.server, categoryId: serverIds.voiceCategory, position: 0, createdBy: accountIds.ana, createdAt: joinedAt },
    ]).onConflictDoNothing();
    await tx.insert(channelPermissionOverwrites).values({
      id: serverIds.readOnly, serverId: serverIds.server, channelId: conversationIds.announcements, roleId: serverIds.everyone, deny: PERMISSIONS.SEND_MESSAGES,
    }).onConflictDoNothing();
    await tx.insert(serverMembers).values([
      { serverId: serverIds.server, userId: accountIds.ana, joinedAt },
      { serverId: serverIds.server, userId: accountIds.bruno, joinedAt },
      { serverId: serverIds.server, userId: accountIds.carla, joinedAt },
    ]).onConflictDoNothing();
    await tx.insert(serverMemberRoles).values({ serverId: serverIds.server, userId: accountIds.bruno, roleId: serverIds.moderators }).onConflictDoNothing();
    await tx.insert(webhooks).values({
      id: serverIds.webhook, conversationId: conversationIds.announcements, name: 'Avisos do projeto', createdBy: accountIds.ana,
      tokenHash: hashWebhookToken(generateWebhookToken()),
    }).onConflictDoNothing();

    const addMessages = async (conversationId: string, entries: { authorId: string | null; text: string; minutesAgo: number }[], webhookId: string | null = null) => {
      const existing = await tx.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, conversationId)).limit(1);
      if (existing.length) return;
      const inserted = await tx.insert(messages).values(entries.map(({ authorId, text, minutesAgo }) => ({
        conversationId, authorId, text, webhookId, createdAt: time(minutesAgo),
      }))).returning({ id: messages.id });
      const lastAt = time(entries.at(-1)!.minutesAgo);
      await tx.update(conversations).set({ lastMessageAt: lastAt, lastActivityAt: lastAt }).where(eq(conversations.id, conversationId));
      return inserted;
    };
    await addMessages(conversationIds.direct, [
      { authorId: accountIds.ana, text: 'Oi, Bruno! Vamos testar a conversa no celular?', minutesAgo: 85 },
      { authorId: accountIds.bruno, text: 'Claro! Abre esta conversa pelo link e testa o botão Voltar.', minutesAgo: 40 },
      { authorId: accountIds.bruno, text: 'Também podemos testar respostas, emoji e anexos.', minutesAgo: 12 },
    ]);
    await addMessages(conversationIds.secondDirect, [
      { authorId: accountIds.davi, text: 'Bom dia! A nova navegação ficou pronta para testar.', minutesAgo: 65 },
      { authorId: accountIds.ana, text: 'Vou conferir agora.', minutesAgo: 50 },
    ]);
    const serverMessages = await addMessages(conversationIds.general, [
      { authorId: accountIds.ana, text: 'Bem-vindos ao servidor de teste!', minutesAgo: 70 },
      { authorId: accountIds.carla, text: 'Separei alguns cenários para a versão mobile.', minutesAgo: 35 },
      { authorId: accountIds.bruno, text: '@ana consegue revisar a tela de notificações?', minutesAgo: 7 },
    ]);
    await addMessages(conversationIds.announcements, [
      { authorId: null, text: 'Aviso de exemplo: a versão mobile está disponível para testes.', minutesAgo: 25 },
    ], serverIds.webhook);

    await tx.insert(notifications).values({
      id: crypto.randomUUID(), recipientId: accountIds.ana, kind: 'friend_request',
      friendshipId: requestId, dedupeKey: 'dev:friend-request:carla', createdAt: time(20),
    }).onConflictDoNothing();
    const mentionId = serverMessages?.at(-1)?.id ?? (await tx.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.conversationId, conversationIds.general), eq(messages.authorId, accountIds.bruno)))
      .orderBy(messages.id)).at(-1)?.id;
    if (mentionId) await tx.insert(notifications).values({
      id: crypto.randomUUID(), recipientId: accountIds.ana, kind: 'mention',
      messageId: mentionId, dedupeKey: 'dev:mention:ana', createdAt: time(7),
    }).onConflictDoNothing();
  });
  console.log('Seeded ana, bruno, carla and davi. Password: LinkordDev123!');
}

seed().then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
