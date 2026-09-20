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
| Personal authenticated ChatGPT connector | Implemented and connected; fresh ordinary ChatGPT read verified; direct HTTPS write/reconnect/four-worker checks pass |
| Unattended ChatGPT worker conversation | Not passed: model selected the wrong append content; approval layer stopped replay and worker launches |
| Public ChatGPT directory approval | Not submitted or approved |
| Cross-platform CI and extracted final bundle | PASS: six CI jobs; 92 runtime/MCP tests per platform matrix, 17 Chromium fixture tests, extracted-bundle MCP checks |
| Installed Ego Lite and historical Komoot session | Earlier acceptance used a new authorized space; the original uncertain session remains preserved |

The benchmark uses deterministic shell workers, not model-powered agents. The products take different supported routes: local stdio for Commander and the hosted relay for RDC. Network costs contribute to the measured difference. The local-only negative results remain relevant; these results do not show a universal runtime speedup.

Controlled Chromium tests use a real browser and a test-only Ego adapter. They do not certify the installed Ego Lite application or a chat UI. The original rc.1 CI included a Chromium startup timeout; its transient cause was not established. Subsequent passing runs do not erase that observation.

A first rc.2 Linux/Node 24 run failed because a test assumed an acknowledged input would produce shell output within 150 ms. The corrected test sends once, observes durable output with a bounded wait, and always cleans up its owned process. Run `35496170506` remains linked as adverse evidence; run `35496397251` passed all six jobs.

## Personal HTTPS connector evidence

The first two four-round pilots measured 0.931× and 0.925× RDC throughput. Independent storage reads were parallelized, and a 20-round follow-up measured 1.072×, with every outcome verified. Those observations remain public. The optional HTTPS route has not met the 2× target. The local-plugin results above must not be attributed to this different transport. A further recovery correction exposes receipt lookup by the original call ID after a lost first response and preserves uncertainty when queue publication acknowledgements are missing.

The single-owner relay uses authenticated OAuth/PKCE and a separate agent credential. Its background Mac installation is pinned and its journals persist across restarts. The implementation requires no paid model API or new subscription. Free hosting and existing ChatGPT account limits still apply. Source publication and self-tests are not independent certification or a universal reliability guarantee.

The final corrected connector was deployed and installed with matching source SHA-256 `4502665fd83db14f3e2f358a5aa147ba95c0eab2af2005ebf18597a04e0b63e9`. Twenty paired inline rounds measured **0.9361×** throughput (paired 95% interval **0.8347–1.0005×**). All 40 product-workflow observations verified, covering 160 workers. The 2× HTTPS gate remains **FAIL**. The [complete final report](../evidence/personal-connector-final-inline.json) records the source and installation hashes; the earlier favorable and unfavorable observations remain alongside it.
