import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PERMISSIONS } from '../modules/servers/permissions.js';
import { defaultServerTemplate } from '../modules/servers/serverTemplate.js';
import { classifyInventory, loadInventory, planRepairs } from '../modules/migration/legacyInventory.js';
import { applyRepairs, InjectedRepairFailure } from '../modules/migration/legacyRepair.js';
import { LegacyDataBlockedError } from '../modules/migration/migrationGate.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './rehearsal/isolatedDb.js';
import { GROUP_OWNERS, GROUP_USERS, seedGroupDataset, type GroupSeedManifest } from './rehearsal/groupDataset.js';
import { EXPECTED_OWNER, EXPECTED_REVIEW, seedLegacyDataset, type SeedManifest } from './rehearsal/legacyDataset.js';
import { journalTags, makeMigrationsFolder } from './rehearsal/migrationFolders.js';
import { migrateOn } from './rehearsal/migrateOn.js';

// `npm run db:rehearse [-- --keep] [-- --json]`
//
// Rehearses migration, repair, and validation against disposable databases.
// It never touches production or development databases.

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const asJson = args.includes('--json');

interface Step { name: string; ok: boolean; detail?: string }
const steps: Step[] = [];
const check = (name: string, ok: boolean, detail = ''): boolean => { steps.push({ name, ok, detail }); if (!asJson) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); return ok; };
const note = (text: string) => { if (!asJson) console.log(`\n▸ ${text}`); };

const rolesSnapshot = async (pool: Pool): Promise<string> =>
  JSON.stringify((await pool.query('select conversation_id, user_id, role from conversation_members order by 1, 2')).rows);
const tableExists = async (pool: Pool, name: string): Promise<boolean> => (await pool.query('select to_regclass($1) as r', [`public.${name}`])).rows[0]!.r != null;
const count = async (pool: Pool, sql: string): Promise<number> => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);

/** A database frozen at the last migration before the social model, seeded with the legacy dataset. */
async function legacyDatabase(baseUrl: string, label: string): Promise<{ db: IsolatedDatabase; manifest: SeedManifest }> {
  const db = await createIsolatedDatabase(baseUrl, 'rehearsal', `${label}_${Date.now().toString(36)}`);
  const legacyFolder = makeMigrationsFolder({ toIdx: 19 });
  try {
    await migrateOn(db.pool, legacyFolder.folder);
  } finally {
    legacyFolder.cleanup();
  }
  return { db, manifest: await seedLegacyDataset(db.pool) };
}

const serverIdOf = (groupId: string) => `md5('server:' || '${groupId.replaceAll("'", "''")}')::uuid::text`;

/** The data statements of 0043 (its backfill), to prove a second run changes nothing. */
function backfillStatements(): string[] {
  const sql = fs.readFileSync(path.join(MIGRATIONS_FOLDER, '0043_servers_expand.sql'), 'utf8');
  return sql.split('--> statement-breakpoint')
    .map((part) => part.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n').trim())
    .filter((part) => /^(INSERT|UPDATE)\b/.test(part));
}

const SERVER_TABLES = ['servers', 'server_members', 'server_roles', 'server_categories', 'channel_read_states', 'conversations'];
const serverSnapshot = async (pool: Pool): Promise<string> => {
  const parts: unknown[] = [];
  for (const table of SERVER_TABLES) parts.push((await pool.query(`select * from ${table} order by 1, 2`)).rows);
  parts.push((await pool.query('select id, server_id from group_invitations union all select id, server_id from group_sounds union all select id, name from webhooks order by 1')).rows);
  return JSON.stringify(parts);
};

async function verifyServers(pool: Pool, seed: GroupSeedManifest): Promise<void> {
  const c = seed.counts;
  check('cada grupo e bot virou exatamente um servidor', (await count(pool, 'select count(*) as n from servers')) === c.groups);
  const owners = await Promise.all(Object.entries(GROUP_OWNERS).map(async ([groupId, owner]) => {
    const row = (await pool.query<{ owner_id: string | null }>(`select owner_id from servers where id = ${serverIdOf(groupId)}`)).rows[0];
    return row !== undefined && row.owner_id === (owner ? seed.users[owner] : null);
  }));
  check('o dono do servidor é o dono do grupo (o grupo vazio fica sem dono)', owners.every(Boolean));
  check('todo membro de grupo virou membro do servidor', (await count(pool, 'select count(*) as n from server_members')) === c.groupMembers);
  check('quem fixou o grupo o vê primeiro no rail', (await count(pool, `select count(*) as n from server_members where server_id = ${serverIdOf('grp-team')} and user_id = '${seed.users.ben}' and position = 0`)) === 1);

  let layoutOk = true;
  for (const [groupId, owner] of Object.entries(GROUP_OWNERS)) {
    const template = defaultServerTemplate(owner ? GROUP_USERS[owner] : 'pt-BR');
    const sid = serverIdOf(groupId);
    const categories = (await pool.query<{ id: string; name: string }>(`select id, name from server_categories where server_id = ${sid} order by position`)).rows;
    const roles = (await pool.query<{ permissions: number }>(`select permissions from server_roles where server_id = ${sid} and is_default`)).rows;
    const channels = (await pool.query<{ id: string; type: string; title: string; category_id: string }>(`select id, type, title, category_id from conversations where server_id = ${sid} order by type desc`)).rows;
    const voice = template.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'voice')!;
    layoutOk &&= JSON.stringify(categories.map((cat) => cat.name)) === JSON.stringify(template.categories.map((cat) => cat.name))
      && roles.length === 1 && roles[0]!.permissions === DEFAULT_EVERYONE_PERMISSIONS && template.everyonePermissions === DEFAULT_EVERYONE_PERMISSIONS
      && channels.length === 2
      && channels.some((ch) => ch.id === groupId && ch.category_id === categories[0]!.id)
      && channels.some((ch) => ch.type === 'voice' && ch.title === voice.name && ch.category_id === categories[1]!.id);
  }
  check('o layout de cada servidor é o do template (no idioma do dono), com o grupo como primeiro canal de texto', layoutOk);

  check('mensagens, anexos e reações preservados, e o histórico continua no mesmo id',
    (await count(pool, 'select count(*) as n from messages')) === c.messages && (await count(pool, 'select count(*) as n from attachments')) === c.attachments
    && (await count(pool, 'select count(*) as n from message_reactions')) === c.reactions
    && (await count(pool, "select count(*) as n from messages where conversation_id = 'grp-team' and kind = 'text'")) === 2);
  check('marcadores de leitura dos grupos viraram estado de leitura do canal', (await count(pool, 'select count(*) as n from channel_read_states')) === c.groupReadMarkers);
  check('convites e sons apontam para o servidor', (await count(pool, 'select count(*) as n from group_invitations where server_id is not null')) === c.invitations
    && (await count(pool, 'select count(*) as n from group_sounds where server_id is not null')) === c.sounds);
  check('o webhook herdou o nome e o avatar do bot', (await count(pool, "select count(*) as n from webhooks where id = 'wh-news' and name = 'News' and avatar = '/uploads/avatar-bot-news'")) === 1);
  check('a suspensão passou para o servidor', (await count(pool, `select count(*) as n from servers where id = ${serverIdOf('grp-suspended')} and status = 'suspended'`)) === 1);
  check('grupo sem título ganhou nome a partir do dono', (await count(pool, `select count(*) as n from servers where id = ${serverIdOf('grp-untitled')} and name = 'BEN''s server'`)) === 1);

  const before = await serverSnapshot(pool);
  for (const statement of backfillStatements()) await pool.query(statement);
  check('idempotente: rodar o backfill de novo não muda nada', (await serverSnapshot(pool)) === before);
}

/** After 0044: the group's own row is the first text channel, and nothing
 * points at "a group" anymore. */
async function verifyConversion(pool: Pool, seed: GroupSeedManifest): Promise<void> {
  const c = seed.counts;
  let channelsOk = true;
  for (const [groupId, owner] of Object.entries(GROUP_OWNERS)) {
    const template = defaultServerTemplate(owner ? GROUP_USERS[owner] : 'pt-BR');
    const text = template.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'text')!;
    channelsOk &&= (await count(pool, `select count(*) as n from conversations where id = '${groupId}' and type = 'text' and title = '${text.name}' and server_id = ${serverIdOf(groupId)}`)) === 1;
  }
  check('o grupo virou o primeiro canal de texto do servidor, com o nome do template', channelsOk);
  check('nenhum tipo antigo sobrou e canais não têm linhas de membro',
    (await count(pool, "select count(*) as n from conversations where type in ('group','bot')")) === 0
    && (await count(pool, 'select count(*) as n from conversation_members m join conversations c on c.id = m.conversation_id where c.server_id is not null')) === 0
    && (await count(pool, "select count(*) as n from conversation_members where role <> 'member'")) === 0);
  check('histórico, anexos e reações continuam lá', (await count(pool, 'select count(*) as n from messages')) === c.messages
    && (await count(pool, 'select count(*) as n from attachments')) === c.attachments && (await count(pool, 'select count(*) as n from message_reactions')) === c.reactions);
  check('o cartão de chamada aponta para o canal de voz', (await count(pool,
    `select count(*) as n from messages where id = ${seed.callInviteMessageId} and call_conversation_id = md5('voice-channel:grp-team')::uuid::text`)) === 1);
  check('o cartão de convite virou convite de servidor', (await count(pool, "select count(*) as n from messages where kind = 'server_invite' and server_invitation_id = 'inv-cy'")) === 1
    && (await count(pool, 'select count(*) as n from server_invitations')) === c.invitations && (await count(pool, 'select count(*) as n from server_sounds')) === c.sounds);
  check('o canal do bot continua só leitura para as pessoas', (await count(pool,
    `select count(*) as n from channel_permission_overwrites o join conversations ch on ch.id = o.channel_id
     where ch.id = 'bot-news' and not ch.permissions_synced and o.role_id = md5('everyone:bot-news')::uuid::text and o.deny = ${PERMISSIONS.SEND_MESSAGES}`)) === 1);
  check('a denúncia do grupo aponta para o servidor', (await count(pool, `select count(*) as n from reports where id = 'rep-1' and target_type = 'server' and target_id = ${serverIdOf('grp-team')}`)) === 1);
}

async function main(): Promise<number> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) { console.error('DATABASE_URL não configurada'); return 2; }
  const dbs: IsolatedDatabase[] = [];
  try {
    check(`journal tem as migrations 0000–0019 (estado pré-rede-social) e mais ${journalTags().length - 20} depois`, journalTags().length > 20 && journalTags()[19]!.startsWith('0019'));

    // ---- A: the legacy database and the safe way to bring it forward
    note('Banco legado (schema até a 0019) com dados representativos');
    const { db: A, manifest } = await legacyDatabase(baseUrl, 'a');
    dbs.push(A);
    check('legado semeado (grupos com/sem dono, multi-dono, papel inesperado, DMs incompletas, vazio)', manifest.counts.conversations === 10, JSON.stringify(manifest.counts));

    const findings = classifyInventory(await loadInventory(A.pool));
    check('preflight detecta o bloqueador (grupos com mais de um dono)', findings.blockers.length > 0 && findings.groupsWithMultipleOwners.length === 2, `bloqueadores=${findings.blockers.length}`);
    check('preflight inventaria sem-dono, papel inesperado, DM com dono, DM incompleta e grupo vazio',
      findings.groupsWithoutOwner.length === 2 && findings.unexpectedRoles.length === 1 && findings.directWithOwner.length === 1 && findings.directIncomplete.length === 1 && findings.emptyGroups.length === 1);

    const full = makeMigrationsFolder();
    let refused: unknown = null;
    try { await migrateOn(A.pool, full.folder); } catch (err) { refused = err; }
    check('o boot RECUSA migrar por cima do legado bloqueado (LegacyDataBlockedError)', refused instanceof LegacyDataBlockedError);
    check('recusar não deixou nada pela metade (nenhuma migration nova aplicada)', !(await tableExists(A.pool, 'friendships')) && !(await tableExists(A.pool, 'admin_audit_logs')));

    note('Reparo: plano → falha injetada → aplicação');
    const before = await rolesSnapshot(A.pool);
    const plan = planRepairs(await loadInventory(A.pool));
    check('dry-run: plano cobre exatamente os casos ruins e nada foi alterado', plan.length === 6 && (await rolesSnapshot(A.pool)) === before, `${plan.length} ação(ões)`);
    const reviewGroups = [...new Set(plan.filter((a) => a.needsReview).map((a) => a.conversationId))].sort();
    check('decisões ambíguas ficam marcadas para revisão humana', JSON.stringify(reviewGroups) === JSON.stringify([...EXPECTED_REVIEW].sort()), reviewGroups.join(', '));

    let injected: unknown = null;
    try { await applyRepairs(A.pool, plan, { failAfter: 2 }); } catch (err) { injected = err; }
    check('falha no meio do reparo: nada muda e o log também é desfeito', injected instanceof InjectedRepairFailure && (await rolesSnapshot(A.pool)) === before && !(await tableExists(A.pool, 'data_repairs')));

    const run = await applyRepairs(A.pool, plan);
    check('retomada: o reparo conclui na segunda tentativa, sem ignorados', run.applied.length === plan.length && run.skipped.length === 0);
    check('data_repairs registra cada correção (com marca de revisão)', (await count(A.pool, 'select count(*) as n from data_repairs')) === plan.length && (await count(A.pool, 'select count(*) as n from data_repairs where needs_review')) === plan.filter((a) => a.needsReview).length);

    note('Migração até o topo e verificação do §12');
    await migrateOn(A.pool, full.folder);
    check('migra 0020 → topo depois do reparo', (await tableExists(A.pool, 'friendships')) && (await tableExists(A.pool, 'admin_audit_logs')) && (await tableExists(A.pool, 'reports')) && (await tableExists(A.pool, 'data_repairs')));
    const c = manifest.counts;
    check('mensagens, anexos, reações, sessões e conversas preservados',
      (await count(A.pool, 'select count(*) as n from messages')) === c.messages && (await count(A.pool, 'select count(*) as n from attachments')) === c.attachments
      && (await count(A.pool, 'select count(*) as n from message_reactions')) === c.reactions && (await count(A.pool, 'select count(*) as n from sessions')) === c.sessions
      && (await count(A.pool, "select count(*) as n from conversations where type <> 'voice'")) === c.conversations);
    // the legacy groups became servers: a group pin is the server's place in
    // the rail, a group read marker is the channel's read state
    check('fixações e marcadores de leitura preservados',
      (await count(A.pool, `select count(*) as n from server_members where server_id = md5('server:g-ok')::uuid::text and user_id = '${manifest.users.bia}' and position = 0`)) === c.pinned
      && (await count(A.pool, 'select count(*) as n from conversation_members where last_read_message_id is not null')) + (await count(A.pool, 'select count(*) as n from channel_read_states')) === c.readMarkers);
    check('nenhuma amizade, convite ou notificação foi criada pela migração', (await count(A.pool, 'select count(*) as n from friendships')) === 0 && (await count(A.pool, 'select count(*) as n from server_invitations')) === 0 && (await count(A.pool, 'select count(*) as n from notifications')) === 0);
    check('DMs legadas continuam (inclusive a de conta apagada) e sem dono', (await count(A.pool, "select count(*) as n from conversations where type = 'direct'")) === 3 && (await count(A.pool, "select count(*) as n from conversation_members m join conversations c on c.id = m.conversation_id where c.type = 'direct' and m.role = 'owner'")) === 0);
    const owners = Object.fromEntries((await A.pool.query<{ conversation_id: string; user_id: string }>(
      "select c.id as conversation_id, s.owner_id as user_id from servers s join conversations c on c.server_id = s.id and c.type = 'text' where s.owner_id is not null")).rows.map((r) => [r.conversation_id, r.user_id]));
    check('cada grupo não vazio virou um servidor com o dono previsto pelas regras do §12.2',
      Object.entries(EXPECTED_OWNER).every(([group, user]) => owners[group] === manifest.users[user]) && Object.keys(owners).filter((id) => id.startsWith('g-')).length === Object.keys(EXPECTED_OWNER).length, JSON.stringify(Object.fromEntries(Object.entries(owners).filter(([id]) => id.startsWith('g-')))));
    check('papel inesperado virou membro', (await count(A.pool, "select count(*) as n from conversation_members where role not in ('owner','member')")) === 0);
    check('grupo vazio foi só relatado (continua existindo)', (await count(A.pool, "select count(*) as n from conversations where id = 'g-empty'")) === 1);
    const again = planRepairs(await loadInventory(A.pool));
    const rerun = await applyRepairs(A.pool, again);
    check('idempotente: depois do reparo o plano é vazio e reaplicar não muda nada', again.length === 0 && rerun.applied.length === 0);
    full.cleanup();

    // ---- B: a migration that dies half-way, then resumes
    note('Migração interrompida no meio e retomada');
    const { db: B } = await legacyDatabase(baseUrl, 'b');
    dbs.push(B);
    await applyRepairs(B.pool, planRepairs(await loadInventory(B.pool)));
    const broken = makeMigrationsFolder({ brokenAfterIdx: 21 });
    let failed: unknown = null;
    try { await migrateOn(B.pool, broken.folder); } catch (err) { failed = err; }
    check('a migration quebrada falha (e não é o portão de dados legados)', failed !== null && !(failed instanceof LegacyDataBlockedError));
    check('a migração é ATÔMICA: a falha desfez tudo (nem as migrations boas antes da quebrada ficaram pela metade)',
      !(await tableExists(B.pool, 'conversation_members_one_owner_idx')) && !(await tableExists(B.pool, 'friendships')) && !(await tableExists(B.pool, 'rehearsal_before_failure')) && !(await tableExists(B.pool, 'admin_audit_logs')));
    broken.cleanup();
    const good = makeMigrationsFolder();
    await migrateOn(B.pool, good.folder);
    check('retomada: sem a quebrada, tudo aplica de uma vez e chega ao topo', (await tableExists(B.pool, 'admin_audit_logs')) && (await tableExists(B.pool, 'reports')) && (await tableExists(B.pool, 'data_repairs')));
    good.cleanup();

    // ---- D: groups become servers (0043)
    note('Grupos viram servidores (schema até a 0042)');
    const D = await createIsolatedDatabase(baseUrl, 'rehearsal', `d_${Date.now().toString(36)}`);
    dbs.push(D);
    const upTo42 = makeMigrationsFolder({ toIdx: 42 });
    try { await migrateOn(D.pool, upTo42.folder); } finally { upTo42.cleanup(); }
    const groups = await seedGroupDataset(D.pool);
    const upTo43 = makeMigrationsFolder({ toIdx: 43 });
    let blocked: unknown = null;
    try { await migrateOn(D.pool, upTo43.folder); } catch (err) { blocked = err; }
    check('o portão recusa converter um grupo sem dono, sem aplicar nada', blocked instanceof LegacyDataBlockedError && !(await tableExists(D.pool, 'servers')));
    const groupPlan = planRepairs(await loadInventory(D.pool));
    check('o reparo nomeia o dono do grupo órfão e mantém o dono do bot', groupPlan.length === 1 && groupPlan[0]!.conversationId === 'grp-orphan' && groupPlan[0]!.userId === groups.users.cy);
    await applyRepairs(D.pool, groupPlan);
    await migrateOn(D.pool, upTo43.folder);
    upTo43.cleanup();
    await verifyServers(D.pool, groups);
    const toTop = makeMigrationsFolder();
    await migrateOn(D.pool, toTop.folder);
    toTop.cleanup();
    await verifyConversion(D.pool, groups);

    // ---- C: a brand new database
    note('Banco vazio');
    const empty = await createIsolatedDatabase(baseUrl, 'rehearsal', `c_${Date.now().toString(36)}`);
    dbs.push(empty);
    const fresh = makeMigrationsFolder();
    await migrateOn(empty.pool, fresh.folder);
    check('banco novo migra do zero ao topo sem o portão atrapalhar', (await tableExists(empty.pool, 'users')) && (await tableExists(empty.pool, 'reports')) && (await tableExists(empty.pool, 'data_repairs')));
    fresh.cleanup();
  } catch (err) {
    check('o ensaio terminou sem exceção inesperada', false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    if (!keep) for (const db of dbs) await db.drop().catch((err) => console.error(`não consegui derrubar ${db.name}:`, err));
    else console.log(`\n--keep: bancos mantidos: ${dbs.map((d) => d.name).join(', ')}`);
  }

  const failed = steps.filter((s) => !s.ok);
  if (asJson) console.log(JSON.stringify({ ok: failed.length === 0, steps }, null, 2));
  else console.log(failed.length === 0 ? `\nENSAIO OK — ${steps.length} verificações` : `\n${failed.length} VERIFICAÇÃO(ÕES) FALHARAM`);
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; });
