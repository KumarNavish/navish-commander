# Personal connector 0.1.0

The optional single-owner HTTPS connector makes the existing Commander runtime available to a personal ChatGPT developer app. Owner OAuth with PKCE, a durable SQLite channel, and an outbound Mac WebSocket preserve call identity across lost responses and reconnects. The pinned Mac LaunchAgent uses interactive scheduling and precise timers. A one-shot socket error listener prevents recursive close errors on older Node 22 runtimes; the core 1.5.0-rc.2 execution runtime is unchanged.

The deployed personal endpoint measured 2.528× hosted RDC throughput in twenty paired four-worker rounds (95% interval 2.254–2.735×), with all 160 worker outcomes verified. A separate controlled delivery suite observed 0/30 failures versus RDC's 10/30 duplicate effects. Source-bound reports and negative development results are published, and `scripts/verify-personal-connector.mjs` recomputes the recorded gates.

The existing personal ChatGPT app remains connected and global instructions were updated privately. A real read-only chat passed. Fully unattended mutation acceptance remains blocked: the earlier chat selected incorrect append content and platform review rejected worker launches. These outcomes are preserved. This release is an evaluation candidate, not independent certification or public directory approval.

Existing Netlify Free and Cloudflare Workers Free accounts supply hosting with hard limits; no paid API, new subscription, tunnel, or upgrade was used. A standalone Cloudflare deployment is also documented. Free quotas and client permission checks still apply. Download the connector source archive for deployment; the separately published local 1.5.0-rc.2 Claude/MCPB assets remain unchanged.

# 1.5.0-rc.2

This candidate adds a detached Node pipe supervisor for noninteractive workers, preserving session identity, output, exit codes, and recovery after the MCP caller exits. Use `transport: "pipe"`; interactive PTY behavior and its existing identity fingerprints remain compatible.

Status reads now return fresh observations without writing mutation receipts. Mutation admissions still persist before dispatch; identical admission/active records share a durably published inode, and terminal updates replace it atomically. Batch collection reads the durable session records directly, avoids redundant successful-launch index writes, and polls at 25 ms by default. Interpreter discovery runs once during MCP initialization; pipe workers do not require Python.

Cancellation requires the original supervisor's acknowledgement. A missing acknowledgement remains uncertain and never falls back to signalling a possibly reused PID. MCP cancellation reports the actual worker outcome separately from the tool receipt.

Live comparisons now exercise the actual hosted RDC service through OAuth, including a host-identity nonce check. Final 20-round runs measured 2.80× staged throughput and 3.11× inline throughput; the paired 95% lower bounds were 2.63× and 2.95×. Native duplicate-delivery handling passed the defined failure-reduction gate. Source-bound final reports, negative development results, and exact scope are in `evidence/` and `docs/BENCHMARK.md`. These are local-plugin versus hosted-relay measurements using deterministic workers; they do not establish a general model-agent productivity ratio.

Claude Code has loaded the plugin and connected to its MCP server. The release ZIP includes production dependencies. After Claude Desktop reached its message limit, the user authorized another existing client. Codex, using its existing ChatGPT login, completed an eight-call conversation and a separate four-call reconnect conversation against the extracted package. Independent checks verified the file effect, all worker artifacts, durable identities, and failure reporting. No extra credits were purchased. A public ChatGPT connector, directory approval, and independent product certification remain unclaimed.

The installed personal Commander controller and research jobs were not upgraded or restarted. Earlier Chromium startup failure and failed local throughput measurements remain preserved. Documentation receives local review; the earlier external Markup AI review was unavailable because its configured token had no associated organization.

All six CI jobs passed, including 92 runtime/MCP tests on macOS and Linux with Node 22.16 and 24, 17 Chromium fixture tests, and packaged-server integration tests. A first Linux run exposed a test that assumed immediate output after input acknowledgement; the bounded observation fix and adverse run are documented. `scripts/verify_release.py` checks a downloaded archive against this checkout and the recorded acceptance evidence.
