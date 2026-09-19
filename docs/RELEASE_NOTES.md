# 1.5.0-rc.1

This evaluation release packages Commander as a local MCP server and downloadable Claude extension. It exposes typed file, process, batch, receipt, and bounded Ego browser tools. Stable identities survive reconnects; task state is separate from the outcome of the tool call.

Worker launch now waits asynchronously for its owned launcher, and session-ID reads avoid a redundant PID scan. Durable launch claims and receipt writes remain intact. The patch passed the existing caller-death, duplicate-launch, and artifact-validation checks.

Validation: 83 core/MCP tests; 17 controlled Chromium adapter tests; three MCP checks against the extracted release bundle; strict Claude manifest validation; MCPB schema validation; zero known npm audit findings. Platform CI results are recorded separately on the published commit.

The local four-worker comparison did not meet the 2× throughput target. Its measured ratio was 0.843× against Desktop Commander 0.2.51; all four deliberate MCP-server reconnect trials recovered on Commander. This is not the requested hosted Remote Desktop Commander or real chat-agent comparison.

No full product certification, production reliability ratio, directory approval, or live ChatGPT connector is claimed. The installed personal controller was not replaced. Markup AI editorial review could not run because the configured token has no associated organization; the documentation received local review only.
