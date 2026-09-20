# Acceptance ledger

Version 1.5.0-rc.2 passes the defined local-plugin execution and conversation acceptance checks. Claude Code loaded the plugin and connected; the user-authorized alternative, Codex with its existing ChatGPT login, completed the packaged-server conversation and a separate reconnect conversation. The release remains an evaluation candidate: broad production chat reliability, independent certification, and ChatGPT directory approval are not established.

## Comparative evidence

The earlier local-stdio result was negative: 0.843× throughput versus Desktop Commander 0.2.51. Consolidating batch metadata alone also failed, at 0.772×. Those reports remain in `evidence/`.

The actual hosted RDC service was then authenticated through its normal OAuth flow. Its selected Mac device advertised version 0.2.48; the hosted MCP server advertised 1.0.0. An isolated nonce file read through RDC verified that both products reached the same machine. No controller, research job, or device pairing was replaced.

The first 20-round pipe-worker checks measured 2.56× throughput with separate launch/collection and 3.24× with bounded inline completion. Both products verified every worker outcome. A separate 30-workflow controlled delivery suite observed zero Commander failures versus ten RDC duplicate effects; both products passed normal delivery and client reconnect cases. The fixed fault mixture is not an estimate of naturally occurring failures.

Final release results are recorded against source revision `55e71d443d003a1c65ef785911411f559550391b` and runtime SHA-256 `761967b356bb30dc7610b3f3ad5092b5523157696fd36da32fca1ef58e942615` in the `hosted-rdc-rc2-*` reports. Twenty paired rounds measured **2.8007×** staged throughput (95% interval **2.6295–2.8982×**) and **3.1088×** inline throughput (**2.9476–3.3892×**). All 80 product-workflow observations verified, covering 320 worker executions. The benchmark protocol requires all outcomes to verify and the lower bound of a paired 95% bootstrap interval to exceed 2× before its throughput gate passes. The interval describes these repeated trials, not all future workloads.

## Gates and limits

| Gate | Evidence/status |
| --- | --- |
| Real hosted RDC comparison | Executed through OAuth and Streamable HTTP |
| 2× throughput in the defined execution workload | PASS: 2.80× staged and 3.11× inline; both lower interval bounds exceed 2× |
| At least 50% fewer failures under the defined delivery faults | PASS: final fixed fault suite, 0/30 versus 10/30 failures (all ten RDC failures were duplicate effects) |
| Duplicate suppression, caller loss, output draining, artifact verification, cancellation | Automated runtime/MCP regressions |
| Claude Code recognizes the plugin and connects to its MCP server | Observed through `claude --plugin-dir … mcp list` |
| Actual authorized-client conversation using the packaged server | PASS: Codex, eight initial calls and four calls after a new client process connected; all fixture predicates verified |
| Claude model conversation | Not observed; Desktop quota prompted the user-authorized client substitution |
| Actual Claude Desktop extension installation | Not observed |
| Public hosted ChatGPT execution connector | Not implemented or submitted |
| Cross-platform CI and extracted final bundle | PASS: six CI jobs; 92 runtime/MCP tests per platform matrix, 17 Chromium fixture tests, extracted-bundle MCP checks |
| Installed Ego Lite and historical Komoot session | Earlier acceptance used a new authorized space; the original uncertain session remains preserved |

The benchmark uses deterministic shell workers, not model-powered agents. The products take different supported routes: local stdio for Commander and the hosted relay for RDC. Network costs contribute to the measured difference. The local-only negative results remain relevant; these results do not show a universal runtime speedup.

Controlled Chromium tests use a real browser and a test-only Ego adapter. They do not certify the installed Ego Lite application or a chat UI. The original rc.1 CI included a Chromium startup timeout; its transient cause was not established. Subsequent passing runs do not erase that observation.

A first rc.2 Linux/Node 24 run failed because a test assumed an acknowledged input would produce shell output within 150 ms. The corrected test sends once, observes durable output with a bounded wait, and always cleans up its owned process. Run `35496170506` remains linked as adverse evidence; run `35496397251` passed all six jobs.
