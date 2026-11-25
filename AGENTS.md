# AGENTS.md

Instructions for agents (and humans) working in this repository. What the project is and how to run it is in [README.md](README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); this file is about **how the code is organized and the conventions to follow when touching it**.

Monorepo: `web/` (React + Vite + Vitest), `server/` (Fastify + Drizzle/Postgres + Socket.IO + LiveKit, `bun test`) and `desktop/` (an Electron window around the web app, `node --test`). All TypeScript/ESM.

## Branch workflow

Do repository work and commit on `develop`. Promote changes to `main` through pull requests from `develop`.

## General rule: organize by feature, not by layer

Code is grouped by **domain/feature**, not by technical type. Don't create a generic `hooks/`, `components/` or `handlers/` folder at the root: each feature has its own folder with everything only it uses.

## Frontend (`web/src/`)

```
web/src/
  app/              # composition root, nothing imports FROM it: App.tsx, layout/ (app-wide screens and
                    # chrome, the desktop title bar), providers/RoomProvider.tsx (the room's state root)
  features/<domain>/ # one folder per feature (chat, calls, profile, settings, ...), with its locales/
  shared/           # api/ hooks/ i18n/ lib/ types/ ui/ and components with no single owner
  state/            # RoomContext (the room store and its readers), RoomStoreProvider, AuthContext,
                    # roomReducer, hooks/ (cross-cutting)
  styles/           # global CSS
web/tests/          # mirrors web/src/ — NO tests inside src/
```

- **`features/<domain>/`**: a hook or component used by one feature lives in it. Its test lives at the mirrored path in `web/tests/features/<domain>/` (Vitest only runs `tests/**`).
- **`shared/` is only for things with no owner**: used by two or more features with none the natural owner, or pure infrastructure (HTTP client, protocol types, UI primitives). Grep who imports something before moving it there.
- **`state/hooks/`** is for the rare cross-cutting hook with no owning feature (`usePresence`, `useTypingIndicator`, `useSocketConnection`).
- **Imports:** `@/` → `web/src`, `@tests/` → `web/tests`. A file in the same directory is imported relatively (`./Sibling`); anything that would climb out with `../` uses `@/full/path`.

### Reading the room

`RoomProvider` publishes one `RoomContextValue` through a store (`state/RoomContext.ts`), rebuilt on every event: in a call a `speaking` flag flips several times a second. A component re-renders only when what it read changes, so it says what it reads:

- `useRoom('servers', 'openCall')` for fields of the value, `useRoomState('me', 'focusedId')` for the reducer's state; both compare each field by identity.
- `useRoomSelector((room) => …, isEqual?)` for anything derived (one participant, one count, a lookup by a prop), so a row does not re-render for every other row's change. `useOptionalRoomSelector` where the component also renders outside `RoomProvider`.
- Who is in which call without their media: `useCallRoster()` (`features/calls/callRoster.ts`), which keeps its identity while people only speak, mute or share. Only call UI reads `participants` itself.
- A value or callback the provider hands out keeps its identity until it really changes (`useCallback`/`useMemo`, no inline lambdas or object literals), or everyone who reads it re-renders on every event.
- Tests pass a fake value to `RoomStoreProvider` (`renderWithRoom` in `tests/fixtures/roomContextFixture.tsx`); to change it, pass a new object rather than mutating the old one.

### Server reads shown in several places

A read that more than one surface shows (a profile, its details, its Wall, a relationship) goes through `createResourceCache` (`shared/lib/resourceCache.ts`) and `useResource`: what was read before renders at once and is read again behind it, requests in flight are shared, and `clearResourceCaches()` runs on sign-out. Skeletons are only for what was never read. A change the person makes shows at once and is put back if the server refuses (`changeRelationship` in `features/friends/useRelationship.ts`). Seed a profile a list row already knows with `rememberProfilePreview`.

### React Compiler

`vite build`, the dev server and Vitest all run the React Compiler (`web/vite.config.ts`). It memoizes every component and hook it can, so a value computed in render is recomputed only when something it reads from props, state, context or a hook changes.

- **Render reads nothing else.** A module-level cache, `i18n.language`, `getTimeFormat()`, `localStorage` or the clock read during render is computed once and kept. Take the language from `useLanguage()` and the time format from `useTimeFormat()` and pass them in (`formatTime(ts, language, timeFormat)`); a plain function called during render takes `language` and translates with `i18n.t(key, { lng: language })`. A cache that fills later is read through `useSyncExternalStore` (`useResolvedTwemoji`, `useEmojiData`), never through a counter bumped to force a render.
- **No new `useMemo`/`useCallback`/`memo` by hand** in compiled code; keep the existing ones only where identity is a contract (what `RoomProvider` hands out). Remove one rather than fight a `preserve-manual-memoization` diagnostic.
- **What it skips** still works, unmemoized: a Rules of React violation (a ref read during render, a lint suppression), `try`/`finally` (move the `finally` body after the `try`/`catch`), getters in an object literal (build the object in a plain function outside the component). `REACT_COMPILER_LOG=1 bun run build:web` lists every skipped component and why; check it for what you touch on a hot path (the chat view, call tiles).
- `useVirtualizer` (TanStack Virtual) is incompatible: the compiler leaves `MessageTimeline` and the other virtual lists as written, so their manual memoization of rows stays.

### Touch: long press, selection, sliders

On a phone, long press is the right-click. There is **one** long press in the app, `useLongPress` (`shared/hooks/useLongPress.ts`): 500 ms, cancelled by moving past 10 px, by `pointercancel`, by a second finger or by scrolling. Never write another timer for a hold: pass `delay`, `tolerance`, `pointerTypes` (`'all'` for the composer mic) and `onStart`/`onEnd`.

- **Context menus:** `GlobalContextMenu` runs the hook over the whole app and dispatches a `contextmenu` event at the finger, so a menu is written once, for right-click (`onContextMenu` with `clientX/Y`), and works under a finger on Android and iOS. To make something long-pressable, add its data attribute to `PRESSABLE` there (menus of their own also go in `DELEGATED_MENU`). Inside a pressable row, links, buttons and fields keep the browser's own long press, except the button that *is* the row (`ROW_CONTROL`).
- **Feedback** comes from the press itself: the row gets `data-long-pressing` and `--long-press-delay` while the timer runs (`styles/index.css`).
- **Selection and callout:** `touch-first` (`@media (hover: none) and (pointer: coarse)`, also `TOUCH_FIRST_QUERY`) is a device whose main input is a finger. There, message text (`.message-press-text`) is not selectable except its links and after the menu's "Select text", and the iOS callout is off app-wide. Don't add `user-select`/`-webkit-touch-callout` rules elsewhere.
- **Drag vs long press:** something both draggable and long-pressable is not draggable on `touch-first` (see `VoiceMembers.tsx`); its menu offers the move instead.
- **No gesture-only actions:** a menu reachable only by right-click or long press also gets a "more actions" button for keyboards and screen readers (`TileMenuButton`). Swipe-to-reply stays in the message menu too.
- **Horizontal swipes** (`useHorizontalSwipe`, numbers in `shared/lib/swipe.ts`), on `touch-first` only: inside the long press's 10 px nothing happens; past it the first axis wins (vertical scrolls). Reply is a right swipe on a message row (`useSwipeToReply`); the channel/DM list opens with a right swipe from the left edge (`useDrawerEdgeSwipe`). Reduced motion jumps to the end state.
- **Sliders:** use `shared/ui/primitives/slider.tsx` as is (`size="sm"` for compact controls); it keeps the fill aligned with the thumb and a 44 px+ target. Every slider needs an `aria-label`.

### Motion

Short and quiet, from three durations (`DURATION` in `shared/lib/ease.ts`): **100 ms** for a popup leaving and hover/focus feedback, **150 ms** for a popup appearing or a modal leaving, **200 ms** for a modal appearing and things moving into place. One curve for anything appearing or moving, `EASE_OUT` (`ease-out-expo` in CSS); drawers and sheets keep `EASE_DRAWER` and their springs.

- Popovers, menus, selects and tooltips take `motion-popup`, dialogs and their backdrop `motion-modal` (`styles/index.css`). Use the primitives rather than restating their timing.
- **Reduced motion** is handled once (the keyframes keep only the fade; `MotionConfig reducedMotion="user"` in `App.tsx`). Anything that moves by other means (a CSS transition on `transform`, dnd-kit, `element.animate`) checks it itself (`motion-safe:`/`motion-reduce:`, `useReducedMotion`).
- **Never delay the interaction:** an exit plays while what it hides already takes no input (`FloatingBar` is `inert` while it leaves).
- **Tests:** jsdom lacks `getAnimations()`, so under test things unmount at once and assertions stay synchronous. Keep exits as CSS animations (not Motion's `AnimatePresence`); something that leaves on its own outside Base UI uses `useExitPresence` (`shared/hooks`).

### Error colour

Error text (an `role="alert"` line, a "failed" label, a counter past its limit) and the label of a destructive text button are `text-red-text`, the red made for dark surfaces. `text-red` is the fill colour: icons, indicators, required-field asterisks, `bg-red/…` tints. A destructive button uses the `danger-outline` or `destructive` variant. A boxed error is `ErrorBanner`. Success is `text-green`, never a Tailwind palette green.

### Copy and save confirmations

- **Copy:** never call `navigator.clipboard.writeText` directly. A copy button takes `useCopyToClipboard` (`shared/hooks`) with `CopyStatusIcon` and `CopyLabel` (`shared/CopyFeedback.tsx`); a menu item that closes as it copies calls `copyToClipboard` (`shared/lib/clipboard.ts`). Both announce "Copiado" through the page's one live region (`announce` in `shared/lib/announce.ts`), so add no `role="status"` of your own. In tests, read it with `liveAnnouncements()` (`tests/fixtures/announcerFixture.ts`).
- **Save:** a form that waits for Save confirms through `FloatingBar` ("Alterações salvas.") and nothing else.

## Backend (`server/src/`)

```
server/src/
  index.ts, app/        # entry point; app/bootstrap.ts is the whole boot and shutdown sequence
  config/env.ts         # every environment variable
  db/                   # client, schema, migrations
  http/                 # Fastify app, cookies, errors, origin guard, security headers
  realtime/             # socket.ts combines every module's `handlers`; protocolVersion.ts, floodControl.ts
  integrations/<name>/  # adapters for external services (livekit, github, igdb, steam, twitch, ...)
  net/                  # safeRequest.ts, ssrfGuard.ts: every request to a URL a user or response chose
  modules/<domain>/     # one folder per domain (messages, calls, presence, connections, ...)
  scripts/              # the CLI scripts behind `bun run db:*`, `admin:*`, `backup`, `test:integration`
server/tests/           # mirrors server/src/ — NO tests inside src/
```

- **No alias:** every import is relative, with an explicit `.js` extension even though the file is `.ts` (`import { db } from '../../db/client.js';`).
- **Split a module only on real fan-in evidence:** when several outside modules each need only one half of a file (as with `conversations.ts`/`conversationsRepository.ts`). Size alone is not a reason; `messages.ts` is large on purpose.
- **Never use a dynamic `import()` to dodge an import cycle.** Extract what both modules need into a new leaf module with no dependency back into the cycle (as `modules/attachments/attachmentCleanup.ts` did).
- **Servers and channels:** a channel is a `conversations` row (`type` `text` or `voice`, with `serverId`); a DM is `type` `direct` with `conversation_members`. Access to a channel goes through `getConversationForUser(id, userId, permission)` in `conversationsRepository.ts`, which resolves the member's permissions (`modules/servers/permissions.ts`, mirrored in `web/src/features/servers/permissionBits.ts` and pinned by a test). Ask for the bit the action needs; never check membership by hand.

## Desktop (`desktop/`)

```
desktop/
  src/main/      # Electron main process: index.ts (lifecycle), mainWindow.ts, session.ts (permissions),
                 # contentsGuard.ts (navigation and popups); rules as plain modules, wired by *Bridge/*Window files
  src/preload/   # index.cts, the only bridge into the page (trayMenu.cts serves the drawn tray menu)
  scripts/       # package.mjs (`npm run package`)
  resources/     # installer icons and NSIS include; electron-builder.config.cjs sits next to package.json
desktop/tests/   # mirrors desktop/src/ — NO tests inside src/
```

- **Windows only.** Build and test new desktop work for Windows; add no macOS- or Linux-specific behaviour. What is left for macOS only lets a development run start on a Mac (its title bar buttons, native tray menu, camera and microphone prompt); keep it working, but add no features there. The web app still accepts what old macOS and Linux installs (0.3.x) send (the `'linux'` title bar style, the `'system'` share picker, the `'notify'` update mode).
- **The window loads the server, not a bundled copy of `web/`.** Same origin means cookies, `originGuard` and CSP work unchanged and a deploy updates the interface. Don't load local files or add an API proxy without a reason that outweighs that.
- **Rules live in plain modules with no `electron` import**, so `node --test` covers them; the files that import `electron` only wire them to events. A new decision (what to allow, where to go, how long to wait) goes in a plain module with a test.
- **The page is untrusted:** `contextIsolation`, `sandbox`, no `nodeIntegration` on every window (`SECURE_WEB_PREFERENCES`). Permissions are an allowlist checked against the app's origin (`permissions.ts`); add one only for a feature the web app really uses.
- **Each preload is one CommonJS file** (`.cts`; a sandboxed preload can neither be ESM nor require local files). It exposes `window.linkordDesktop` and nothing else: anything more the page needs is a named function that sends a specific IPC message, never `ipcRenderer` itself. The web side types that object in `shared/desktop.ts` (`desktopApp()`, `isDesktopApp()`); change both together, and keep the web app working when a field is missing (an older desktop build).
- Imports are relative with `.js` extensions, as in `server/`.

## Internationalization (`web/`)

i18next + react-i18next, strings bundled. Supported languages live in `web/src/shared/i18n/languages.ts` (mirrored by `server/src/modules/users/locale.ts`, pinned by a server test).

- **Where strings live:** `features/<name>/locales/{pt-BR,en-US}.json`, one namespace per feature (the folder name); `shared/i18n/locales/` is the `common` namespace. No root-level translations folder.
- **Using them:** `const { t } = useTranslation('<feature>')`. Outside React use `i18n.t('<ns>:key')` from `@/shared/i18n/init` when the text is produced, never at module load. A plain function called during render takes the language as an argument (`{ lng: language }`; see **React Compiler**). Catalogs of labels (like `settingsCatalog.ts`) store the *key* and call `t()` where it renders.
- **Keys:** nested and descriptive (`email.errors.sendFailed`); pt-BR is the source of truth for names and types (register the namespace in `shared/i18n/i18next.d.ts`). Plurals use `_one`/`_other` (pt-BR also `_zero` when 0 reads differently). Variables are `{{name}}`.
- **Adding a language:** one entry in `languages.ts` (and the server's `LOCALES`), one JSON per namespace. `tests/shared/i18n/localeParity.test.ts` fails until every file has the same keys and variables.
- **Language preference:** the account's `users.locale`, then `ss-locale` in localStorage (logged-out screens), then the browser's language, then pt-BR.
- **Dates and numbers** use the active language, never a hardcoded `'pt-BR'`. Proper names (theme names, "Linkord") stay untranslated.

## Realtime compatibility and deploys

A deploy restarts the Bun process while people are connected, and browsers keep running the old JS until they reload. Two things make that safe; both are easy to break without noticing.

**1. The protocol version gate** (`server/src/realtime/protocolVersion.ts`, client side `web/src/shared/types/protocol.ts`).

- Every client sends its `PROTOCOL_VERSION` in `join`. Below `MIN_PROTOCOL_VERSION` the server answers `client_outdated` and disconnects; the client stops reconnecting and shows `OutdatedClientScreen`, dropping out of any call.
- So: **do not raise `MIN_PROTOCOL_VERSION` for a change an old client can tolerate.** Make wire changes additive: a new optional field (the client treats `undefined` as "old server", as with `welcome.callConversationId`), a new message type old clients ignore, a new handler they never call. Raise the minimum only when an old client would misbehave or corrupt state, say so in the commit body, and expect everyone to lose their calls once.
- Bump `PROTOCOL_VERSION` for any wire change worth knowing about, and keep the comment history in that file up to date.

**2. Calls survive a restart** (LiveKit itself is in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md#livekit)).

- Media flows browser ↔ LiveKit, so a restart never interrupts it; what it would lose is the server's bookkeeping, which lives in memory. So call membership is written to Postgres as it changes (`call_presence` via `setCallConversationId` in `modules/presence/participants.ts`; `dm_calls_active` via `apply` in `modules/calls/dmCalls.ts`), and on boot `restoreCalls` (`app/bootstrap.ts`) rebuilds those connections as ghosts with `socket: null` and the **same id and resume token** for `CALL_RESTORE_GRACE_MS`. A restart then looks like a short network drop: the client's `join {id, token}` resumes the same participant.
- Rules that keep this working:
  - The shutdown path (`lifecycle.ready`, run by `app/processLifecycle.ts` for SIGTERM/SIGINT and for an uncaught exception alike) must not call `removeParticipant` (that deletes the persisted rows and tells everyone the person left), and must not call `socket.disconnect()`, only `io.close()`: behind the production proxy the disconnect packet reaches the browser, and Socket.IO never reconnects on its own after `io server disconnect`. Clients do reconnect after a server disconnect that follows a `server-restart` message (`useSocketConnection.ts`), but not after one without it, or a duplicated tab resuming the same identity would kick the other in a loop.
  - Anything that changes which call a connection is in goes through `setCallConversationId`, and DM call changes through the state machine plus `apply`. Writing `callConversationId` directly skips persistence and the one-call rule: an account is in one call at a time across its tabs and devices, so entering a call takes its other connections out (`releaseCallsElsewhere`, which sends them `call-replaced`). A request while another connection holds a call is refused with `call-elsewhere` unless it carries `replace: true`, sent once the person confirms.
  - Persistence is injected (`setCallPresenceStore`, `setDmCallStore`) so `participants.ts` and `dmCalls.ts` stay free of the database. Writes are queued and failures only logged: a database problem must never break a live call.
  - Only membership is stored; mic, camera, share and speaking flags are reported again by the client after reconnecting (`syncLocalMedia` in the `welcome` handler).
  - A fresh join of the same account must not evict restored ghosts (`restoredGhostIds`): another tab may reach the server first.
- Client fallbacks: if a reconnecting client is still in LiveKit but the server no longer has it in that call, `reconcileAfterReconnect` (`features/calls/useCallLifecycle.ts`) rejoins the voice channel or leaves the dead DM call. A DM call answer clicked while offline is sent after the next `welcome` if the same call still waits for it (`onReconnected` in `features/calls/useDmCall.ts`); other one-shot socket actions are not queued, so a new one that matters during a reconnect needs the same treatment.
- Chat and uploads ride out a restart too: a chat send waits in the outbox (`features/chat/useMessageOutbox.ts`) and is resent with the same `clientMessageId` after `welcome` (the server answers a duplicate with the original). An upload keeps its session on disk, and the client (`shared/lib/chunkedUpload.ts`) retries for up to 60 s of outage, counting a response without the app's error envelope (the proxy's 404/502 during a swap) as an outage. The `restart` end-to-end specs guard all of this.
- A page reload leaves the call (the LiveKit connection lives in the page). When you add state to a call, decide whether a restart should keep it: persist it with the membership, or have the client report it again like the media flags.

## Documentation (`docs/`)

Docs are part of the change: when code changes what a doc describes, update that doc **in the same commit**. Pick the doc by what the change touches:

| If the change touches... | Update |
| --- | --- |
| A third-party API or service: an endpoint, credential, env var, rate limit, data sent, or what happens when it is missing or fails | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) (the overview table and the service's section) |
| Webhooks: URL, payload, cards, limits, errors, security (`modules/bots`) | [`docs/WEBHOOK.md`](docs/WEBHOOK.md) |
| Local setup, scripts, tests, the env needed to run, troubleshooting, server limits, notes for developing a feature | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| What the product does | [`README.md`](README.md) |
| How it is deployed and operated: the image, required env, folders and permissions, backups and restore, Dokploy, headers, the desktop installer, production troubleshooting | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Any new or changed environment variable | [`.env.example`](.env.example), plus the doc of the feature that uses it |

- Edit the existing section instead of appending a note, and remove statements that are no longer true. Say each thing in one doc and link to it from the others.
- Write for the reader (developer, operator, webhook user): what it does and why, not a walk through the code. Detail that only matters inside the code belongs in a code comment.
- All documentation is in English. Only quoted product output (a server error message in Portuguese, for example) stays as is, and the doc says so.
- Never put secrets or real credentials in a doc; say where to get them.
- A change that fits no doc extends the closest one. `docs/` is ignored by git except the files listed in `.gitignore`, so a brand-new doc needs its own `!docs/NAME.md` line there.

## Verification before calling something done

```bash
# backend
bun --bun tsc -p server/tsconfig.json --noEmit      # typecheck the production build
bun run typecheck:server:tests                 # typecheck server/tests/
bun run test:server                            # bun test

# frontend
cd web && bun --bun tsc -p tsconfig.app.json --noEmit
cd web && bun run lint                         # oxlint
cd web && bun run test                         # vitest run

# desktop
npm run typecheck --prefix desktop
npm test --prefix desktop

# both together
bun run build                                  # tsc -p server + vite build
bun run test                                   # test:server + test:web
```

A change that touches a real flow (upload, call, conversations, auth) deserves live verification (`bun run dev`, two accounts), not just automated tests.

**Scripts and sample data.** Every root script is in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#scripts); look there before writing a one-off. `bun run db:seed` fills a local database with sample accounts, DMs and a server. A new script in `server/src/scripts/` gets a header comment, a `package.json` entry and a row in that table.

**End-to-end suite (`e2e/`, Playwright),** set up as in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#end-to-end-tests). Run the matching project when a change touches what it covers, and add a spec when you add a user-facing flow:

- `bun run test:e2e:features`: every feature, one spec per area (`e2e/specs/features/<area>.spec.ts`).
- `bun run test:e2e:restart`: anything a redeploy must survive (realtime, calls, chat sends, uploads, the shutdown path).
- `bun run test:e2e:upgrade`: wire or protocol changes, migrations, anything an old tab talks to.

Rules for specs: set data up through the app's HTTP routes (`e2e/fixtures/api.ts`), never the database, since the app caches memberships in memory; find elements by role and pt-BR label; never `.click().catch(() => {})` on something that may not exist (it waits for the whole action timeout); a step that sends a socket message right after a restart waits for the tab's `welcome` first (`waitForSocketEvent`).

## Code conventions

No Portuguese comments in any source. Comments, identifiers and commit messages are in English; UI strings are translated (pt-BR is the source).

- Comments explain the *why* (a non-obvious decision, an invariant, a workaround), never the *what*. Prefer no comment when the name is clear.
- **Tests are in English too:** `describe`/`it` titles, comments and fixture names. The exception is a literal asserting real UI text (`getByText`, `aria-label`, toast copy), which stays in Portuguese because the suite renders the app in pt-BR (`tests/setup.ts`). To assert another language, wrap the `describe` in `useLanguageForTests('en-US')` (`tests/fixtures/i18nFixture.ts`).

## Commits

Always in English, short, and typed.

- Format: `type: imperative summary`, lowercase, no trailing period, ideally under 60 characters. Add a body only when the *why* is not obvious, a sentence or two.
- Types: `feat`, `fix`, `refactor` (no behaviour change), `perf`, `test`, `docs`, `chore` (tooling, deps, cleanup), `build`, `ci`. Optional scope: `feat(settings): use the full page width`.
- Describe the change, not the process: `fix: revoke pending invite when its card is deleted`, not `fix: some changes to invitations`. No stage or ticket numbers, no filler.
- One logical change per commit.
