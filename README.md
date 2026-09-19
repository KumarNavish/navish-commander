# Navish Commander

Run authorized work from an MCP client, reconnect after an interruption, and collect the same workers without starting them again.

This repository packages the existing Commander runtime as a local MCP server and Claude Desktop extension. It provides file operations, persistent processes, durable receipts, and parallel batches with optional artifact verification. It does not supply a language model or require a model subscription of its own.

**Release status: 1.5.0-rc.1, evaluation candidate.** Full product certification and the requested 2× improvement over Remote Desktop Commander are not established. See [acceptance status](docs/ACCEPTANCE.md) and the [benchmark protocol](docs/BENCHMARK.md). A successful local test does not establish ChatGPT compatibility or hosted-service reliability.

## Install in Claude Desktop

Download `navish-commander-1.5.0-rc.1.mcpb` from [GitHub Releases](https://github.com/KumarNavish/navish-commander/releases). In Claude Desktop, open Settings → Extensions → Advanced settings → Install Extension, then select the file and review its permissions.

The package includes its JavaScript dependencies. The host needs Node.js 22.16 or later and Python 3.10 or later on PATH. macOS and Linux are the intended runtime platforms; Windows is not supported by the PTY worker implementation. Claude's platform availability is separate from the server's Linux support.

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

Ask the client to discover Commander's devices, start a worker with a stable session ID, and verify its result. For parallel work, supply one stable batch ID and separate working directories. `commander_collect_batch` can collect the same batch after reconnecting. It checks exit codes and any declared artifact hashes.

A tool response has both `state` (the call outcome) and `operationState` (the worker or batch outcome). `state: completed` with `operationState: running` means the launch succeeded and work is still running. A successful process exit is not a claim that an arbitrary user goal has been achieved.

The package stores private state under the current user's Commander directories. Tests use isolated temporary directories. Existing machine pairings remain local; no personal device IDs, credentials, or research data are bundled.

## ChatGPT availability

The portable plugin manifest and provider-neutral skill are included. This local stdio package is **not a public ChatGPT connector**. OpenAI's current public MCP submission path requires a production HTTPS endpoint, user authentication for private data and actions, domain verification, and review. See [distribution requirements](docs/DISTRIBUTION.md). No hosted endpoint or store approval is claimed by this release.

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
