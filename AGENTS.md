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
