# AGENTS.md

Instructions for agents (and humans) working in this repository. For "what is this project, how do I run it, what's the stack" see [README.md](README.md) — this file is about **how the code is organized and the conventions to follow when touching it**.

Monorepo: `web/` (frontend, React + Vite + Vitest) and `server/` (backend, Fastify + Drizzle/Postgres + Socket.IO + LiveKit, `node --test`). Both TypeScript/ESM.

## General rule: organize by feature, not by layer

Code is grouped by **domain/feature**, not by technical type. Don't recreate a generic `hooks/`, `components/`, or `handlers/` folder at the root — each feature has its own folder with everything only it uses.

## Frontend (`web/src/`)

```
web/src/
  app/                  # composition root — nothing should import FROM app/
    App.tsx
    layout/             # app-wide screens and chrome: TopBar, GlobalContextMenu, LoadingScreen,
                        # OutdatedClientScreen, RoomErrorScreen, ErrorBoundary, AppModals, AccessNotice
    providers/          # RoomProvider.tsx (the room's state root)
  features/<domain>/    # admin, auth, bots (webhooks), calls, chat, conversations (DMs), friends, gifs,
                        # media, navigation, notifications, profile, reports, servers, settings, soundboard
  shared/                # see criteria below
    api/ hooks/ i18n/ lib/ types/ ui/{primitives,motion}/
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

### Touch: long press, selection, sliders

On a phone, long press is the right-click. There is **one** long press in the app, `useLongPress` (`shared/hooks/useLongPress.ts`), on pointer events: 500 ms (`LONG_PRESS_DELAY_MS`), cancelled by moving past 10 px, by `pointercancel` (the browser started a scroll or a drag), by a second finger, or by anything scrolling under a still finger. While a press is its own, it swallows the browser's touch `contextmenu` (Android fires one; iOS Safari never does) and the click that may follow. Never write another timer for a hold: pass `delay`, `tolerance`, `pointerTypes` (`'all'` for the composer mic, which holds with the mouse too) and `onStart`/`onEnd`.

- **Context menus**: `GlobalContextMenu` runs the hook over the whole app, and on firing dispatches a `contextmenu` event at the finger. So a menu is written once, for right-click (`onContextMenu` with `clientX/Y`), and works under a finger on Android and iOS alike. To make something long-pressable add its data attribute to `PRESSABLE` there (rows: `data-message-id`, `data-conversation-id`; menus of their own: `data-tile-kind`, `data-dm-call-avatar`, `data-voice-member`, which also belong in `DELEGATED_MENU` so the global menu stays out). Inside a pressable row, links, buttons, fields and downloads keep the browser's own long press, except the button that *is* the row (`ROW_CONTROL`). Base UI's trigger has its own touch timer, turned off there with `preventBaseUIHandler`.
- **Feedback** is derived from the press, not timed separately: the row gets `data-long-pressing` and `--long-press-delay` in the pointerdown that starts the timer, both gone when it fires or ends (`styles/index.css`).
- **Selection and callout**: `touch-first` (`@media (hover: none) and (pointer: coarse)`, also `TOUCH_FIRST_QUERY`) is a device whose main input is a finger. There, message text (`.message-press-text`) is not selectable, except its links and after the menu's "Select text"; Base UI's trigger turns the iOS callout off on the whole app. Don't add `user-select`/`-webkit-touch-callout` rules elsewhere.
- **Drag vs long press**: something that is both draggable and long-pressable is not draggable on `touch-first` (see `VoiceMembers.tsx`); its menu offers the move instead.
- **No gesture-only actions**: when a menu is reachable only by right-click or long press, give it a "more actions" button reachable by keyboard and screen readers (`TileMenuButton`, the one in `VoiceMembers`): VoiceOver and TalkBack do not pass a long press through the same way. Swipe-to-reply stays in the message menu; the channel list stays on the header back button.
- **Horizontal swipes** (`useHorizontalSwipe`, numbers in `shared/lib/swipe.ts`): on `touch-first` only. Movement inside the same 10 px lock as long press is ignored, so the press still owns it; the first axis past that lock wins — vertical lets the browser scroll (`pointercancel` is not swallowed), horizontal captures. Reply is a right swipe on a message row (`useSwipeToReply`); the channel/DM list is a right swipe from the left edge of a conversation (`useDrawerEdgeSwipe`), and a left swipe closes it. Skip iOS Safari's back-swipe strip unless the app is standalone. Reduced motion jumps to the end state (no follow).
- **Sliders**: use `shared/ui/primitives/slider.tsx` as is (`size="sm"` for compact controls) rather than restyling the thumb from the call site; it keeps the fill ending at the thumb's centre (`thumbAlignment="edge"`) and a 44 px+ target under a finger. Every slider needs an `aria-label`.

### Motion

Short and quiet, from three durations (`DURATION` in `shared/lib/ease.ts`): **100 ms** for a popup leaving and hover/focus feedback, **150 ms** for a popup appearing or a modal leaving, **200 ms** for a modal appearing and things moving into place. One curve for anything appearing or moving, `EASE_OUT` (`ease-out-expo` in CSS); drawers and sheets keep `EASE_DRAWER` and their springs.

- Popovers, menus, selects and tooltips take `motion-popup`, dialogs and their backdrop `motion-modal` (`styles/index.css`), both on tw-animate's `animate-in`/`animate-out`. Use the primitives rather than restating their timing.
- **Reduced motion** is handled once: under `prefers-reduced-motion` the `enter`/`exit` keyframes keep only the fade, and `MotionConfig reducedMotion="user"` (`App.tsx`) does the same for Motion. Something that moves by other means (a CSS transition on `transform`/`scale`, dnd-kit, `element.animate`) checks it itself (`motion-safe:`/`motion-reduce:`, `useReducedMotion`).
- **Never delay the interaction**: an exit plays while what it hides already takes no input (Base UI does this for popups; `FloatingBar` is `inert` while it leaves).
- **Tests**: exits are CSS animations waited on through `getAnimations()`, which jsdom lacks, so under test things unmount at once and assertions stay synchronous. Keep new exits on that pattern; a Motion `AnimatePresence` exit would keep nodes in the DOM after the state changes. Something that leaves on its own, outside Base UI, uses `useExitPresence` (`shared/hooks`) as `FloatingBar` and the install banner do.

### Error colour

Words that report an error or a failure (an `role="alert"` line, a "failed" label, a counter past its limit) are `text-red-text`, the lighter red made to be read on the dark surfaces; so is the label of a destructive text button. `text-red` is the fill colour: icons, indicators, required-field asterisks and `bg-red/…` tints. A destructive button takes the `danger-outline` (neutral box, red label) or `destructive` (solid red) variant rather than recolouring another one. A boxed error is `ErrorBanner`. Success is `text-green`, never a Tailwind palette green.

### Copy and save confirmations

- **Copy**: never call `navigator.clipboard.writeText` directly. A copy button takes `useCopyToClipboard` (`shared/hooks`) with `CopyStatusIcon` and `CopyLabel` (`shared/CopyFeedback.tsx`): the icon turns into a green check and the label reads "Copiado" for 1.5 s. A menu item that closes as it copies calls `copyToClipboard` (`shared/lib/clipboard.ts`). Both say "Copiado" through the page's one polite live region (`announce` in `shared/lib/announce.ts`), so keep the button's accessible name as it is and add no `role="status"` of your own. A copy the browser refuses shows and says nothing. In tests, read the region with `liveAnnouncements()` (`tests/fixtures/announcerFixture.ts`).
- **Save**: a form that waits for Save confirms through `FloatingBar` ("Alterações salvas."), and nothing else: no toast or second message beside it.

## Backend (`server/src/`)

```
server/src/
  index.ts              # entry point: imports and calls app/bootstrap
  app/                  # bootstrap.ts (the whole boot sequence, including restoring calls)
  config/               # env.ts
  db/                   # client.ts, schema.ts, migrate.ts
  http/                 # app.ts (Fastify), cookies.ts, respond.ts, errors.ts, originGuard.ts
  realtime/             # socket.ts — combines every module's `handlers` into one dispatch table;
                        # protocolVersion.ts, floodControl.ts
  integrations/<name>/  # external service adapters: livekit/, github/, myanimelist/, igdb/ (+ connectionHttp.ts)
  net/                  # safeRequest.ts, ssrfGuard.ts — every request to a user-chosen URL
  lib/                  # logger.ts
  modules/<domain>/     # admin, attachments, auth, blocks, bots, calls, connections, conversations,
                        # friendships, games, gifs, limits, link-preview, logs, messages, migration,
                        # moderation, notifications, presence, profile, reports, servers,
                        # soundboard, users
  scripts/              # CLI scripts behind `npm run db:*`, `admin:*`, `test:integration`
server/tests/            # mirrors server/src/ — NO tests inside src/
```

- **No alias** — every import is a relative path, with an explicit `.js` extension even though the file is `.ts` (this is real ESM; `.js` is what exists after the build). E.g. `import { db } from '../../db/client.js';`.
- **When to split a large module into repository vs. handlers** (the pattern used in `conversations.ts`/`conversationsRepository.ts` and `attachmentUploads.ts`/`uploadSession.ts`): only split with **real fan-in evidence** — if specific functions in the file are already imported by several different external modules (a repository API buried alongside handlers nobody imports individually), splitting is worth it. File size alone is **not** a reason — `messages.ts` is large on purpose: it is one cohesive socket feature, and the few functions others import from it (`announceStoredMessage`, `postBotMessage`) are thin entry points into that same flow. Don't split "because it got big"; split when two different groups of external consumers each only need one half of the file.
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

**2. Calls survive a restart** (LiveKit itself, tokens and rooms, is in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md#livekit)).
- Media flows browser <-> LiveKit, so a restart never interrupts it. What a restart would lose is the server's bookkeeping: a participant's `id` is its LiveKit identity, and `participants` and the DM call `state` live in memory.
- So call membership is written to Postgres as it changes (`call_presence`, via `setCallConversationId` in `modules/presence/participants.ts`; `dm_calls_active`, via `apply` in `modules/calls/dmCalls.ts`). On boot, `restoreCalls` in `app/bootstrap.ts` rebuilds those connections as ghosts with `socket: null` and the **same id and resume token**, held for `CALL_RESTORE_GRACE_MS`. A restart then looks exactly like a short network drop: the client's `join {id, token}` resumes the same participant and the tiles still match the LiveKit identities.
- Rules that keep this working:
  - The shutdown steps in `bootstrap.ts` (`lifecycle.ready`, run by `app/processLifecycle.ts` for SIGTERM/SIGINT and for an uncaught exception or unhandled rejection alike) must not call `removeParticipant`: removal deletes the persisted rows and tells everyone the person left, which is what a deploy must not do. A crash leaves through the same path with a non-zero code and the supervisor restarts the process, so calls come back as after a deploy.
  - It must not call `socket.disconnect()` either, only `io.close()`. Behind the production proxy the disconnect packet reaches the browser, and Socket.IO never reconnects on its own after `io server disconnect`: the tab keeps its LiveKit media but stops hearing about the call (people who join later are invisible and silent to it) until it is focused. `io.close()` drops the transports, which every client build treats as a network drop. Clients also reconnect after a server disconnect that follows a `server-restart` message (`useSocketConnection.ts`), but not after one without it: a duplicated tab resuming the same identity would kick the other one in a loop.
  - Anything that changes which call a connection is in must go through `setCallConversationId`, and DM call changes through the state machine plus `apply`. Writing `callConversationId` directly skips persistence.
  - Persistence is injected (`setCallPresenceStore`, `setDmCallStore`) so `participants.ts` and `dmCalls.ts` stay free of the database and their tests run without one. Writes are queued and their failures only logged: a database problem must never break a live call.
  - Only membership is stored. Mic, camera, share and speaking flags are not: the client reports them again after reconnecting (`syncLocalMedia` in the `welcome` handler).
  - A fresh join of the same account must not evict restored ghosts (`restoredGhostIds`): another tab of that account may reach the server before the tab that is in the call.
- Client fallback: `welcome` carries `callConversationId`. If a reconnecting client is still connected to LiveKit but the server does not have it in that call (a crash with the database down, the grace window expired), `reconcileAfterReconnect` (`features/calls/useCallLifecycle.ts`) rejoins a voice channel, or leaves a DM call that no longer exists.
- A DM call answer (accept, decline, cancel) clicked while the socket is down is kept and sent after the next `welcome`, only if the same call is still waiting for it (`onReconnected` in `features/calls/useDmCall.ts`); other one-shot socket actions are not queued, so a new one that matters during a reconnect needs the same treatment.
- Chat and uploads ride out a restart too, and must keep doing so: a chat send waits in the outbox (`features/chat/useMessageOutbox.ts`) while offline and is resent with the same `clientMessageId` after the next `welcome` (the server answers a duplicate with the original, so nothing is stored twice). An upload keeps its session on disk, a chunk sent again overwrites the same piece, and the client (`shared/lib/chunkedUpload.ts`) retries init, chunks and complete for up to 60 s of outage, counting a response without the app's error envelope (the proxy's 404/502 while the container is swapped) as an outage. The `restart` end-to-end specs guard all of this (see below).
- Known limits: a page reload leaves the call (the LiveKit connection lives in the page), and a tab still running an older build has only that build's client behaviour.
- When you add state to a call, decide whether a restart should keep it. If yes, persist it with the membership; if the client can report it again, do what the media flags do.

## Documentation (`docs/`)

Docs are part of the change: when code changes what a doc describes, update that doc **in the same commit**. Skip it only when nothing a doc says is affected. Pick the doc by what the change touches:

| If the change touches... | Update |
| --- | --- |
| A third-party API or service: adding, removing or changing an endpoint, credential, env var, rate limit, data sent, or what happens when it is missing or fails | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (the overview table and the service's section) |
| Webhooks: URL, payload, cards/embeds, limits, errors, security (`modules/bots`) | [`docs/WEBHOOK.md`](docs/WEBHOOK.md) |
| Local setup, scripts, prerequisites, the env needed to run, troubleshooting, or notes for developing profile connections and the Wall | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| What the product does | [`README.md`](README.md) |
| How it is deployed: the image, required env, mounted folders and their permissions, Dokploy, headers the server sets, production troubleshooting | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Any new or changed environment variable | [`.env.example`](.env.example), plus the doc of the feature that uses it |

- Edit the existing section instead of appending a note; remove statements that are no longer true (a doc that is partly wrong is worse than a short one).
- All documentation is written in English: every file in `docs/`, the README and `.env.example`, including headings, examples and sample data. Only text that quotes something the product really outputs stays as is (for example a server error message that is in Portuguese), and the doc should say so.
- Never put secrets or real credentials in a doc; describe where to get them.
- If a change fits no doc but a reader would need it, extend the closest one rather than creating a new file. `docs/` is ignored by git except for the files listed in `.gitignore` (local notes and screenshots stay out), so a brand-new doc needs its own `!docs/NAME.md` line there.

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

**Scripts and sample data.** Every `npm run` script is listed, with what it does, in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#scripts); look there before writing a one-off. `npm run db:seed` fills a local database with sample accounts, DMs and a server (`server/src/scripts/seedDev.ts`). A new script in `server/src/scripts/` gets a header comment, a `package.json` entry and a row in that table, or nobody will know it exists.

**End-to-end suite (`e2e/`, Playwright).** Real Chrome sessions for several accounts against a production-shaped Docker stack (app behind Traefik, LiveKit, throwaway Postgres); setup and commands in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#end-to-end-tests). Run the matching project when a change touches what it covers, and add a spec when you add a user-facing flow:
- `npm run test:e2e:features`: every feature, one spec per area (`e2e/specs/features/<area>.spec.ts`).
- `npm run test:e2e:restart`: anything a redeploy must survive (realtime, calls, chat sends, uploads, the shutdown path).
- `npm run test:e2e:upgrade`: wire or protocol changes, migrations, anything an old tab talks to (production version vs the working tree).

Rules for specs: set data up through the app's HTTP routes (`e2e/fixtures/api.ts`), never by writing to the database, since the app caches memberships in memory; find elements the way a person does, by role and pt-BR label (the English-only rule applies to everything else, as in `web/tests`); never `.click().catch(() => {})` on something that may not exist (it waits for the whole action timeout); a step that sends a socket message right after a restart waits for the tab's `welcome` first (`waitForSocketEvent`).

## Code Conventions

No Portuguese comments in any source. Comments and identifiers in English; follow the existing language of surrounding prose.

- Comments always explain the *why* (a non-obvious decision, an invariant, a workaround) — never the *what* (the code already says that). Prefer no comment at all when the name is already clear.
- UI strings are translated (see **Internationalization** above); pt-BR is the source language. Code identifiers (variables, functions, types), comments and commit messages are in English.
- **This English-only rule covers tests too**: `describe`/`it` titles, comments, and internal fixture/variable names are in English. The one exception is a literal that's asserting against real UI-rendered text (`getByText`, `aria-label`, toast copy, etc.) — that stays in Portuguese, because the suite renders the app in pt-BR (`tests/setup.ts`). To assert another language wrap the `describe` in `useLanguageForTests('en-US')` (`tests/fixtures/i18nFixture.ts`).

## Commits

Always in English, as short as possible, and always typed.

- Format: `type: imperative summary` — lowercase, no trailing period, ideally under 60 characters. One line; add a body only when the *why* is not obvious from the subject, and keep it to a sentence or two.
- Types: `feat` (new behavior), `fix` (bug), `refactor` (no behavior change), `perf`, `test`, `docs`, `chore` (tooling, deps, cleanup), `build`, `ci`. Optional scope when it helps: `feat(settings): use the full page width`.
- Describe the change, not the process: `fix: revoke pending invite when its card is deleted`, not `fix: some changes to invitations`. No stage or ticket numbers, no filler ("update", "improve stuff").
- One logical change per commit; don't mix a feature with an unrelated fix.
