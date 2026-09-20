# 1.5.0-rc.2

This candidate adds a detached Node pipe supervisor for noninteractive workers, preserving session identity, output, exit codes, and recovery after the MCP caller exits. Use `transport: "pipe"`; interactive PTY behavior and its existing identity fingerprints remain compatible.

Status reads now return fresh observations without writing mutation receipts. Mutation admissions still persist before dispatch; identical admission/active records share a durably published inode, and terminal updates replace it atomically. Batch collection reads the durable session records directly, avoids redundant successful-launch index writes, and polls at 25 ms by default. Interpreter discovery runs once during MCP initialization; pipe workers do not require Python.

Cancellation requires the original supervisor's acknowledgement. A missing acknowledgement remains uncertain and never falls back to signalling a possibly reused PID. MCP cancellation reports the actual worker outcome separately from the tool receipt.

Live comparisons now exercise the actual hosted RDC service through OAuth, including a host-identity nonce check. Initial 20-round runs exceeded 2× throughput in both staged and inline modes. Native duplicate-delivery handling passed the defined failure-reduction gate. Source-bound final reports, negative development results, and exact scope are in `evidence/` and `docs/BENCHMARK.md`. These are local-plugin versus hosted-relay measurements using deterministic workers; they do not establish a general model-agent productivity ratio.

Claude Code has loaded the plugin and connected to its MCP server. The release ZIP includes production dependencies. Actual model-driven Claude conversation acceptance remains blocked by the account's message limit; no extra credits were purchased. A public ChatGPT connector, directory approval, and independent product certification remain unclaimed.

The installed personal Commander controller and research jobs were not upgraded or restarted. Earlier Chromium startup failure and failed local throughput measurements remain preserved. Documentation receives local review; the earlier external Markup AI review was unavailable because its configured token had no associated organization.
