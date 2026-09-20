# Acceptance ledger

Version 1.5.0-rc.2 improves execution throughput and duplicate-delivery handling, and Claude Code has loaded its MCP server successfully. Full chat-product certification remains open: an actual Claude conversation could not run because the account reached its message limit. No independent certification or ChatGPT directory approval is claimed.

## Comparative evidence

The earlier local-stdio result was negative: 0.843× throughput versus Desktop Commander 0.2.51. Consolidating batch metadata alone also failed, at 0.772×. Those reports remain in `evidence/`.

The actual hosted RDC service was then authenticated through its normal OAuth flow. Its selected Mac device advertised version 0.2.48; the hosted MCP server advertised 1.0.0. An isolated nonce file read through RDC verified that both products reached the same machine. No controller, research job, or device pairing was replaced.

The first 20-round pipe-worker checks measured 2.56× throughput with separate launch/collection and 3.24× with bounded inline completion. Both products verified every worker outcome. A separate 30-workflow controlled delivery suite observed zero Commander failures versus ten RDC duplicate effects; both products passed normal delivery and client reconnect cases. The fixed fault mixture is not an estimate of naturally occurring failures.

Final release results are recorded separately against a frozen source digest in the `hosted-rdc-rc2-*` reports. The benchmark protocol requires all outcomes to verify and the lower bound of a paired 95% bootstrap interval to exceed 2× before its throughput gate passes. The interval describes these repeated trials, not all future workloads.

## Gates and limits

| Gate | Evidence/status |
| --- | --- |
| Real hosted RDC comparison | Executed through OAuth and Streamable HTTP |
| 2× throughput in the defined execution workload | Passed the initial 20-round checks; final source-bound reports are published separately |
| At least 50% fewer failures under the defined delivery faults | Initial suite: 0/30 versus 10/30 failures |
| Duplicate suppression, caller loss, output draining, artifact verification, cancellation | Automated runtime/MCP regressions |
| Claude Code recognizes the plugin and connects to its MCP server | Observed through `claude --plugin-dir … mcp list` |
| Claude Code or Desktop conversation using the final package | Pending; Desktop reports usage reset September 21 at 01:00 |
| Actual Claude Desktop extension installation | Not observed |
| Public hosted ChatGPT execution connector | Not implemented or submitted |
| Cross-platform CI and extracted final bundle | Results in `evidence/validation-rc2.json` when complete |
| Installed Ego Lite and historical Komoot session | Earlier acceptance used a new authorized space; the original uncertain session remains preserved |

The benchmark uses deterministic shell workers, not model-powered agents. The products take different supported routes: local stdio for Commander and the hosted relay for RDC. Network costs contribute to the measured difference. The local-only negative results remain relevant; these results do not show a universal runtime speedup.

Controlled Chromium tests use a real browser and a test-only Ego adapter. They do not certify the installed Ego Lite application or a chat UI. The original rc.1 CI included a Chromium startup timeout; its transient cause was not established. Subsequent passing runs do not erase that observation.
