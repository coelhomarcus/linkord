# Migrating groups to servers

This runbook covers the production checklist for migrating legacy groups and bots into servers.

Migrations `0043_servers_expand` and `0044_servers_contract` turn every group (and every bot) into a server. The server applies them by itself on boot (unless `MIGRATE_ON_BOOT=0`), behind the migration gate, so a deploy is the migration. This runbook is what to do **before** that deploy, so nothing is lost and nothing surprises you in production.

## What the migration does

For each group or bot conversation:

- A server is created with the group's name, avatar, owner, status and creation date. Every member becomes a server member, keeping when they joined; pinned groups come first in the server rail.
- The group's own conversation row becomes the `#geral` text channel **with the same id**, under the category "Canais de texto". Messages, attachments, reactions, read markers, links and push URLs keep working.
- A voice channel "Geral" is created under "Canais de voz". Call invitation cards now point to it.
- Group invitations become server invitations, group sounds become server sounds, reports on a group now target its server.
- A bot becomes a server whose `#geral` is read-only for `@everyone`. Its webhook keeps its URL and takes the bot's name and avatar.

Ids of the new rows are derived from the group id (`md5('<kind>:' || group_id)`), so running the backfill twice produces the same result.

## 1. Back up production

```bash
pg_dump --format=custom --no-owner --file=linkord-before-servers.dump "$DATABASE_URL_PROD"
```

Keep the file until the new version has been running for a while. Restoring it is the way back: the migration has no down step.

## 2. Rehearse on a copy of that backup

Restore the dump into a throwaway local database and point the scripts at it. Nothing here touches production.

```bash
createdb linkord_prodcopy
pg_restore --no-owner --dbname=linkord_prodcopy linkord-before-servers.dump
export COPY_URL=postgres://linkord:linkord@localhost:5432/linkord_prodcopy
```

Check whether anything would block the migration:

```bash
npm run db:preflight -- --database-url=$COPY_URL
```

The gate refuses 0043 while a group with members has no owner. If the preflight reports one, see what the repair would do, then apply it (one transaction, every change logged in `data_repairs`):

```bash
npm run db:repair -- --database-url=$COPY_URL
npm run db:repair -- --database-url=$COPY_URL --apply
```

Record the counts before migrating:

```sql
select
  (select count(*) from messages) as messages,
  (select count(*) from attachments) as attachments,
  (select count(*) from message_reactions) as reactions,
  (select count(*) from conversations where type in ('group', 'bot')) as groups;
```

Migrate the copy:

```bash
DATABASE_URL=$COPY_URL npm run db:migrate
```

Then compare: `messages`, `attachments` and `reactions` must be unchanged, and `select count(*) from servers` must equal the old `groups` count. Run the app against the copy (`DATABASE_URL=$COPY_URL npm run dev`), open a few migrated servers and check history, attachments, unread counts and the soundboard.

## 3. Run the synthetic rehearsal

```bash
npm run db:rehearse
```

It builds its own `linkord_rehearsal_*` databases with messy legacy data (including a group with no owner and a bot) and checks that every group becomes exactly one server, that `#geral` keeps the old id, that counts survive, that the structure matches what creating a server from the template produces, that a second run of the backfill changes nothing, that a refused migration leaves nothing half-applied, and that a repair failing midway is undone. It never touches `DATABASE_URL` or production.

## 4. Deploy

Once the copy migrated cleanly, run the production repair if the preflight asked for one (`npm run db:repair -- --database-url=$DATABASE_URL_PROD --apply`), then deploy. On boot the server applies 0043 and 0044; if the gate refuses, it logs why and exits without starting, and the database stays as it was.

Clients on the previous version see the "update the app" screen (the protocol version went up) and reload into the new one.
