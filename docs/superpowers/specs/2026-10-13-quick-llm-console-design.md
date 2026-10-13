# Quick LLM Console — Design Specification

## Intent

Build a full-stack TypeScript reference application for making quick LLM requests through Singularity Compute. The project is both a useful tool and a durable example of a Claude Design workflow: the repository should preserve the reasoning behind the interface, expose clear surfaces for later redesign work, and remain easy for another developer or design agent to understand and extend.

The approved product direction is a polished console-like chat. It should feel fast and technical without becoming a raw API tester. A user can type a question, see a streamed response, recall earlier requests, and inspect useful runtime details without leaving the main screen.

## Goals

- Start the React frontend and Express backend together with one development command.
- Keep `SC_TOKEN` exclusively on the server and proxy requests through a small, typed API boundary.
- Stream responses from the OpenAI-compatible upstream endpoint so the interface feels immediate.
- Provide a console-inspired chat interface based on the approved visual mockup.
- Add a command whisperer that opens when the prompt begins with `/` and helps insert code-defined prompt presets.
- Support multiple user/assistant turns per conversation and preserve lightweight conversation history in the browser without requiring accounts or a database.
- Show useful request telemetry: model, response state, elapsed time, token usage when supplied, HTTP outcome, and request payload summary.
- Demonstrate production-minded naming, decomposition, validation, accessibility, testing, error handling, performance, and documentation.
- Leave clear, separable UI surfaces for a future Claude Design redesign pass.

## Non-goals

- Authentication, multi-user collaboration, cloud-synced history, or a database.
- User-created or editable presets in the first version.
- Model selection beyond the configured `asi1-mini` model.
- File or image attachments, tool calls, system-prompt editing, or Markdown export.
- Exposing the upstream token or allowing the browser to call Singularity Compute directly.
- Reproducing a full developer observability platform.

## Approved Experience

### Application shell

The desktop layout has three columns beneath a compact top bar:

1. A left rail for a new-request action, recent browser-local conversations, and the available command presets.
2. The central chat workspace with the current request, streamed model response, response metadata, and a persistent composer.
3. A request inspector with endpoint, method, stream state, context/token information when available, and a readable payload summary.

The top bar contains the product name, workspace context, and backend/API readiness. The inspector disappears at narrower widths, followed by the left rail on phone-sized screens. The chat remains fully usable at every supported width.

The visual language is a restrained dark console: monospaced interface labels, highly readable sans-serif response copy, subtle grid texture, thin separators, and a single lime accent. The application should avoid ornamental dashboards, excessive cards, and decorative animation.

### Request flow

On first load, the user sees an empty conversation and a focused composer. Submitting a non-empty prompt immediately adds the user message, creates a pending assistant response, and begins reading the server stream. The response appears progressively. After completion, the composer remains available so the user can continue the same conversation with additional turns. Each request sends the validated user/assistant history needed for conversational context. The send action becomes a stop action while a request is running; stopping aborts both the browser request and the upstream request.

Only one request may run per browser tab at a time. The user can start a new conversation after cancelling or completing the current request, while ordinary submission appends a new turn to the active conversation. Enter submits, while Shift+Enter inserts a newline. Empty or whitespace-only prompts are rejected locally. A conversation title is derived from its first user message and may be truncated for the history rail.

The completed response displays elapsed time, upstream finish reason, token usage when the provider reports it, and success state. The current conversation is saved to browser storage after meaningful changes. Selecting history restores it without a server round trip.

### Command whisperer

Typing `/` at the beginning of an otherwise empty prompt opens the command whisperer above the composer. It filters as the user continues typing, supports Arrow Up/Down, Enter, Escape, pointer selection, and appropriate ARIA listbox semantics. Choosing a preset replaces the slash query with the preset's prompt scaffold and places the cursor where the user can continue typing.

Version one ships with three code-defined presets:

- `/explain` — break down a topic clearly and concisely.
- `/critique` — review an idea and surface practical improvements.
- `/transform` — rewrite input into a requested format or tone.

Presets live in a typed frontend module so a later design pass can change presentation or add management without coupling them to chat transport.

### Error and empty states

- If `SC_TOKEN` is missing, the health endpoint reports an unconfigured state and the UI disables submission with a concise setup message.
- Network, timeout, upstream HTTP, malformed-stream, and client-abort outcomes are distinct. User-facing messages remain short; diagnostic detail is logged server-side without secrets.
- A partially streamed response remains visible if the stream fails. Retrying replaces that failed partial assistant turn and resubmits the conversation through its latest user message, without duplicating earlier turns.
- If browser storage is unavailable or corrupt, the app continues with in-memory history and does not fail startup.
- History begins with a useful empty state and is capped to prevent unbounded browser storage growth.

## Technical Design

### Stack and repository shape

- TypeScript throughout, with strict compiler settings.
- React and Vite for the client.
- Node and Express for the server.
- A root package with one `npm run dev` command that runs Vite and the Express development server concurrently.
- Import aliases for client, server, and shared modules, configured consistently across TypeScript, Vite, Vitest, and the server runtime.
- Shared request, event, and error contracts in a dependency-neutral module.

The builder may choose the exact source directory names and supporting libraries as long as the boundaries above remain clear and the root developer workflow stays simple.

### Browser-to-server API

`GET /api/health` returns whether the backend is ready and the configured public model name. It never returns token material.

`POST /api/chat` accepts a validated JSON body containing a non-empty `messages` array. Each entry must use the `user` or `assistant` role and contain non-empty string content; the final entry must be a user message. The server constructs the upstream payload from only those validated fields rather than forwarding arbitrary client JSON:

```json
{
  "model": "asi1-mini",
  "messages": [
    { "role": "user", "content": "What is fish?" },
    { "role": "assistant", "content": "A fish is an aquatic vertebrate..." },
    { "role": "user", "content": "How do they breathe?" }
  ],
  "stream": true
}
```

The server calls `https://llm.a.singularitycompute.com/v1/chat/completions` with `Authorization: Bearer <SC_TOKEN>` and `Content-Type: application/json`. It exposes a normalized Server-Sent Events stream to the browser rather than leaking the provider's wire format. Event types cover response start, text delta, completion metadata, and a safe error payload. The route stops upstream work when the client disconnects and applies a bounded timeout.

Per-message length, message count, and total serialized conversation size are limited to sensible quick-request ceilings chosen by the builder and documented in API validation messages. Express JSON parsing has a matching body limit. Error responses use a stable typed shape and appropriate HTTP status codes. The client keeps the full local thread but clearly reports when it exceeds the server's accepted context rather than silently dropping earlier messages.

### State and persistence

React owns the current multi-turn conversation and transport state. Transport logic lives outside presentation components and exposes a small request/abort interface. Browser persistence is wrapped behind a storage adapter that validates stored data, applies a schema version, and caps the number of conversations. No server-side conversation state is required; each request carries the current validated conversation context.

Derived values such as filtered presets, request duration display, and inspector rows should not be duplicated in state. Render-frequency-sensitive streaming updates should be batched or otherwise implemented so long responses do not cause avoidable whole-app work.

### Security and operations

- Read `SC_TOKEN` from the server process environment and include a redacted `.env.example`.
- Never log authorization headers, environment values, or full upstream response bodies.
- Validate client input at the route boundary.
- Use same-origin requests in development through Vite proxying and serve the built client from Express for production-like execution.
- Include graceful server shutdown and upstream abort handling.
- Keep dependencies focused and justify any package that replaces a small platform capability.

## Quality Strategy

Behavior is developed test-first. Unit tests cover validation, provider-stream normalization, storage recovery/capping, preset filtering and insertion, and request-state transitions. Server integration tests exercise health states, request validation, successful streaming, upstream errors, timeouts, and disconnect cancellation with an injected provider dependency. Component tests cover the composer, keyboard behavior, streaming display, error/retry state, history restoration, and responsive-critical controls. A production build and lint/type checks form the final verification gate.

The README documents prerequisites, `SC_TOKEN` setup, the single development command, test/build commands, architecture, API contract, and where a future design agent should begin. It also links the design and implementation-plan documents so the repository history remains understandable.

## Design and Engineering Calls

These are implementation calls made from the approved direction:

- Streaming is included because the approved inspector shows stream mode and immediate feedback supports the “quick request” goal.
- Presets are fixed in code for v1 because editable presets would introduce a management flow not required by the core demonstration.
- Browser-local persistence provides believable multi-turn history without adding a database or identity system.
- The server emits normalized SSE events so frontend code is insulated from provider-specific chunk details.
- Production mode uses Express to serve the built client, while development uses Vite with a same-origin proxy.
- The visual mockups under `.superpowers/` are design-session material, not production source.

## Success Criteria

A new contributor can clone the repository, add `SC_TOKEN`, install dependencies, and start both frontend and backend with one documented command. They can exchange multiple messages in one conversation, see streamed responses, stop an in-flight request, invoke a preset from the command whisperer, revisit recent local conversations, and inspect request metadata. Missing configuration and provider failures are understandable and safe. Automated checks cover the core behaviors, the production build succeeds, and the repository documentation makes both the implementation and the design evolution easy to follow.
