# Grok Chat

A chat app for the xAI API. Each user pastes their own xAI key, which stays in their browser, or you add a database and a key of your own and let people sign up (see Accounts). Replies stream from `grok-4.7` through the Responses API.

- Streaming chat with markdown, code blocks with copy, and a conversation list.
- Documents go to the xAI Files API (24 hour expiry, 50 MB each); images go to the model as `input_image`.
- Files the model writes in `:::file` blocks become Download buttons, with a zip for two or more.
- **Search**: xAI's own `web_search` and `x_search` tools, an optional code interpreter, and a Sources row.
- **Agent**: one E2B Linux sandbox per conversation. The model runs commands, edits files, opens pages and hands files back for download. Attached files can be up to 1 GB each.
- Conversations stay in the browser: localStorage for chats, IndexedDB for images, screenshots and delivered files.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, click **Add API key**, and paste a key from [console.x.ai](https://console.x.ai). No environment variables are required.

For production on your own machine or a VPS:

```bash
npm run build
npm start
```

Edit `src/lib/system-prompt.ts` if you want a custom system prompt.

## Get the keys

- **xAI**: sign in at [console.x.ai](https://console.x.ai), open API Keys, create a key. It starts with `xai-`.
- **E2B** (Agent mode only): sign in at [e2b.dev](https://e2b.dev), open the dashboard, copy your API key into Settings.

Both keys are saved in the browser's localStorage (`xai_api_key`, `e2b_api_key`) and sent with each request to this app's server, which uses them for that request only. The server does not store or log them.

## Why there is a server route

The browser never calls `api.x.ai` directly. `POST /api/chat` is a thin proxy that:

- keeps the key out of cross-origin browser requests to xAI,
- uploads documents to the Files API (or reads their text when the endpoint has none), and large files into the sandbox in chunks (`POST /api/upload`),
- runs the Agent tool loop next to the E2B SDK.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Model | `grok-4.7` | Also `grok-4.6`, `grok-4.5`, or any custom model id. |
| Web search, X search | on | Which xAI search tools Search uses. X search takes an optional date range. |
| Code interpreter | off | xAI's hosted Python (`code_interpreter`). |
| Temperature | 0.8 Ask, 0.4 Agent | Sent as `temperature`. |
| Top p | 0.95 | Sent as `top_p`. |
| Extra instructions | empty | Appended to the API `instructions` field for each request. This is not the system prompt file. If xAI rejects `instructions`, the same text goes in as a second system message. |
| Structured final answer | on | Registers a `submit_result` tool. When the model calls it, the UI shows `arguments.text` as the answer (preferred over streamed text when longer). |
| Network retry | on | Retries the same request up to twice (400 ms, then 1200 ms) on 429, 500, 502, 503, 504, a stream that produced nothing, or a stalled stream. It never retries after text has been shown, and never after Stop. |

Search and Agent are switched per conversation from the composer.

## Search

Search uses tools that xAI runs on its side (`web_search`, `x_search`, and `code_interpreter` when enabled), so there are no extra search keys. The model decides when to search, open pages, or look up X posts, users and threads. Each tool call shows as a card in the reply.

- It is on by default because the model has no live knowledge without it.
- Tool calls are billed on top of tokens. Web search and the code interpreter are billed per call; X search is billed by posts and profiles fetched. Check current prices at [docs.x.ai/developers/pricing](https://docs.x.ai/developers/pricing).
- Sources come from `response.citations`, `url_citation` annotations and inline `[[1]](url)` links, deduplicated into chips under the reply.
- The code interpreter (xAI's hosted Python) and Agent (a full Linux VM on E2B) are different products. Both can be on.

## Agent mode

Turn on **Agent** in the composer. The first message starts an E2B sandbox for the conversation:

| Path | Use |
| --- | --- |
| `/home/user/uploaded` | Files you attach land here. Images also go to the model directly. |
| `/home/user/work` | Default working directory. |
| `/home/user/out` | Deliverables; the model calls `get_sandbox_files` to send them to you. |

Tools: `run_terminal_cmd` (shell, 60 s default, 300 s max), `file` (read, write, edit, list, delete, mkdir), `browser_open` (headless page text and screenshot), `get_sandbox_files` (download into the chat; folders are zipped, 25 MB per file).

**Billing.** E2B bills compute per second while a sandbox runs. The app pauses the sandbox after every turn, which keeps files and memory, and resumes it on the next message. New sandboxes are also set to pause, not die, when their 30 minute timeout runs out, so a crashed request does not lose files. **Destroy sandbox** in the header, or deleting the conversation, kills it. xAI usage stays on the user's own xAI key.

**Limits per message.** 30 tool rounds, 40 tool steps in total (search plus sandbox), and 8 minutes. Tool output sent back to the model is capped at about 80k characters; the UI shows up to 20k per tool card.

**Use a long-running Node server for real agent work.** On Vercel a function stops at `maxDuration` (300 s here), so the app wraps up at about 280 s, and request bodies are capped at 4.5 MB (Agent uploads still work there, in smaller chunks; Ask documents max out at about 4.5 MB). Run `npm run build && npm start` on a VPS or any Node host for long jobs and large uploads. (To keep serverless hosting, the loop in `src/lib/agent/loop.ts` could move into a background job runner such as Trigger.dev, streaming progress back. That is not included.)

**Server fallback key.** If `E2B_API_KEY` is set on the server, Agent works for users who did not add their own key. On a public deployment that means anyone who opens the site can start sandboxes on your E2B account, so leave it unset there.

### Custom sandbox template (optional)

On the default template, `browser_open` fetches pages without JavaScript and without screenshots. To get a real headless browser, build the template in `e2b/`:

```bash
E2B_API_KEY=your_key node e2b/build-template.mjs grok-chat-agent
```

Or with the CLI, from inside `e2b/` (it picks up `e2b.Dockerfile`):

```bash
npm i -g @e2b/cli
e2b template build --name grok-chat-agent
```

Then set `E2B_TEMPLATE=grok-chat-agent` on the server; new sandboxes are created with `Sandbox.create({ template })`.

TODO: a live desktop view with `@e2b/desktop` (not in v1; headless screenshots only).

## File size limits

| What | Limit |
| --- | --- |
| Documents in Ask mode | 50 MB each, the xAI Files API limit. About 4.5 MB on Vercel, which caps request bodies. On a gateway without a Files API, up to 200,000 characters of text per document. |
| Files in Agent mode | 1 GB each. The browser sends them into the sandbox in 16 MB chunks (4 MB on Vercel), three at a time, so the server holds one chunk in memory at most. They land in `/home/user/uploaded`. |
| Images | Resized in the browser to at most 2048 px on the long side and sent with the message. |
| Files the agent sends back | 25 MB each (`get_sandbox_files`). |
| Attachments per message | 10. |

Documents upload before the message is sent, with progress shown in the reply. A document over the Ask limit is refused before uploading, with a hint to turn on Agent. Stopping a message during an Agent upload deletes the partial file and pauses the sandbox again. Uploaded files use the sandbox's disk space until you delete them or destroy the sandbox.

To change the limits, edit `MAX_XAI_FILE_BYTES` and `MAX_SANDBOX_FILE_BYTES` in `src/lib/types.ts` and the chunk sizes in `src/lib/upload-limits.ts`. The 50 MB Ask limit comes from xAI, so raising it there has no effect.

## API

`POST /api/chat`, multipart form data. Replies stream as server-sent events.

```bash
curl -N http://localhost:3000/api/chat \
  -F apiKey=$XAI_API_KEY \
  -F conversationId=demo-1 \
  -F 'messages=[{"role":"user","content":"hello"}]'
```

With a document:

```bash
curl -N http://localhost:3000/api/chat \
  -F apiKey=$XAI_API_KEY \
  -F 'messages=[{"role":"user","content":"summarize this"}]' \
  -F files=@report.pdf
```

In Agent mode:

```bash
curl -N http://localhost:3000/api/chat \
  -F apiKey=$XAI_API_KEY -F agent=1 -F e2bKey=$E2B_API_KEY \
  -F 'messages=[{"role":"user","content":"run echo sandbox-ok"}]'
```

| Field | Notes |
| --- | --- |
| `apiKey` | Required. |
| `messages` | Required. JSON `[{ role, content, fileIds?, images? }]`, ending with the user turn. |
| `files`, `fileKeys` | Attachments for the last turn; `fileKeys` are echoed back in the `uploads` event. The UI only sends images here and uploads documents through `/api/upload` first. Request bodies over 64 MB are refused. |
| `sandboxFiles` | Agent mode: JSON `[{ path, bytes }]` for files already uploaded to `/home/user/uploaded` with `/api/upload`. |
| `conversationId` | Used as `prompt_cache_key` and the `x-grok-conv-id` header. |
| `previousResponseId`, `promptVersion`, `openCallIds` | Continue a stored response chain. |
| `model` | Defaults to `grok-4.7`. |
| `search`, `web`, `x`, `code`, `xFrom`, `xTo` | Search tools; `search=0` turns them off (on when omitted). |
| `temperature`, `topP`, `extraInstructions`, `submitResult`, `networkRetry` | Request settings. |
| `agent`, `e2bKey`, `sandboxId` | Agent mode. |

Events: `status`, `uploads`, `delta`, `replace`, `retrying`, `tool_call`, `tool_start`, `tool_stdout`, `tool_end`, `file`, `screenshot`, `search_start`, `search_end`, `citations`, `sources`, `sandbox`, `warning`, `done`, `error`. Their shapes are in `StreamEvent` in `src/lib/types.ts`.

### Uploads

`POST /api/upload` takes one file per request, with keys in headers (`x-xai-key`, `x-e2b-key`), never in the URL.

For Ask mode, send a document to the xAI Files API and put the returned id in `fileIds` of the last message:

```bash
curl "http://localhost:3000/api/upload?target=xai" \
  -H "x-xai-key: $XAI_API_KEY" -H "x-file-name: report.pdf" \
  --data-binary @report.pdf
```

It returns `{ "fileId": "file_…", "bytes": … }`, or 413 over 50 MB. When the endpoint has no Files API it returns `{ "text": "…", "bytes": … }` instead: put that text in the message.

For Agent mode, upload into the sandbox in chunks (`x-e2b-key` header on every step, or the server's `E2B_API_KEY`):

| Step | Body | Returns |
| --- | --- | --- |
| `?target=sandbox&step=begin` | JSON `{ conversationId, sandboxId? }` | `{ sandboxId, replaced }`; starts or resumes the sandbox |
| `?target=sandbox&step=chunk&sandboxId=…&uploadId=…&index=…&chunkBytes=…` | Raw bytes of chunk `index` | `{ ok }` |
| `?target=sandbox&step=complete` | JSON `{ sandboxId, uploadId, name, size }` | `{ path, bytes }` |
| `?target=sandbox&step=cancel` | JSON `{ sandboxId, uploadId }` | `{ ok }`; deletes a partial upload |

`uploadId` is any id you pick (letters, digits, `-` and `_`). Every chunk of one upload uses the same `chunkBytes`, between 256 KB and the server's maximum in `GET /api/config`, and is exactly that long except the last. Chunks can arrive in any order or in parallel. Then send the returned path in `sandboxFiles` with `agent=1` on `/api/chat`.

### Other routes

`POST /api/sandbox` with `{ "action": "kill" | "pause", "sandboxId": "…", "e2bKey": "…" }` destroys or pauses a sandbox. `GET /api/config` reports whether the server has a fallback E2B key, the upload limits it accepts and the sign-in state of the caller.

With accounts on, every route above needs the session cookie, and `apiKey` becomes optional. `POST /api/auth/signup` and `POST /api/auth/login` take `{ "email", "password" }` and set the cookie, `POST /api/auth/logout` clears it, and `GET /api/auth/me` returns the account with today's usage.

## How a request is built

| File | Role |
| --- | --- |
| `src/lib/system-prompt.ts` | Your system prompt. |
| `src/lib/xai/build-input.ts` | Builds the `input` array, the request-time notes, the tool list and the request body. |
| `src/lib/xai/developer-note.ts` | `APP_INSTRUCTIONS`, sent in the `instructions` field. |
| `src/lib/xai/stream.ts` | Streams one model call and maps Responses events to SSE; drops request parts xAI rejects. |
| `src/lib/xai/retry-network.ts` | Network retry. |
| `src/lib/xai/history.ts` | Trims history before sending. |
| `src/lib/xai/ask.ts` | Chat and Search turns. |
| `src/lib/xai/doc-text.ts` | Reads text from documents when the endpoint has no Files API. |
| `src/lib/agent/loop.ts` | The model and sandbox tool loop. |
| `src/lib/auth/gate.ts` | Who may make a request and whose key pays for it. |
| `src/lib/agent/run-tools.ts` | Tool implementations against E2B. |

The system message is `system-prompt.ts` plus short notes the server appends: the file download format, the search note when Search is on, the sandbox note in Agent mode, and a one-line model description.

Follow-up turns pass `previous_response_id`, so earlier context, uploaded files and encrypted reasoning stay on xAI's side (xAI keeps responses for 30 days). When a chain cannot be used, the full history is sent instead. On a gateway the full history is always sent (see below).

## Accounts (optional)

By default the app has no sign-in and every visitor brings their own key. Set `DATABASE_URL` to a Postgres database and the app puts a sign-in screen in front of everything instead. The tables (`users`, `sessions`, `usage_daily`) are created on the first request.

Set `XAI_API_KEY` as well and signed-in people need no key of their own: their turns go out on the server's key, counted against a daily allowance. Anyone who adds their own key in Settings spends that instead, with no limit.

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Nothing else here matters without it. |
| `XAI_API_KEY` | The key signed-in accounts spend. Leave it empty to make everyone bring their own. |
| `DAILY_MESSAGE_LIMIT` | Messages per account per day on that key. 0 means no limit. Default 50. |
| `ADMIN_EMAIL` | Addresses that become admins when they sign up, comma separated. The first account on an empty database is an admin anyway. |
| `SIGNUP_OPEN` | `off` closes sign-up, so only existing accounts can get in. |
| `SIGNUP_CODE` | When set, sign-up also asks for this code. |
| `AUTH_REQUIRED` | `off` keeps the accounts but drops the login screen. |

- Sign-up takes an email address and a password of at least 10 characters. Passwords are stored as scrypt hashes; nothing verifies the address, so use `SIGNUP_CODE` if that matters.
- The session is a random token in an httpOnly cookie, good for 30 days and kept fresh while it is used. Only its hash is stored.
- Sign-in and sign-up are rate limited per IP address, in the server's memory.
- Admins get `/admin`: every account, what it has used today, its allowance, and a switch to turn an account off. Everyone else gets a 404 there.
- Conversations still live in the browser, not in the database. On a shared browser, signing in as a different account clears the previous one's chats.

## Using a gateway instead of api.x.ai

Set `XAI_BASE_URL` to an OpenAI-compatible gateway that serves Grok on the Responses API, such as a new-api deployment. The UI then asks for "your API key" and names the host. Two things change:

- **Documents.** These gateways usually have no Files API, so the server reads text, PDF, DOCX and PPTX files and puts their text in the message, shown as "sent as text". Other formats, and scanned PDFs, need Agent mode, which copies files into the sandbox.
- **History.** Turns are not linked with `previous_response_id`, because a gateway may send each request to a different upstream account. The full history goes with every turn, and Agent mode resends the turn so far after each tool round. Set `XAI_CHAIN_RESPONSES=on` if your gateway keeps response ids, or `off` to stop chaining on api.x.ai too.

Search, X search, code execution and citations work only when the gateway passes them through to xAI.

## Deploy to Vercel

Push the repo to GitHub and import it in Vercel, or run `npx vercel`. No environment variables are needed. Keep the limits above in mind: 4.5 MB request bodies and 300 second functions.

## Storage and privacy

- Up to 30 conversations and 200 messages each are kept in localStorage. If storage fills up, the oldest conversations are dropped on save.
- Images, screenshots and delivered files live in IndexedDB (`grok-chat`) and are removed with their conversation.
- Images in model markdown are shown as links, not loaded, so a document cannot make the model leak chat text through an image URL.
- Source chips load favicons from `icons.duckduckgo.com`.
