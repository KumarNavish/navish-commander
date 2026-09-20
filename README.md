# Navish Commander

Use ChatGPT or Claude as the reasoning agent and Commander as the execution layer for authorized files, shell commands, browser workflows and parallel command batches on your machines.

**Runtime 1.6.0-rc.4 / personal connector 0.4.3** adds native Word, Excel and PDF workflows, images and explicit URL reads. The runtime does not discover or launch Codex, Claude Code or a separate model service. The chat client generates the code and commands, interprets outputs and decides the next step.

## Work directly from chat

Ask the connected chat to complete your task using Commander. The client should:

1. Discover the exact device with `commander_devices`.
2. Browse directories or search the repository, read relevant files, and apply precise changes with `commander_edit_block`. Use a file SHA-256 to reject stale edits.
3. Start commands with stable call/session IDs. For independent commands, use `commander_start_batch` with separate working directories.
4. Read process or batch results and verify the actual outputs before declaring completion.
5. After an interrupted response, inspect the original receipt and recover the same process or batch. Never replay uncertain work under a new ID.

Commander retains receipts, process output and batch state. Already-started commands can continue after a chat ends; further model reasoning still needs the chat client. Parallel command workers are not separately billed model agents. Do not launch model CLIs or APIs inside workers as an implicit fallback.

For example: “Use Commander on my Mac to fix the failing parser test in this repository. Read the code, make the edit, run the relevant tests, and verify the result. Keep all reasoning in this chat; do not invoke Codex or another model runner.”

A [fresh Latest / Extra High chat](evidence/chat-natural-recovery-20260921.json) invoked the personal connector by name without a plugin chip and recovered verified results in two read-only calls.

The current candidate exposes 33 local MCP tools (34 through the personal connector, including its receipt tool). It supports directory browsing, multi-file and document reads, exact text and spreadsheet edits, PDF creation and page operations, file metadata, durable paginated search, interactive process input and process recovery. Search and input survive client reconnects. See [document formats](docs/DOCUMENTS.md) and [RDC capability coverage](docs/RDC_CAPABILITIES.md) for limits.

## Candidate and evidence

The removed rc.1 executor's two model-backed tests consumed Codex usage and do **not** establish the requested chat-only capability. Their original records remain public. Historical job status, listing, cancellation and `navish jobs` / `navish job` are retained to recover those records; no new model-backed jobs can be launched. See [historical recovery](docs/AGENT_JOBS.md).

Connector 0.4.3 recovers oversized results without replaying commands or leaving the delivery queue stuck. The original full result remains local; a bounded notice directs the chat to existing output readers. See [response recovery](docs/PERSONAL_CONNECTOR.md#oversized-responses-in-connector-043).

The source-bound 0.4.1 final 50-pair hosted RDC comparison measured **2.079× median throughput**, with a paired 95% interval of **1.988–2.165×**; the strict 2× confidence gate is not passed. All 400 worker outcomes verified. Controlled delivery recorded **0/30 Commander failures versus 10/30 RDC duplicate effects**; normal delivery and reconnect passed for both. These are bounded execution measurements, not a general model-productivity claim.

An actual Latest / Extra High ChatGPT conversation completed and independently verified the Word, Excel and PDF workflow. Two platform approval blocks and subsequent client retries fail unattended certification despite successful artifacts. The full 41-call export and generated synthetic artifacts are published. See the [acceptance ledger](docs/ACCEPTANCE.md) and [document conversation](docs/CHAT_DOCUMENTS.md).

## Install the Claude Code plugin

For the current package version, use `navish-commander-1.6.0-rc.4.zip` from the [candidate release](https://github.com/KumarNavish/navish-commander/releases/tag/v1.6.0-rc.4). Extract the archive, then run:

```sh
claude --plugin-dir /absolute/path/to/extracted/navish-commander
```

The archive root contains `.claude-plugin/plugin.json` and `src/server.mjs`; use that root as the plugin directory. The current source passes 143 local runtime/MCP tests. A fresh ZIP extraction passed 49 MCP tests, strict plugin validation, and the real Claude Code MCP connection check. These host checks do not invoke a model. Historical client evidence remains in the acceptance ledger and does not certify changed source.

## Claude Desktop package

For the current package version, use `navish-commander-1.6.0-rc.4.mcpb` from the [candidate release](https://github.com/KumarNavish/navish-commander/releases/tag/v1.6.0-rc.4). In Claude Desktop, open Settings → Extensions → Advanced settings → Install Extension, then select the file and review its permissions. The current candidate was installed and enabled in Claude Desktop 2.2553.1. All 33 tools were discovered, and their owner-selected Always allow settings persisted after reopening configuration. Its installed runtime matches the tested source. A Claude model conversation remains untested because the account had reached its limit. See [host installation evidence](evidence/claude-host-installation-20260920.json).

The package includes its JavaScript dependencies. The host needs Node.js 22.16 or later. Noninteractive pipe workers require only Node. Interactive PTY workers additionally need Python 3.9 or later on PATH; `NAVISH_PYTHON` can select an interpreter. macOS and Linux are the intended runtime platforms; Windows is not supported by the PTY worker implementation. Claude's platform availability is separate from the server's Linux support.

The server executes commands with your account's OS permissions. Only connect it to clients you trust. It does not create a public network listener. Tool descriptions and confirmations are guidance for the client, not an OS sandbox.

## Install from source

```sh
git clone https://github.com/KumarNavish/navish-commander.git
cd navish-commander
npm ci --omit=dev --ignore-scripts
node src/server.mjs
```

The last command starts an MCP stdio server and waits for a client. For a generic MCP client, configure `command: "node"` and `args: ["/absolute/path/navish-commander/src/server.mjs"]`.

For Claude Code, after installing dependencies, load the checkout with `claude --plugin-dir /absolute/path/navish-commander`. The release ZIP also includes installed dependencies and the Claude plugin manifest. No install hook downloads or executes additional software.

## File operations and process batches

Ask the client to discover Commander's devices, start a worker with a stable session ID, and verify its result. For parallel work, supply one stable batch ID and separate working directories. Select `transport: "pipe"` for noninteractive workers; select `pty` for terminal-dependent programs. Omission preserves the original PTY behavior. `commander_collect_batch` can collect the same batch after reconnecting. It checks exit codes and any declared artifact hashes.

File and process status reads return fresh observations without writing mutation receipts. Mutations retain their durable admission and completion records. A tool response has both `state` (the call outcome) and `operationState` (the worker or batch outcome). `state: completed` with `operationState: running` means the launch succeeded and work is still running. A successful process exit is not a claim that an arbitrary user goal has been achieved.

The package stores private state under the current user's Commander directories. Tests use isolated temporary directories. Existing machine pairings remain local; no personal device IDs, credentials, or research data are bundled.

## ChatGPT availability

The optional [personal HTTPS connector](docs/PERSONAL_CONNECTOR.md) has been deployed on existing free hosting and connected to ChatGPT through owner-only OAuth. On 20 September the owner explicitly selected **Allow all actions**, and Plugin Management confirmed the setting. A fresh chat verified an exact append, duplicate suppression, and four concurrent worker artifacts; another chat recovered them without mutation. However, nine automated safety blocks occurred during the first conversation, and the deliberately failing worker never launched. The model retried denied intents with stable IDs. Fully unattended chat execution is **not certified**. See the [full-access conversation evidence](evidence/chatgpt-full-access-20260920.json), [connector release evidence](evidence/personal-connector-0.1.1-acceptance.json), and preserved [earlier chat failure](evidence/personal-connector-acceptance.json).

Anyone may deploy a separate single-owner instance from source. No OpenAI API key or paid hosting is required by this implementation. The Mac must be online and free hosting quotas apply. This is personal developer-mode availability, not an approved public directory listing. The historical comparison and its failed throughput gate are reported above; the earlier passing 0.1.1 result remains bound to its original source. Earlier polling and default-scheduling runs failed and remain recorded. The measured route is ChatGPT's configured HTTPS endpoint, using a durable WebSocket channel and interactive macOS scheduling. [Distribution requirements](docs/DISTRIBUTION.md) and the acceptance ledger distinguish these routes.

## Verify a downloaded release

Check out the release tag, download the ZIP and `SHA256SUMS.txt` from the same release, and run:

```sh
python3 scripts/verify_release.py --integrity-only /path/to/navish-commander-1.6.0-rc.4.zip /path/to/SHA256SUMS.txt
```

This checks the archive hash, every authored package file against the checkout, and its runtime digest. It explicitly reports comparative and conversation gates as **not evaluated**. Omitting `--integrity-only` retains the strict source-bound checks for the original rc.2 acceptance package; those checks must fail when applied to changed source.

The original comparison and full-access conversation records can be verified at commit `631721c88208f611e9a3817337cc21c4f959718f` using `node scripts/verify-personal-connector.mjs` and `node scripts/verify-chat-full-access.mjs`. CI keeps that immutable historical verification separate from tests and package-integrity checks of the current source. A historical verifier pass does not certify a later release.

At the rc.3/0.1.2 source tag, `node scripts/verify-chat-efficacy.mjs` verifies the original 18 assignments, including the six then-unrun tasks and separate two-chat reader confirmation. Its strict source check is preserved in historical CI. At commit `321cf94a6dcf608323e73440153215ac217d46b0`, use `node scripts/verify-workflow-remediation.mjs` for the subsequent independent task attempts and response-recovery confirmation. Verifier success means record consistency, not universal certification.

## Validate and build

```sh
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm test
npm run bundle
```

`npm test` runs the core and real MCP integration tests. Browser fixture tests have a separate launcher and need an isolated Chromium executable; they are not silently counted as passing when Chromium is unavailable. See [acceptance status](docs/ACCEPTANCE.md).

The [source provenance](docs/SOURCE_PROVENANCE.json) records the imported runtime commit. The existing personal GitHub control transport is retained in the runtime source, but its controller installation is separate from installing this MCP package.

Licensed under MIT. Report reproducible problems through [GitHub Issues](https://github.com/KumarNavish/navish-commander/issues).
