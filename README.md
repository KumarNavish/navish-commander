# Navish Commander

Start an authorized repository task from chat, let Commander work in an isolated checkout, and recover its status and patch from another chat using the same job ID.

## Start a durable repository job

For example, ask your connected MCP client to improve a repository's setup instructions. Call `commander_start_job` with these arguments, replacing the repository path with your Git repository's absolute root:

```json
{
  "device": "local",
  "callId": "setup-docs-start-001",
  "jobId": "setup-docs-001",
  "repository": "/absolute/path/to/my-repo",
  "goal": "Document the existing setup and test commands in README.md. Change only README.md and return a patch. Do not commit or push.",
  "checks": [
    { "name": "Patch whitespace", "argv": ["git", "diff", "--check"] }
  ]
}
```

Before starting, connect Commander using one of the installation options below and use `commander_devices` to confirm the host. Repository jobs currently require `device: "local"`, meaning that Commander host. It needs an installed Codex CLI already authenticated with ChatGPT. Jobs use that subscription's allowance; there is no API billing or automatic API fallback.

Choose new `jobId` and `callId` values for a new task, then retain both for that task. Commander records the repository's HEAD and starts an isolated Git worktree; uncommitted source changes are not copied. The source checkout is preserved. Checks are argument arrays run in the job workspace after the executor reports success. Use checks appropriate to your task; this example checks whitespace, so the documentation still needs review.

To collect progress or the resulting patch, call `commander_job_status`:

```json
{ "device": "local", "jobId": "setup-docs-001", "includePatch": true }
```

Inspect `result.state`, `result.checks` and `result.changedFiles`. The outer `state: "completed"` means the tool call succeeded, not that the job finished. A terminal job's patch is returned in `result.patch`; if it is truncated, call status again with `includePatch: true` and `patchOffset` set to the previous `result.patch.nextOffset`.

| Job state | Meaning and next step |
| --- | --- |
| `launching` / `running` | Work is active; read status again later. |
| `review_ready` | The executor reported completion, all declared checks passed, and a patch was captured. Review the patch for goal correctness before applying it; Commander does not merge it for you. |
| `needs_attention` | Execution, reporting, checks or collection did not succeed. Inspect the reason and retained evidence; partial changes remain available. |
| `cancelled` | The executor stopped after cancellation; partial changes are retained. |
| `uncertain` | Terminal evidence is missing. Inspect the retained workspace and logs; the job is not relaunched. |
| `unsubmitted` | No job record was found under this ID. Confirm the host and ID before taking further action. |

## Reconnect from another chat without relaunching

Connect the new chat to the same Commander instance and state directory, then call `commander_job_status` with the saved `jobId` as above. If the ID is missing, call `commander_jobs` to find recent jobs:

```json
{ "device": "local", "limit": 10 }
```

Select the matching repository and job from `result.jobs`, then pass its `jobId` to `commander_job_status`. These reads do not launch work or create mutation receipts. You do not need to reconstruct the old conversation or call `commander_start_job` again.

Keep both IDs stable after a lost response. An identical submission resolves to the existing job; a changed goal or check contract under the same job ID is rejected. A timeout, denial or uncertain result is never permission to retry the intent with a new ID or another route. There is no automatic resume or replay. See [repository jobs](docs/AGENT_JOBS.md) for execution limits, cancellation, patch pagination and terminal recovery with `navish jobs` / `navish job JOB_ID --patch`.

## Package and acceptance status

This repository packages the existing Commander runtime as a local MCP server and Claude Desktop extension, with an optional authenticated personal ChatGPT connector. It provides file operations, persistent processes, durable receipts, and parallel batches with optional artifact verification. It does not supply a language model or require a model subscription of its own.

**Current candidate: runtime 1.6.0-rc.1; personal connector 0.2.0.** Adds durable repository jobs. A [real ChatGPT Latest + Extra High job](evidence/chat-repository-job-20260920.json) produced this README improvement, passed its independent check, and was recovered from another chat without supplying its job ID. An unsupported downstream-integration claim in that recovery is preserved in the record; job status now explicitly marks application and publication as unobserved. The earlier [local-MCP engineering job](evidence/durable-job-20260920.json) produced the terminal recovery commands but ended in `needs_attention` because full-suite validation was incomplete in its isolated environment. Its original outcome remains unchanged; its patch was reviewed and validated separately before integration. These cases do not establish general unattended certification.

The **current 0.2.0 / 1.6.0-rc.1 comparison** verified all 160 workers and measured **1.93× RDC throughput** (paired 95% interval **1.81–1.99×**), so its strict 2× gate fails. The separately frozen delivery suite observed **0/30 Commander failures versus RDC's 10/30 duplicate effects**; normal delivery and reconnect passed for both. These are deterministic execution and controlled-fault results, not everyday chat reliability. Earlier passing and failing results remain in the [acceptance ledger](docs/ACCEPTANCE.md). Fully unattended ChatGPT operation remains **uncertified**.

## Install the Claude Code plugin

For the current package version, use `navish-commander-1.6.0-rc.1.zip` from the [candidate release](https://github.com/KumarNavish/navish-commander/releases/tag/v1.6.0-rc.1). Extract the archive, then run:

```sh
claude --plugin-dir /absolute/path/to/extracted/navish-commander
```

The archive root contains `.claude-plugin/plugin.json` and `src/server.mjs`; use that root as the plugin directory. The 1.6.0-rc.1 source passes Claude plugin validation and the 138-test runtime/MCP suite on Linux and macOS. Historically, the 1.5.0-rc.3 package also passed a real Claude Code MCP connection check and 24 extracted-bundle tests. The earlier rc.2 package was exercised by a ChatGPT-authenticated Codex client across a restart; those older conversations are not rc.3 or 1.6.0-rc.1 conversation evidence. [Inspect the earlier client evidence](evidence/chat-client-rc2.json).

## Claude Desktop package

For the current package version, use `navish-commander-1.6.0-rc.1.mcpb` from the [candidate release](https://github.com/KumarNavish/navish-commander/releases/tag/v1.6.0-rc.1). In Claude Desktop, open Settings → Extensions → Advanced settings → Install Extension, then select the file and review its permissions. The earlier 1.5.0-rc.3 release validated the bundle format; Desktop GUI installation and a Claude Desktop conversation were not observed. That evidence does not validate the current candidate.

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

Anyone may deploy a separate single-owner instance from source. No OpenAI API key or paid hosting is required by this implementation. The Mac must be online and free hosting quotas apply. This is personal developer-mode availability, not an approved public directory listing. The current comparison and its failed throughput gate are reported above; the earlier passing 0.1.1 result remains bound to its original source. Earlier polling and default-scheduling runs failed and remain recorded. The measured route is ChatGPT's configured HTTPS endpoint, using a durable WebSocket channel and interactive macOS scheduling. [Distribution requirements](docs/DISTRIBUTION.md) and the acceptance ledger distinguish these routes.

## Verify a downloaded release

Check out the release tag, download the ZIP and `SHA256SUMS.txt` from the same release, and run:

```sh
python3 scripts/verify_release.py --integrity-only /path/to/navish-commander-1.6.0-rc.1.zip /path/to/SHA256SUMS.txt
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
