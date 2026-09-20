# Navish Commander

Run authorized work from an MCP client, reconnect after an interruption, and collect the same workers without starting them again.

This repository packages the existing Commander runtime as a local MCP server and Claude Desktop extension, with an optional authenticated personal ChatGPT connector. It provides file operations, persistent processes, durable receipts, and parallel batches with optional artifact verification. It does not supply a language model or require a model subscription of its own.

**Release status: local runtime 1.5.0-rc.2; personal connector 0.1.1, evaluation candidates.** The deployed personal HTTPS connector measured **2.07× RDC throughput** across 20 paired rounds, with a paired 95% interval of **2.01–2.19×** and all 160 worker outcomes verified. Its controlled delivery suite observed **0/30 failed workflows versus RDC's 10/30**. The local plugin separately measured 2.80× staged and 3.11× inline throughput. These are deterministic execution workloads on the same Mac, not a general improvement in model planning or everyday chat reliability. The [acceptance ledger](docs/ACCEPTANCE.md) records conversation results, package checks, and remaining limits. All samples and earlier failed benchmarks remain public.

## Install the verified Claude Code plugin

Download and extract `navish-commander-1.5.0-rc.2.zip` from [GitHub Releases](https://github.com/KumarNavish/navish-commander/releases), then run:

```sh
claude --plugin-dir /absolute/path/to/extracted/navish-commander
```

The archive root contains `.claude-plugin/plugin.json` and `src/server.mjs`; use that root as the plugin directory. The real Claude Code host loaded this package and reported its MCP server connected. A ChatGPT-authenticated Codex client exercised the same packaged server and recovered its workers after a client restart. [Inspect the client evidence](evidence/chat-client-rc2.json).

## Claude Desktop package

Download `navish-commander-1.5.0-rc.2.mcpb` from [GitHub Releases](https://github.com/KumarNavish/navish-commander/releases). In Claude Desktop, open Settings → Extensions → Advanced settings → Install Extension, then select the file and review its permissions. This release validates the bundle format; Desktop GUI installation and a Claude Desktop conversation were not observed.

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

## Use it

Ask the client to discover Commander's devices, start a worker with a stable session ID, and verify its result. For parallel work, supply one stable batch ID and separate working directories. Select `transport: "pipe"` for noninteractive workers; select `pty` for terminal-dependent programs. Omission preserves the original PTY behavior. `commander_collect_batch` can collect the same batch after reconnecting. It checks exit codes and any declared artifact hashes.

File and process status reads return fresh observations without writing mutation receipts. Mutations retain their durable admission and completion records. A tool response has both `state` (the call outcome) and `operationState` (the worker or batch outcome). `state: completed` with `operationState: running` means the launch succeeded and work is still running. A successful process exit is not a claim that an arbitrary user goal has been achieved.

The package stores private state under the current user's Commander directories. Tests use isolated temporary directories. Existing machine pairings remain local; no personal device IDs, credentials, or research data are bundled.

## ChatGPT availability

The optional [personal HTTPS connector](docs/PERSONAL_CONNECTOR.md) has been deployed on existing free hosting and connected to ChatGPT through owner-only OAuth. On 20 September the owner explicitly selected **Allow all actions**, and Plugin Management confirmed the setting. A fresh chat verified an exact append, duplicate suppression, and four concurrent worker artifacts; another chat recovered them without mutation. However, nine automated safety blocks occurred during the first conversation, and the deliberately failing worker never launched. The model retried denied intents with stable IDs. Fully unattended chat execution is **not certified**. See the [full-access conversation evidence](evidence/chatgpt-full-access-20260920.json), [connector release evidence](evidence/personal-connector-0.1.1-acceptance.json), and preserved [earlier chat failure](evidence/personal-connector-acceptance.json).

Anyone may deploy a separate single-owner instance from source. No OpenAI API key or paid hosting is required by this implementation. The Mac must be online and free hosting quotas apply. This is personal developer-mode availability, not an approved public directory listing. The connector's own final comparison passes the 2× gate with its confidence interval above 2×. Earlier polling and default-scheduling runs failed and remain recorded. The measured route is ChatGPT's configured HTTPS endpoint, using a durable WebSocket channel and interactive macOS scheduling. [Distribution requirements](docs/DISTRIBUTION.md) and the acceptance ledger distinguish these routes.

## Verify a downloaded release

Check out the release tag, download the ZIP and `SHA256SUMS.txt` from the same release, and run:

```sh
python3 scripts/verify_release.py /path/to/navish-commander-1.5.0-rc.2.zip /path/to/SHA256SUMS.txt
```

This checks the archive hash, every authored packaged file against the checkout, the runtime digest used in the live tests, and the recorded throughput and delivery predicates. It verifies the published evidence; it does not rerun RDC or provide a cryptographic signature. The hosted benchmark scripts and complete protocol are included for independent reruns using your own authorized RDC device.

To verify the recorded personal connector gates against its source checkout, run `node scripts/verify-personal-connector.mjs`. This recomputes every predicate and checks source and harness hashes without using credentials or making network requests.

Run `node scripts/verify-chat-full-access.mjs` to verify the later conversation record, including its blocked acceptance status. A successful verifier exit means the evidence is consistent; it does not mean the unattended certification gate passed.

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
