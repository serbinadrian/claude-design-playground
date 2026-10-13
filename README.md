# Quick LLM Console

A polished, console-like chat for quick multi-turn requests to Singularity Compute. It is also a reference repository for a complete Claude Design workflow: the committed [design specification](docs/superpowers/specs/2026-10-13-quick-llm-console-design.md) captures the approved direction, while the [implementation plan](docs/superpowers/plans/2026-10-13-quick-llm-console.md) records how that direction became a tested application.

The browser never receives the provider token. React sends a typed conversation to the colocated Express API, which validates it, calls `asi1-mini`, and returns normalized Server-Sent Events.

## Start locally

Prerequisites: Node.js 22 or newer and an `SC_TOKEN` for Singularity Compute.

```powershell
npm install
Copy-Item .env.example .env
```

Replace the placeholder in `.env`, then start the frontend and backend together:

```powershell
npm run dev
```

- App: `http://localhost:5173`
- API: `http://localhost:8787`
- Health: `http://localhost:5173/api/health` through the Vite proxy

If no token is configured, both processes still start. The health endpoint reports `unconfigured`, and the UI explains why sending is disabled. Vite uses a strict port so an unrelated app cannot silently take the documented URL.

## Commands

```text
npm run dev          Start Vite and Express in watch mode
npm test             Run the complete Vitest suite
npm run test:watch   Run Vitest interactively
npm run typecheck    Check both TypeScript projects
npm run lint         Run ESLint with zero warnings allowed
npm run build        Build dist/client and dist/server
npm start            Serve the production bundle from Express
```

`npm start` expects a prior `npm run build`. Set `PORT` to override the production server's default `8787` port.

## Product behavior

- Streams model output into a persistent multi-turn thread.
- Stops an active browser request and the matching upstream request together.
- Saves up to 20 validated conversations in browser-local storage and degrades to memory if storage is unavailable.
- Opens a keyboard-accessible command whisperer when a draft begins with `/`; `/explain`, `/critique`, and `/transform` insert typed prompt scaffolds.
- Shows endpoint, method, stream state, model, elapsed time, finish reason, token usage when available, HTTP outcome, and a bounded payload preview.
- Collapses the inspector below `850px` and the history rail below `620px`, while keeping the chat usable at `320px`.

## Architecture

```text
React UI
  └─ useChatController
       ├─ conversation domain + local repository
       └─ browser SSE transport
            └─ POST /api/chat
                 ├─ shared request validation
                 └─ Singularity provider adapter
                      └─ https://llm.a.singularitycompute.com/v1/chat/completions
```

- `src/shared` owns dependency-neutral request, response, validation, and event types.
- `src/server` owns configuration, Express composition, safe SSE output, and the provider adapter.
- `src/client` owns the conversation domain, local persistence, transport, controller, and presentation.
- Import aliases `@shared`, `@server`, and `@client` are aligned across TypeScript, Vite, Vitest, tsx, and tsup.

### Browser API

`GET /api/health` returns one of:

```json
{ "status": "ready", "model": "asi1-mini" }
```

```json
{ "status": "unconfigured", "model": "asi1-mini" }
```

`POST /api/chat` accepts only alternating `user` and `assistant` messages ending in a user turn:

```json
{
  "messages": [
    { "role": "user", "content": "What is fish?" },
    { "role": "assistant", "content": "A fish is an aquatic vertebrate." },
    { "role": "user", "content": "How do they breathe?" }
  ]
}
```

A successful response is `text/event-stream`. Each `data:` value is one normalized JSON event:

- `start`: request id, public model, and HTTP status.
- `delta`: an ordered text fragment.
- `complete`: finish reason and optional token usage.
- `error`: a safe code, user-facing message, and retryability flag.

Pre-stream failures use `{ "error": { "code": "...", "message": "..." } }` with the appropriate HTTP status.

### Limits and security

- Maximum 40 messages per request.
- Maximum 8,000 characters per message and 32,000 characters across the conversation.
- Express JSON bodies are limited to 48 KB; upstream requests time out after 60 seconds.
- `SC_TOKEN` is read only by the server and is never returned, bundled, placed in Vite variables, or written to browser storage.
- Provider bodies and authorization headers are not included in client errors.
- The client keeps the visible thread intact when validation fails; it never silently discards older context.

## Future Claude Design work

The UI is intentionally decomposed into redesignable surfaces under `src/client/components`:

- `TopBar.tsx` — product identity, workspace context, and API readiness.
- `HistoryRail.tsx` — new request, local history, and preset shortcuts.
- `MessageList.tsx` — empty, streaming, complete, stopped, and failed turns.
- `Composer.tsx` and `CommandWhisperer.tsx` — prompt entry and command discovery.
- `RequestInspector.tsx` — transport, context, usage, and payload summary.
- `styles.css` — the restrained dark-console visual system and responsive breakpoints.

Behavior lives outside those components in `use-chat-controller.ts`, `chat-transport.ts`, and the domain modules. A design agent can therefore reshape the shell without rewriting request orchestration. Start with the [design specification](docs/superpowers/specs/2026-10-13-quick-llm-console-design.md), review the committed development history, then iterate on one surface at a time so shared spacing, typography, state language, and accessibility stay coherent.
