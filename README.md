# Navish Commander

Run authorized work from an MCP client, reconnect after an interruption, and collect the same workers without starting them again.

This repository packages the existing Commander runtime as a local MCP server and Claude Desktop extension. It provides file operations, persistent processes, durable receipts, and parallel batches with optional artifact verification. It does not supply a language model or require a model subscription of its own.

**Release status: 1.5.0-rc.2, evaluation candidate.** Final execution-route tests measured **2.80× and 3.11× throughput** against hosted Remote Desktop Commander (20 paired rounds per mode; 95% lower bounds 2.63× and 2.95×). The fixed delivery-fault suite observed **0/30 failed workflows versus RDC’s 10/30**, exceeding the 50% reduction target. These compare this local plugin with RDC’s cloud relay on the same Mac using deterministic workers; they do not establish a 2× improvement in language-model planning or everyday chat reliability. The [acceptance ledger](docs/ACCEPTANCE.md) records the passed Codex conversation/reconnect checks, Claude Code host connection, and distribution limits. All samples and the earlier failed benchmarks remain public.

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

The portable plugin manifest and provider-neutral skill are included. This local stdio package is **not a public ChatGPT connector**. OpenAI's current public MCP submission path requires a production HTTPS endpoint, user authentication for private data and actions, domain verification, and review. See [distribution requirements](docs/DISTRIBUTION.md). No hosted endpoint or store approval is claimed by this release.

## Verify a downloaded release

Check out the release tag, download the ZIP and `SHA256SUMS.txt` from the same release, and run:

```sh
python3 scripts/verify_release.py /path/to/navish-commander-1.5.0-rc.2.zip /path/to/SHA256SUMS.txt
```

This checks the archive hash, every authored packaged file against the checkout, the runtime digest used in the live tests, and the recorded throughput and delivery predicates. It verifies the published evidence; it does not rerun RDC or provide a cryptographic signature. The hosted benchmark scripts and complete protocol are included for independent reruns using your own authorized RDC device.

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
