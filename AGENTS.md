# AGENTS.md

Instructions for agents (and humans) working in this repository. For "what is this project, how do I run it, what's the stack" see [README.md](README.md) — this file is about **how the code is organized and the conventions to follow when touching it**.

Monorepo: `web/` (frontend, React + Vite + Vitest) and `server/` (backend, Fastify + Drizzle/Postgres + Socket.IO + LiveKit, `node --test`). Both TypeScript/ESM.

## General rule: organize by feature, not by layer

The project was restructured (see commit history `refactor: reorganiza o backend em módulos por domínio` / `reorganiza o frontend por funcionalidade`) to group by **domain/feature**, not by technical type. Don't recreate a generic `hooks/`, `components/`, or `handlers/` folder at the root — each feature has its own folder with everything only it uses.

## Frontend (`web/src/`)

```
web/src/
  app/                  # composition root — nothing should import FROM app/
    App.tsx
    layout/             # GlobalContextMenu, LoadingScreen, RoomErrorScreen, ReconnectBanner
    providers/          # RoomProvider.tsx (the room's state root)
  features/<domain>/    # servers, calls, chat, conversations (DMs), media, profile, settings, auth, reactions...
  shared/                # see criteria below
    api/ hooks/ lib/ types/ ui/{primitives,motion}/
    Avatar.tsx, ConfirmDialog.tsx, notifications.ts, sounds.ts, ...
  state/                 # RoomContext, AuthContext, roomReducer + state/hooks/ (cross-cutting)
  styles/                # global CSS
web/tests/               # mirrors web/src/ — NO tests inside src/
```

- **`features/<domain>/`**: a feature's component, hook, and test live together (the test in `web/tests/features/<domain>/`, mirroring the path). If a hook/component is only used by one feature, it lives there — not in `shared/`.
- **`shared/` is only for things that genuinely have no owner** — used by 2+ features with none of them being the natural owner, or pure infrastructure (HTTP client, protocol types, UI primitives). Before putting something in `shared/`, confirm with a grep of who imports it — if only one feature uses it, it's not a `shared/` candidate.
- **`state/hooks/`** is for the rare case of a cross-cutting hook with no owning feature at all (e.g. `usePresence`, `useTypingIndicator`, `useSocketConnection` — only used by `RoomProvider`, but don't belong to any specific feature).
- **Alias `@/`** → `web/src`; **`@tests/`** → `web/tests` (configured in `vite.config.ts` and `tsconfig.app.json`). An import of a file in the same directory stays relative (`./Sibling`); any import that would need to climb out with `../` becomes `@/full/path` instead.
- Tests ALWAYS in `web/tests/`, never inside `web/src/`.

## Backend (`server/src/`)

```
server/src/
  app/                  # bootstrap.ts (the whole boot sequence) + index.ts (3 lines: imports and calls bootstrap)
  config/               # env.ts
  db/                   # client.ts, schema.ts, migrate.ts
  http/                 # app.ts (Fastify), cookies.ts, respond.ts
  realtime/             # socket.ts — combines every module's `handlers` into one dispatch table
  integrations/<name>/  # external service adapters: livekit/
  modules/<domain>/     # auth, users, presence, servers, conversations, messages, calls,
                        # attachments, moderation, profile, link-preview
server/tests/            # mirrors server/src/ — NO tests inside src/
```

- **No alias** — every import is a relative path, with an explicit `.js` extension even though the file is `.ts` (this is real ESM; `.js` is what exists after the build). E.g. `import { db } from '../../db/client.js';`.
- **When to split a large module into repository vs. handlers** (the pattern used in `conversations.ts`/`conversationsRepository.ts` and `attachmentUploads.ts`/`uploadSession.ts`): only split with **real fan-in evidence** — if specific functions in the file are already imported by several different external modules (a repository API buried alongside handlers nobody imports individually), splitting is worth it. File size alone is **not** a reason — `messages.ts` stays at ~470 lines on purpose because it's cohesive and none of its functions are used outside its own socket dispatch. Don't split "because it got big"; split when two different groups of external consumers each only need one half of the file.
- **Never use a dynamic `import()` just to dodge an import cycle.** If two modules form a cycle, extract the part both need into a new leaf module (zero dependency back into the cycle) — that's what resolved the `conversations.ts`/`attachments.ts` cycle (see `modules/attachments/attachmentCleanup.ts`, which only depends on `db`/schema/`attachmentStorage.ts`). A dynamic import is a sign the module boundary is wrong, not a solution.
- **Servers and channels**: a channel is a `conversations` row (`type` `text` or `voice`, with `serverId`); a DM is `type` `direct` with `conversation_members`. Access to a channel goes through `getConversationForUser(id, userId, permission)` in `conversationsRepository.ts`, which resolves the member's permissions (`modules/servers/permissions.ts`, mirrored in `web/src/features/servers/permissionBits.ts` and pinned by a test). Ask for the bit the action needs — never check membership by hand.
- Tests ALWAYS in `server/tests/`, never inside `server/src/`.

## Internationalization (`web/`)

i18next + react-i18next, strings bundled (no backend). Supported languages live in `web/src/shared/i18n/languages.ts` (mirrored by `server/src/modules/users/locale.ts`, pinned by a server test).

- **Where strings live**: `features/<name>/locales/{pt-BR,en-US}.json`, one namespace per feature (the folder name); `shared/i18n/locales/` is the `common` namespace for things with no owner. Don't create a root-level translations folder.
- **Using them**: `const { t } = useTranslation('<feature>')`. Outside React (hooks' error text, plain modules) use `i18n.t('<ns>:key')` from `@/shared/i18n/init`, at the moment the text is produced — never at module load, which would freeze the language. For catalogs of labels (like `settingsCatalog.ts`), store the *key* and call `t()` where it renders.
- **Keys**: nested and descriptive (`email.errors.sendFailed`), pt-BR is the source of truth for names and types (register the namespace in `shared/i18n/i18next.d.ts`). Plurals use `_one`/`_other` (pt-BR also `_zero` when 0 reads differently). Variables are `{{name}}`.
- **Adding a language**: one entry in `languages.ts` (and the server's `LOCALES`), one JSON per namespace. `tests/shared/i18n/localeParity.test.ts` fails until every file has the same keys and `{{variables}}`.
- **Language preference**: the account's `users.locale` wins; `ss-locale` in localStorage covers logged-out screens; then the browser's language; then pt-BR.
- **Dates/numbers**: don't hardcode `'pt-BR'` in `toLocale*String` — use the active language.
- Proper names (theme names, "Linkord") stay untranslated.

## Realtime compatibility and deploys

A deploy restarts the Node process while people are connected, and browsers keep running the old JS until they reload. Two things make that safe; both are easy to break without noticing.

**1. The protocol version gate** (`server/src/realtime/protocolVersion.ts`, client side `web/src/shared/types/protocol.ts`).
- Every client sends its `PROTOCOL_VERSION` in `join`. The server compares it with `MIN_PROTOCOL_VERSION` (`isClientCompatible`) and, if lower, answers `client_outdated` and disconnects. The client then stops reconnecting and replaces the whole app with `OutdatedClientScreen` ("reload the page").
- The gate is a rule, not a reconnect check: an old tab that could technically reconnect is still refused once the minimum is raised. It also drops that person out of any call, because the server loses their connection.
- So: **do not raise `MIN_PROTOCOL_VERSION` for a change an old client can tolerate.** Make wire changes additive instead: a new optional field in a server message (the client treats `undefined` as "old server"; see `welcome.callConversationId`), a new message type old clients ignore, a new handler that old clients simply never call. Raise the minimum only when an old client would misbehave or corrupt state (a message changing meaning, a removed field it depends on). When you do, say so in the commit body, and expect everyone to lose their calls once.
- `PROTOCOL_VERSION` (what this build speaks) and `MIN_PROTOCOL_VERSION` (what the server accepts) are separate on purpose. Bump the first for any wire change worth knowing about; bump the second only as above. Keep the comment history in that file up to date.

**2. Calls survive a restart** (details and rationale in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md#livekit)).
- Media flows browser <-> LiveKit, so a restart never interrupts it. What a restart would lose is the server's bookkeeping: a participant's `id` is its LiveKit identity, and `participants` and the DM call `state` live in memory.
- So call membership is written to Postgres as it changes (`call_presence`, via `setCallConversationId` in `modules/presence/participants.ts`; `dm_calls_active`, via `apply` in `modules/calls/dmCalls.ts`). On boot, `restoreCalls` in `app/bootstrap.ts` rebuilds those connections as ghosts with `socket: null` and the **same id and resume token**, held for `CALL_RESTORE_GRACE_MS`. A restart then looks exactly like a short network drop: the client's `join {id, token}` resumes the same participant and the tiles still match the LiveKit identities.
- Rules that keep this working:
  - The SIGTERM handler in `bootstrap.ts` must not call `removeParticipant`: removal deletes the persisted rows and tells everyone the person left, which is what a deploy must not do.
  - It must not call `socket.disconnect()` either, only `io.close()`. Behind the production proxy the disconnect packet reaches the browser, and Socket.IO never reconnects on its own after `io server disconnect`: the tab keeps its LiveKit media but stops hearing about the call (people who join later are invisible and silent to it) until it is focused. `io.close()` drops the transports, which every client build treats as a network drop. Clients also reconnect after a server disconnect that follows a `server-restart` message (`useSocketConnection.ts`), but not after one without it: a duplicated tab resuming the same identity would kick the other one in a loop.
  - Anything that changes which call a connection is in must go through `setCallConversationId`, and DM call changes through the state machine plus `apply`. Writing `callConversationId` directly skips persistence.
  - Persistence is injected (`setCallPresenceStore`, `setDmCallStore`) so `participants.ts` and `dmCalls.ts` stay free of the database and their tests run without one. Writes are queued and their failures only logged: a database problem must never break a live call.
  - Only membership is stored. Mic, camera, share and speaking flags are not: the client reports them again after reconnecting (`syncLocalMedia` in the `welcome` handler).
  - A fresh join of the same account must not evict restored ghosts (`restoredGhostIds`): another tab of that account may reach the server before the tab that is in the call.
- Client fallback: `welcome` carries `callConversationId`. If a reconnecting client is still connected to LiveKit but the server does not have it in that call (a crash with the database down, the grace window expired), `reconcileAfterReconnect` (`features/calls/useCallLifecycle.ts`) rejoins a voice channel, or leaves a DM call that no longer exists.
- Known limits: a page reload leaves the call (the LiveKit connection lives in the page); the first deploy that introduces persistence cannot restore calls that were opened before it; old JS has no client fallback.
- When you add state to a call, decide whether a restart should keep it. If yes, persist it with the membership; if the client can report it again, do what the media flags do.

## Documentation (`docs/`)

Docs are part of the change: when code changes what a doc describes, update that doc **in the same commit**. Skip it only when nothing a doc says is affected. Pick the doc by what the change touches:

| If the change touches... | Update |
| --- | --- |
| A third-party API or service: adding, removing or changing an endpoint, credential, env var, rate limit, data sent, or what happens when it is missing or fails | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (the overview table and the service's section) |
| Webhooks: URL, payload, cards/embeds, limits, errors, security (`modules/bots`) | [`docs/WEBHOOK.md`](docs/WEBHOOK.md) |
| Local setup, scripts, prerequisites, the env needed to run, troubleshooting, or notes for developing profile connections and the Wall | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| What the product does, or how it is deployed | [`README.md`](README.md) |
| Any new or changed environment variable | [`.env.example`](.env.example), plus the doc of the feature that uses it |

- Edit the existing section instead of appending a note; remove statements that are no longer true (a doc that is partly wrong is worse than a short one).
- All documentation is written in English: every file in `docs/`, the README and `.env.example`, including headings, examples and sample data. Only text that quotes something the product really outputs stays as is (for example a server error message that is in Portuguese), and the doc should say so.
- Never put secrets or real credentials in a doc; describe where to get them.
- If a change fits no doc but a reader would need it, extend the closest one rather than creating a new file. `docs/` is mostly ignored by git (see `.gitignore`), so a brand-new doc needs `git add -f` or its own `!docs/NAME.md` line.

## Verification before calling something done

```bash
# backend
npx tsc -p server/tsconfig.json --noEmit      # typecheck the production build
npm run typecheck:server:tests                 # typecheck server/tests/
npm run test:server                            # node --test

# frontend
cd web && npx tsc -p tsconfig.app.json --noEmit
cd web && npm run lint                         # oxlint
cd web && npm run test                         # vitest run

# both together
npm run build                                  # tsc -p server + vite build
npm test                                       # test:server + test:web
```

A change that touches a real flow (upload, call, conversations, auth) deserves live manual verification (`npm run dev`, 2 accounts), not just automated tests.

## Code Conventions

No Portuguese comments in any source. Comments and identifiers in English; follow the existing language of surrounding prose.

- Comments always explain the *why* (a non-obvious decision, an invariant, a workaround) — never the *what* (the code already says that). Prefer no comment at all when the name is already clear.
- UI strings are translated (see **Internationalization** below); pt-BR is the source language. Code identifiers (variables, functions, types), comments and commit messages are in English.
- **This English-only rule covers tests too**: `describe`/`it` titles, comments, and internal fixture/variable names are in English. The one exception is a literal that's asserting against real UI-rendered text (`getByText`, `aria-label`, toast copy, etc.) — that stays in Portuguese, because the suite renders the app in pt-BR (`tests/setup.ts`). To assert another language wrap the `describe` in `useLanguageForTests('en-US')` (`tests/fixtures/i18nFixture.ts`).

## Commits

Always in English, as short as possible, and always typed.

- Format: `type: imperative summary` — lowercase, no trailing period, ideally under 60 characters. One line; add a body only when the *why* is not obvious from the subject, and keep it to a sentence or two.
- Types: `feat` (new behavior), `fix` (bug), `refactor` (no behavior change), `perf`, `test`, `docs`, `chore` (tooling, deps, cleanup), `build`, `ci`. Optional scope when it helps: `feat(settings): use the full page width`.
- Describe the change, not the process: `fix: revoke pending invite when its card is deleted`, not `fix: some changes to invitations`. No stage or ticket numbers, no filler ("update", "improve stuff").
- One logical change per commit; don't mix a feature with an unrelated fix.
