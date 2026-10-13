# Quick LLM Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-minded React and Express application for fast, streaming, multi-turn requests to Singularity Compute, with a console UI, command whisperer, local history, and request telemetry.

**Architecture:** A Vite React client talks to a same-origin Express API through shared dependency-neutral TypeScript contracts. Express validates each conversation, keeps `SC_TOKEN` server-only, converts the provider's OpenAI-compatible stream into normalized SSE events, and serves the built client in production. Client transport, conversation state, persistence, presets, and presentation remain separate so later design work can replace the interface without rewriting request behavior.

**Tech Stack:** TypeScript 5, React 19, Vite 7, Express 5, Node 22+, Vitest, React Testing Library, Supertest, ESLint, `tsx`, `tsup`, `dotenv`, and `concurrently`.

**Spec:** `docs/superpowers/specs/2026-10-13-quick-llm-console-design.md`

## Global Constraints

- One root `npm run dev` command starts Vite on port `5173` and Express on port `8787`; Vite proxies `/api` to Express.
- `SC_TOKEN` is read only by the server; the public model is fixed to `asi1-mini` and the upstream URL is `https://llm.a.singularitycompute.com/v1/chat/completions`.
- TypeScript uses strict mode and the aliases `@client/*`, `@server/*`, and `@shared/*` consistently in TypeScript, Vite, Vitest, and the `tsx` server runtime.
- A request contains 1–40 alternating messages, starts and ends with `user`, limits each message to 8,000 characters, and limits combined content to 32,000 characters.
- Upstream requests time out after 60 seconds and abort when the browser disconnects or explicitly stops the request.
- Browser history uses schema version `1`, storage key `quickllm:conversations:v1`, and retains at most 20 conversations.
- Only one request may be active in a browser tab; Enter submits, Shift+Enter inserts a newline, and empty input never submits.
- After an assistant turn fails or is stopped, ordinary follow-up submission is disabled until the user retries that turn or starts a new conversation; partial assistant text is never sent back as conversational context.
- The three v1 commands are `/explain`, `/critique`, and `/transform`; presets are code-defined and not user-editable.
- The dark console UI is responsive at 320px and wider; the inspector hides below 850px and the history rail hides below 620px.
- No authentication, database, file attachments, user-defined presets, model picker, system prompt editor, or direct browser-to-provider request is added.

## Review Focus

- Provider SSE JSON split across arbitrary byte chunks and CRLF boundaries must still produce exact ordered deltas; Task 2 pins this with fragmented-stream tests.
- Aborting the browser request must abort provider work and must not emit a generic failure after the abort; Task 3 pins this with a real HTTP disconnect test.
- Corrupt or quota-failing browser storage must fall back to in-memory state without blocking chat; Task 4 pins both read and write failures.
- Double submission while a response is active must produce one request and one pending assistant turn; Task 5 pins the controller transition.
- A thread over the message, per-message, or total-content limit must show the server's stable validation error without silently truncating history; Tasks 1, 3, and 5 pin all three boundaries.

---

## File Map

- Root configuration: `package.json`, lockfile, `.env.example`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`.
- Shared API boundary: `src/shared/chat-contracts.ts`.
- Server composition: `src/server/config.ts`, `src/server/provider.ts`, `src/server/singularity-provider.ts`, `src/server/sse.ts`, `src/server/app.ts`, `src/server/index.ts`.
- Client domain and I/O: `src/client/chat-domain.ts`, `src/client/conversation-storage.ts`, `src/client/command-presets.ts`, `src/client/chat-transport.ts`, `src/client/health-client.ts`, `src/client/use-chat-controller.ts`.
- Client presentation: `src/client/components/*`, `src/client/App.tsx`, `src/client/main.tsx`, `src/client/styles.css`.
- Tests stay beside the behavior they own as `*.test.ts` or `*.test.tsx`; shared browser test setup lives in `src/client/test-setup.ts`.

### Task 1: Toolchain and shared chat contract

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `src/client/test-setup.ts`
- Create: `src/shared/chat-contracts.ts`
- Test: `src/shared/chat-contracts.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ChatRole`, `ChatMessage`, `ChatRequest`, `Usage`, `ChatStreamEvent`, `ApiErrorResponse`, `HealthResponse`, `CHAT_LIMITS`, and `validateChatRequest(input: unknown): ValidationResult<ChatRequest>`.

- [ ] **Step 1: Add the root toolchain and install dependencies**

Define scripts `dev`, `dev:client`, `dev:server`, `build`, `start`, `test`, `test:watch`, `typecheck`, and `lint`. Configure the three aliases and the Vite `/api` proxy. `build` runs Vite for `dist/client` and `tsup` for the ESM server bundle in `dist/server`; `start` runs that bundle. Install runtime packages `dotenv`, `express`, `react`, and `react-dom`; install the listed test/build/lint tooling as development dependencies.

- [ ] **Step 2: Write failing contract-validation tests**

Test acceptance of a valid multi-turn body and rejection with exact codes for: unknown input, empty array, more than 40 messages, invalid role, non-alternating roles, final assistant role, empty content, content over 8,000 characters, and combined content over 32,000 characters.

- [ ] **Step 3: Run the contract tests to verify RED**

Run: `npm test -- src/shared/chat-contracts.test.ts`
Expected: FAIL because `@shared/chat-contracts` does not exist.

- [ ] **Step 4: Implement the shared contracts and validator**

Use the discriminated union `{ ok: true, value } | { ok: false, error: { code, message } }`. Define stream events as `start`, `delta`, `complete`, and `error`; `start` carries `requestId`, `model`, and `httpStatus: 200`; `complete` carries `finishReason` and optional `usage`; `error` carries `code`, `message`, and `retryable`.

- [ ] **Step 5: Run the contract tests and static checks**

Run: `npm test -- src/shared/chat-contracts.test.ts && npm run typecheck && npm run lint`
Expected: all commands exit `0` with no warnings.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig*.json vite.config.ts vitest.config.ts eslint.config.js index.html src/shared src/client/test-setup.ts
git commit -m "chore: establish typed full-stack toolchain"
```

### Task 2: Singularity provider stream adapter

**Files:**
- Create: `src/server/provider.ts`
- Create: `src/server/singularity-provider.ts`
- Test: `src/server/singularity-provider.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` and `Usage` from Task 1.
- Produces: `ProviderEvent`, `ChatProvider.stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<ProviderEvent>`, `ProviderError`, and `createSingularityProvider(options: { token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ChatProvider`.

- [ ] **Step 1: Write failing provider tests**

Assert the exact upstream URL, bearer header, JSON content type, `asi1-mini`, passed conversation, and `stream: true`. Cover fragmented UTF-8/SSE chunks, CRLF, comments and blank lines, multiple events in one chunk, `[DONE]`, finish reason, optional usage, non-2xx responses, malformed JSON, a 60-second timeout via fake timers, and caller abort.

- [ ] **Step 2: Run the provider tests to verify RED**

Run: `npm test -- src/server/singularity-provider.test.ts`
Expected: FAIL because the provider modules do not exist.

- [ ] **Step 3: Implement the provider interface and adapter**

Parse the upstream body incrementally with `TextDecoder` streaming mode and SSE line buffering. Yield only normalized `delta` and `complete` provider events; throw `ProviderError` with safe codes `upstream_http`, `upstream_stream`, `timeout`, or `aborted`. Never include the token or raw upstream body in errors.

- [ ] **Step 4: Run provider and full tests**

Run: `npm test -- src/server/singularity-provider.test.ts && npm test`
Expected: all tests pass with zero unhandled rejections.

- [ ] **Step 5: Commit**

```bash
git add src/server/provider.ts src/server/singularity-provider.ts src/server/singularity-provider.test.ts
git commit -m "feat: adapt Singularity streaming responses"
```

### Task 3: Express health and streaming chat API

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/sse.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Test: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `validateChatRequest`, shared response/event types, and `ChatProvider` from Tasks 1–2.
- Produces: `ServerConfig`, `readServerConfig(env: NodeJS.ProcessEnv): ServerConfig`, `createApp(options: { config: ServerConfig; provider?: ChatProvider }): Express`, and `startServer(config: ServerConfig): Promise<http.Server>`.

- [ ] **Step 1: Write failing API tests**

Using Supertest and an injected fake provider, assert: health returns `{ status: "ready", model: "asi1-mini" }` or `{ status: "unconfigured", model: "asi1-mini" }`; missing token makes chat return `503`; invalid bodies return `400` with the shared error shape; valid chat sends `start`, ordered `delta`, and `complete` SSE events with correct headers; provider errors become safe SSE `error` events; Express body overflow returns `413`.

- [ ] **Step 2: Add a failing real-disconnect test**

Start `createApp` on an ephemeral port, issue a Node HTTP request, destroy the client socket after the first delta, and assert the fake provider's `AbortSignal` becomes aborted without a subsequent generic error event.

- [ ] **Step 3: Run the API tests to verify RED**

Run: `npm test -- src/server/app.test.ts`
Expected: FAIL because `createApp` and server configuration do not exist.

- [ ] **Step 4: Implement config, SSE serialization, app composition, and startup**

Return JSON errors before opening the stream and normalized SSE afterward. Generate a request ID for `start`, set `text/event-stream`, `no-cache`, and keep-alive headers, abort on response close, and add graceful `SIGINT`/`SIGTERM` shutdown in `index.ts`. Load local environment values with `dotenv/config` only at the executable entry point. Use a 48 KB JSON body ceiling.

- [ ] **Step 5: Run API and full tests**

Run: `npm test -- src/server/app.test.ts && npm test && npm run typecheck`
Expected: all commands exit `0`; disconnect test observes the provider abort.

- [ ] **Step 6: Commit**

```bash
git add src/server/config.ts src/server/sse.ts src/server/app.ts src/server/index.ts src/server/app.test.ts
git commit -m "feat: expose validated streaming chat API"
```

### Task 4: Conversation domain, persistence, and presets

**Files:**
- Create: `src/client/chat-domain.ts`
- Create: `src/client/conversation-storage.ts`
- Create: `src/client/command-presets.ts`
- Test: `src/client/chat-domain.test.ts`
- Test: `src/client/conversation-storage.test.ts`
- Test: `src/client/command-presets.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ChatStreamEvent`, and `ChatRequest` from Task 1.
- Produces: `ConversationMessage`, `Conversation`, `createConversation(id, now)`, `appendUserTurn(conversation, content, id, now)`, `applyStreamEvent(conversation, event, now)`, `prepareRetry(conversation)`, `toChatRequest(conversation)`, `ConversationRepository`, `createConversationRepository(storage?: Storage)`, `COMMAND_PRESETS`, `filterCommandPresets(query)`, and `expandCommandPreset(command)`.

- [ ] **Step 1: Write failing conversation-domain tests**

Cover title derivation from the first user message, multi-turn append, progressive delta concatenation, completion metadata, aborted/error state, retry replacing only the latest failed partial assistant turn, request conversion excluding non-complete assistant placeholders, and preservation of the full thread when server limits are exceeded.

- [ ] **Step 2: Run domain tests to verify RED**

Run: `npm test -- src/client/chat-domain.test.ts`
Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement the conversation domain**

Keep transformations immutable. Conversation messages have stable IDs, `user | assistant` role, content, timestamps, and assistant-only state/metadata. Do not embed browser APIs in this module.

- [ ] **Step 4: Run domain tests to verify GREEN**

Run: `npm test -- src/client/chat-domain.test.ts`
Expected: all domain tests pass.

- [ ] **Step 5: Write failing storage and preset tests**

Assert schema version `1`, newest-first ordering, cap `20`, corrupt JSON fallback, structurally invalid record fallback, unavailable storage fallback, quota/write failure fallback, command prefix filtering, and exact expansions for all three presets with the cursor at the end of the scaffold.

- [ ] **Step 6: Run storage and preset tests to verify RED**

Run: `npm test -- src/client/conversation-storage.test.ts src/client/command-presets.test.ts`
Expected: FAIL because the repository and preset modules do not exist.

- [ ] **Step 7: Implement persistence and command presets**

Use key `quickllm:conversations:v1`; expose repository methods `list`, `save`, and `remove`. Use these exact scaffolds: `Explain this clearly and concisely:\n\n`, `Critique the following and suggest practical improvements:\n\n`, and `Transform the following into the requested format or tone:\n\n`.

- [ ] **Step 8: Run client-domain and full tests**

Run: `npm test -- src/client/chat-domain.test.ts src/client/conversation-storage.test.ts src/client/command-presets.test.ts && npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/client/chat-domain* src/client/conversation-storage* src/client/command-presets*
git commit -m "feat: model local conversations and presets"
```

### Task 5: Browser SSE transport and chat controller

**Files:**
- Create: `src/client/chat-transport.ts`
- Create: `src/client/use-chat-controller.ts`
- Test: `src/client/chat-transport.test.ts`
- Test: `src/client/use-chat-controller.test.tsx`

**Interfaces:**
- Consumes: shared request/events from Task 1 and conversation/repository functions from Task 4.
- Produces: `streamChat(options: { request: ChatRequest; signal: AbortSignal; onEvent(event: ChatStreamEvent): void; fetchImpl?: typeof fetch }): Promise<void>` and `useChatController(options?: { repository?: ConversationRepository; transport?: typeof streamChat; idFactory?: () => string; now?: () => number }): ChatController`.

- [ ] **Step 1: Write failing transport tests**

Cover normalized SSE fragmented across chunks, CRLF, multiple events, malformed event JSON, pre-stream JSON API errors, stream `error` events, network failure, and caller abort without conversion to a generic error.

- [ ] **Step 2: Run transport tests to verify RED**

Run: `npm test -- src/client/chat-transport.test.ts`
Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Implement the browser transport**

POST `{ messages }` to `/api/chat`, decode SSE incrementally, call `onEvent` in order, and throw a typed `ChatTransportError` with `code`, `message`, and `retryable` for non-abort failures.

- [ ] **Step 4: Run transport tests to verify GREEN**

Run: `npm test -- src/client/chat-transport.test.ts`
Expected: all transport tests pass.

- [ ] **Step 5: Write failing controller tests**

Using a deferred fake transport, assert initialization from history, new conversation, multi-turn submit, one active request, double-submit suppression, streamed updates, stop behavior, follow-up suppression after a failed/stopped assistant turn, validation error display without history truncation, retry without duplicated turns, selection of saved history, persistence after meaningful changes, and cleanup abort on unmount.

- [ ] **Step 6: Run controller tests to verify RED**

Run: `npm test -- src/client/use-chat-controller.test.tsx`
Expected: FAIL because the hook does not exist.

- [ ] **Step 7: Implement `useChatController`**

Expose `conversations`, `activeConversation`, `draft`, `requestState`, `error`, `setDraft`, `submit`, `stop`, `retry`, `newConversation`, `selectConversation`, and `deleteConversation`. Batch adjacent delta updates on one animation frame and flush pending text before completion.

- [ ] **Step 8: Run controller and full tests**

Run: `npm test -- src/client/use-chat-controller.test.tsx && npm test && npm run typecheck`
Expected: all tests pass with no React `act` warnings.

- [ ] **Step 9: Commit**

```bash
git add src/client/chat-transport* src/client/use-chat-controller*
git commit -m "feat: coordinate streaming chat sessions"
```

### Task 6: Accessible composer and command whisperer

**Files:**
- Create: `src/client/components/Composer.tsx`
- Create: `src/client/components/CommandWhisperer.tsx`
- Test: `src/client/components/Composer.test.tsx`

**Interfaces:**
- Consumes: preset filtering/expansion from Task 4 and controller draft/request callbacks from Task 5.
- Produces: `ComposerProps` and `CommandWhispererProps`; `Composer` owns only ephemeral whisperer selection state.

- [ ] **Step 1: Write failing interaction tests**

Assert empty submit prevention, Enter submit, Shift+Enter newline, disabled/unconfigured state, send-to-stop button change, `/` opening, query filtering, Arrow Up/Down wrapping, Enter selection, Escape close, pointer selection, exact expanded scaffold, focus retention, and listbox/option ARIA relationships.

- [ ] **Step 2: Run component tests to verify RED**

Run: `npm test -- src/client/components/Composer.test.tsx`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the composer and whisperer**

Use native `textarea` and `button` controls. Open only when the draft begins with `/` and contains no newline; selecting a preset replaces the slash query and restores the caret to the returned cursor position.

- [ ] **Step 4: Run component and accessibility-focused tests**

Run: `npm test -- src/client/components/Composer.test.tsx && npm run typecheck`
Expected: all assertions pass and no React accessibility/runtime warnings appear.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/Composer.tsx src/client/components/CommandWhisperer.tsx src/client/components/Composer.test.tsx
git commit -m "feat: add keyboard-first command whisperer"
```

### Task 7: Responsive console application shell

**Files:**
- Create: `src/client/components/TopBar.tsx`
- Create: `src/client/components/HistoryRail.tsx`
- Create: `src/client/components/MessageList.tsx`
- Create: `src/client/components/RequestInspector.tsx`
- Create: `src/client/health-client.ts`
- Create: `src/client/App.tsx`
- Create: `src/client/main.tsx`
- Create: `src/client/styles.css`
- Test: `src/client/App.test.tsx`
- Modify: `src/server/app.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `useChatController` from Task 5 and `Composer` from Task 6.
- Produces: `fetchHealth(fetchImpl?: typeof fetch): Promise<HealthResponse>`, the complete browser application, and Express static hosting for `dist/client` with SPA fallback outside `/api`.

- [ ] **Step 1: Write failing application tests**

Assert `fetchHealth` parses ready/unconfigured responses and rejects malformed responses; unconfigured health disables submission with setup copy; ready health renders the empty state; a multi-turn thread renders ordered user/assistant messages and metadata; history selection restores a thread; new request clears the active thread; retry and stop actions call the controller; inspector reports endpoint `/api/chat`, `POST`, stream state, message count, model, elapsed time, usage when available, and HTTP outcome.

- [ ] **Step 2: Run application tests to verify RED**

Run: `npm test -- src/client/App.test.tsx`
Expected: FAIL because the app shell does not exist.

- [ ] **Step 3: Implement the semantic application shell**

Match the approved three-column console direction with a compact top bar, history/preset rail, central chat, and inspector. Use semantic landmarks, an `aria-live="polite"` response region, visible focus, and non-color status labels. Do not copy `.superpowers` mockup code verbatim; implement maintainable React components.

- [ ] **Step 4: Implement responsive styling and production static serving**

Use CSS custom properties, mobile-first safeguards, the exact 850px/620px visibility breakpoints, reduced-motion support, and readable 320px layout. Configure client output as `dist/client`; Express serves those assets and returns `index.html` for non-API navigation only.

- [ ] **Step 5: Run UI tests and production build**

Run: `npm test -- src/client/App.test.tsx && npm run build && npm run typecheck && npm run lint`
Expected: tests pass; `dist/client/index.html` and server output exist; all commands exit `0` without warnings.

- [ ] **Step 6: Commit**

```bash
git add src/client/components src/client/health-client.ts src/client/App.tsx src/client/App.test.tsx src/client/main.tsx src/client/styles.css src/server/app.ts vite.config.ts
git commit -m "feat: build responsive console chat interface"
```

### Task 8: Operational documentation and end-to-end verification

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`
- Verify: all project files

**Interfaces:**
- Consumes: the complete application from Tasks 1–7.
- Produces: documented setup, design-history links, ignored local design/runtime files, and a verified local development/production workflow.

- [ ] **Step 1: Add environment and repository hygiene**

Set `.env.example` to `SC_TOKEN=replace_with_your_token` and optional `PORT=8787`. Ignore `.superpowers/` while retaining the committed design and plan under `docs/superpowers/`.

- [ ] **Step 2: Replace the README with operator and design documentation**

Document Node 22+, install, token setup, single `npm run dev` command, development URLs, tests, lint, typecheck, build/start, architecture boundaries, API/SSE contract, limits, security notes, and links to the design specification and this plan. Add a “Future Claude Design work” section naming the shell, rail, message list, composer/whisperer, and inspector as redesign surfaces.

- [ ] **Step 3: Run the complete automated verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: every command exits `0`, all test files pass, and no warnings are emitted.

- [ ] **Step 4: Smoke-test the single development command without a token**

Run: `npm run dev`
Expected: Vite reports `http://localhost:5173`, Express reports port `8787`, `GET /api/health` through Vite returns `{"status":"unconfigured","model":"asi1-mini"}`, and the UI loads with submission disabled and setup guidance.

- [ ] **Step 5: Smoke-test the production server**

Run: `npm run start`
Expected: Express serves the built application, `GET /api/health` returns the same safe health shape, and a direct non-API route returns the SPA shell.

- [ ] **Step 6: Inspect repository state and commit**

Run: `git status --short && git diff --check`
Expected: only intended documentation/hygiene changes remain and `git diff --check` prints nothing.

```bash
git add .env.example .gitignore README.md docs/superpowers/plans/2026-10-13-quick-llm-console.md
git commit -m "docs: document quick LLM console workflow"
```
