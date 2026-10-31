import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { conversationMembers, conversations, friendships, messages, notifications, users } from '../db/schema.js';
import { hashPassword } from '../modules/auth/password.js';

const accountIds = {
  ana: '10000000-0000-4000-8000-000000000001',
  bruno: '10000000-0000-4000-8000-000000000002',
  carla: '10000000-0000-4000-8000-000000000003',
  davi: '10000000-0000-4000-8000-000000000004',
} as const;
const conversationIds = {
  direct: '20000000-0000-4000-8000-000000000001',
  group: '20000000-0000-4000-8000-000000000002',
  bot: '20000000-0000-4000-8000-000000000003',
  secondDirect: '20000000-0000-4000-8000-000000000004',
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
      { id: conversationIds.group, type: 'group', title: 'Equipe do projeto', createdBy: accountIds.ana, createdAt: joinedAt },
      { id: conversationIds.bot, type: 'bot', title: 'Avisos do projeto', createdBy: accountIds.ana, createdAt: joinedAt },
    ]).onConflictDoNothing();
    await tx.insert(conversationMembers).values([
      { conversationId: conversationIds.direct, userId: accountIds.ana, joinedAt },
      { conversationId: conversationIds.direct, userId: accountIds.bruno, joinedAt },
      { conversationId: conversationIds.secondDirect, userId: accountIds.ana, joinedAt },
      { conversationId: conversationIds.secondDirect, userId: accountIds.davi, joinedAt },
      { conversationId: conversationIds.group, userId: accountIds.ana, role: 'owner', joinedAt, pinnedAt: joinedAt },
      { conversationId: conversationIds.group, userId: accountIds.bruno, joinedAt },
      { conversationId: conversationIds.group, userId: accountIds.carla, joinedAt },
      { conversationId: conversationIds.bot, userId: accountIds.ana, role: 'owner', joinedAt },
    ]).onConflictDoNothing();

    const addMessages = async (conversationId: string, entries: { authorId: string | null; text: string; minutesAgo: number }[]) => {
      const existing = await tx.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, conversationId)).limit(1);
      if (existing.length) return;
      const inserted = await tx.insert(messages).values(entries.map(({ authorId, text, minutesAgo }) => ({
        conversationId, authorId, text, createdAt: time(minutesAgo),
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
    const groupMessages = await addMessages(conversationIds.group, [
      { authorId: accountIds.ana, text: 'Bem-vindos ao grupo de teste!', minutesAgo: 70 },
      { authorId: accountIds.carla, text: 'Separei alguns cenários para a versão mobile.', minutesAgo: 35 },
      { authorId: accountIds.bruno, text: '@ana consegue revisar a tela de notificações?', minutesAgo: 7 },
    ]);
    await addMessages(conversationIds.bot, [
      { authorId: null, text: 'Aviso de exemplo: a versão mobile está disponível para testes.', minutesAgo: 25 },
    ]);

    await tx.insert(notifications).values({
      id: crypto.randomUUID(), recipientId: accountIds.ana, kind: 'friend_request',
      friendshipId: requestId, dedupeKey: 'dev:friend-request:carla', createdAt: time(20),
    }).onConflictDoNothing();
    const mentionId = groupMessages?.at(-1)?.id ?? (await tx.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.conversationId, conversationIds.group), eq(messages.authorId, accountIds.bruno)))
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
