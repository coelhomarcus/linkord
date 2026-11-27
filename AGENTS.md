# AGENTS.md

Overcord has a React web app in `web/`, a separate React administration site in `admin/`, a Bun API in `server/` and an Electron client in `desktop/`. Each frontend owns its components, styles and translations and builds independently. See [README.md](README.md) for the product and [DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup and commands.

## Workflow and organization

- Work and commit on `develop`. Promote to `main` through a pull request from `develop`.
- Group code by feature in `web/src/features/<domain>/` and `server/src/modules/<domain>/`. Keep feature-specific hooks, components and handlers with their owner. Put tests in the package's `tests/` directory, mirroring `src/`.
- Write identifiers, comments, test titles, commit messages and docs in English. Comments explain decisions. UI strings are translated, and tests can quote the actual localized UI.
- Make one logical change per commit. Use a lowercase, imperative subject such as `fix: revoke deleted invitations`. Use `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build` or `ci`, with an optional scope. Aim for under 60 characters, omit the final period and explain non-obvious motivation in the body.

## Frontend

### Code and state

- `app/` is the composition root. Code outside it never imports from it. Reserve `shared/` for infrastructure and code used by several features with no natural owner. Reserve `state/hooks/` for cross-cutting room hooks. Use relative imports within a directory and `@/` or `@tests/` when an import would use `../`.
- Subscribe to the room fields you need with `useRoom` or `useRoomState`. Use `useRoomSelector` for derived values and `useOptionalRoomSelector` for components that also render outside the provider. Only call UI reads `participants` directly. Use [`useCallRoster()`](web/src/features/calls/callRoster.ts) for membership without media updates. Keep provider values and callbacks stable until they change. Replace the room fixture value when updating it in a test.
- Use [`createResourceCache` and `useResource`](web/src/shared/lib/resourceCache.ts) for server data shown on multiple surfaces. Show cached data while refreshing, and use skeletons for data that has never loaded. Apply user edits optimistically and roll them back on failure. Clear shared caches on sign-out and seed known profile previews with `rememberProfilePreview`.

### React Compiler

- Read reactive values during render. Use `useLanguage()`, `useTimeFormat()` and a subscription such as `useSyncExternalStore` for mutable caches. Avoid reading module caches, storage or the clock directly during render.
- Let the compiler memoize components and hooks. Preserve manual memoization where identity is a contract, such as `RoomProvider` outputs, and in virtual lists using `useVirtualizer`.
- Run `REACT_COMPILER_LOG=1 bun run build:web` when changing hot paths such as chat and call tiles.

### Interaction and feedback

- Reuse [`useLongPress`](web/src/shared/hooks/useLongPress.ts) and register touch context menus in [`GlobalContextMenu`](web/src/app/layout/GlobalContextMenu.tsx) through `PRESSABLE` and, for delegated menus, `DELEGATED_MENU`. Keep native behavior on nested controls except the row control itself. Keep keyboard and screen reader alternatives for gesture actions.
- Use `useHorizontalSwipe` on touch-first devices. Keep selection and callout rules centralized in the global styles. For a row that supports both drag and long press, expose move in the touch menu and disable touch drag. Use the shared slider primitive and give it an `aria-label`.
- Use shared popup and modal primitives and the [motion tokens](web/src/shared/lib/ease.ts). Custom movement must respect reduced motion. Exiting elements stop taking input immediately. Use CSS exits and `useExitPresence` where Base UI does not manage presence.
- Use `text-red-text` for error text and destructive text labels, `text-red` for icons and fills, and `text-green` for success. Use `ErrorBanner` for boxed errors and the `danger-outline` or `destructive` variant for destructive buttons.
- Use `useCopyToClipboard` with `CopyStatusIcon` and `CopyLabel` for buttons, or `copyToClipboard` for a menu item that closes. Both use the shared live region. Use `FloatingBar` as the sole confirmation for forms with an explicit Save action.

### Internationalization

- Use one namespace per feature in `features/<domain>/locales/` and the `common` namespace for shared strings. Use descriptive nested keys. Brazilian Portuguese is the source for names and types. Register new namespaces in the frontend's `i18next.d.ts` and keep locale keys and variables in parity.
- Translate when the text is produced. Use `useTranslation` in components, and pass the active language to plain helpers called during render. Keep translation keys in catalogs and use the active locale for dates and numbers. Preserve proper names.
- When adding a language, update the [web](web/src/shared/i18n/languages.ts), [admin](admin/src/i18n/languages.ts) and [server](server/src/modules/users/locale.ts) language lists and every namespace.

## Backend

- Use relative imports with explicit `.js` extensions in `server/` and `desktop/`. Break import cycles by extracting a shared dependency into a leaf module. Split a domain module when callers need distinct parts independently.
- Centralize environment variables in [`config/env.ts`](server/src/config/env.ts). Route requests to URLs chosen by users or external responses through [`safeRequest`](server/src/net/safeRequest.ts).
- Check channel access through [`getConversationForUser(id, userId, permission)`](server/src/modules/conversations/conversationsRepository.ts) with the permission the action needs. Keep server and web permission bits in sync.

## Desktop

- Scope new desktop features and testing to Windows. Keep macOS development startup and web compatibility with older macOS and Linux clients.
- Load the web app from the server's origin. Keep sandboxing, context isolation and disabled Node integration on every window. Scope allowed permissions to the app origin.
- Put decisions in plain, tested modules. Use Electron-facing modules to wire them to events.
- Keep each preload as one CommonJS file. Expose only named IPC operations on `window.overcordDesktop`. Update [the web bridge types](web/src/shared/desktop.ts) with the preload and support clients missing newly added fields.

## Realtime compatibility and deploys

- Keep wire changes additive while older clients are connected. Bump [`PROTOCOL_VERSION`](server/src/realtime/protocolVersion.ts) in both projects for significant wire changes and update its history. Raise `MIN_PROTOCOL_VERSION` only when an older client would misbehave or corrupt state, and explain the reason in the commit body.
- Change call membership through `setCallConversationId` and DM calls through the state machine and `apply`. Preserve the one-call-per-account rule and the confirmed replacement flow across tabs and devices.
- During shutdown, broadcast `server-restart` and close transports with `io.close()`. Avoid participant removal and explicit socket disconnects. Restore the same participant ID and resume token, and let restored participants reconnect even if another tab joins first.
- For new call state, decide what to persist and what the client can report again. Keep essential one-shot actions recoverable after reconnect. Preserve chat deduplication and resumable uploads. [Restart behavior and verification](docs/DEVELOPMENT.md#restarting-the-server-during-a-call)

## Documentation and verification

- Update the affected docs in the same commit. Edit the existing section and link to it from other docs. Use [README.md](README.md) for product behavior, [DEVELOPMENT.md](docs/DEVELOPMENT.md) for development and tests, [DEPLOY.md](docs/DEPLOY.md) for operations, [INTEGRATIONS.md](docs/INTEGRATIONS.md) for external services and [WEBHOOK.md](docs/WEBHOOK.md) for webhooks. Update the relevant env example when a variable changes. Keep secrets out of docs and add new docs to the `.gitignore` allowlist.
- Check existing scripts before writing a one-off. A new `server/src/scripts/` command needs a usage comment, a package script and an entry in the [script table](docs/DEVELOPMENT.md#scripts).
- Use `bun run check` for server and web checks. For desktop changes, also run its typecheck and tests. See [Run the checks](docs/DEVELOPMENT.md#run-the-checks).
- Verify changes to real flows such as uploads, calls, conversations and auth locally with two accounts. Run the matching [E2E project](docs/DEVELOPMENT.md#end-to-end-tests) for affected behavior, including `restart` for restart guarantees and `upgrade` for compatibility, and add a spec for new user-facing flows.
- Set up E2E data through the app's HTTP routes. Find controls by role and pt-BR label. Check whether optional controls exist before clicking and wait for `welcome` before sending a socket action after a restart.
