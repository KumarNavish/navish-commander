# Acceptance ledger

The local runtime 1.5.0-rc.2 and personal connector 0.1.1 pass their defined execution throughput and controlled delivery gates. Version 1.5.0-rc.2 also passes the authorized local-client conversation checks. Claude Code loaded the plugin and connected; the user-authorized alternative, Codex with its existing ChatGPT login, completed the packaged-server conversation and a separate reconnect conversation. The release remains an evaluation candidate: broad production chat reliability, independent certification, and ChatGPT directory approval are not established.

## Comparative evidence

The earlier local-stdio result was negative: 0.843× throughput versus Desktop Commander 0.2.51. Consolidating batch metadata alone also failed, at 0.772×. Those reports remain in `evidence/`.

The actual hosted RDC service was then authenticated through its normal OAuth flow. Its selected Mac device advertised version 0.2.48; the hosted MCP server advertised 1.0.0. An isolated nonce file read through RDC verified that both products reached the same machine. No controller, research job, or device pairing was replaced.

The first 20-round pipe-worker checks measured 2.56× throughput with separate launch/collection and 3.24× with bounded inline completion. Both products verified every worker outcome. A separate 30-workflow controlled delivery suite observed zero Commander failures versus ten RDC duplicate effects; both products passed normal delivery and client reconnect cases. The fixed fault mixture is not an estimate of naturally occurring failures.

Final release results are recorded against source revision `55e71d443d003a1c65ef785911411f559550391b` and runtime SHA-256 `761967b356bb30dc7610b3f3ad5092b5523157696fd36da32fca1ef58e942615` in the `hosted-rdc-rc2-*` reports. Twenty paired rounds measured **2.8007×** staged throughput (95% interval **2.6295–2.8982×**) and **3.1088×** inline throughput (**2.9476–3.3892×**). All 80 product-workflow observations verified, covering 320 worker executions. The benchmark protocol requires all outcomes to verify and the lower bound of a paired 95% bootstrap interval to exceed 2× before its throughput gate passes. The interval describes these repeated trials, not all future workloads.

## Gates and limits

| Gate | Evidence/status |
| --- | --- |
| Real hosted RDC comparison | Executed through OAuth and Streamable HTTP |
| 2× throughput in the defined execution workload | PASS: personal HTTPS connector 2.067× (95% interval 2.010–2.186×); local plugin 2.80× staged and 3.11× inline |
| At least 50% fewer failures under the defined delivery faults | PASS for both personal HTTPS and local routes: 0/30 versus 10/30 failures in each fixed suite (all RDC failures were duplicate effects) |
| Duplicate suppression, caller loss, output draining, artifact verification, cancellation | Automated runtime/MCP regressions |
| Claude Code recognizes the plugin and connects to its MCP server | Observed through `claude --plugin-dir … mcp list` |
| Actual authorized-client conversation using the packaged server | PASS: Codex, eight initial calls and four calls after a new client process connected; all fixture predicates verified |
| Claude model conversation | Not observed; Desktop quota prompted the user-authorized client substitution |
| Actual Claude Desktop extension installation | Not observed |
| Personal authenticated ChatGPT connector | Implemented and connected; fresh ordinary ChatGPT read verified; direct HTTPS write/reconnect/four-worker checks pass |
| Unattended ChatGPT worker conversation | Not passed: model selected the wrong append content; approval layer stopped replay and worker launches |
| Public ChatGPT directory approval | Not submitted or approved |
| Cross-platform CI and extracted final bundle | PASS: six CI jobs; 105 runtime/MCP tests per platform matrix, 17 Chromium fixture tests, extracted-bundle MCP checks |
| Installed Ego Lite and historical Komoot session | Earlier acceptance used a new authorized space; the original uncertain session remains preserved |

The benchmarks use deterministic shell workers, not model-powered agents. The original comparison uses local stdio for Commander and the hosted relay for RDC. The personal connector comparison uses both products' hosted HTTPS routes to the same Mac. Network and scheduling costs contribute to the measured differences. The local-only negative results remain relevant; these results do not show a universal runtime speedup.

Controlled Chromium tests use a real browser and a test-only Ego adapter. They do not certify the installed Ego Lite application or a chat UI. The original rc.1 CI included a Chromium startup timeout; its transient cause was not established. Subsequent passing runs do not erase that observation.

A first rc.2 Linux/Node 24 run failed because a test assumed an acknowledged input would produce shell output within 150 ms. The corrected test sends once, observes durable output with a bounded wait, and always cleans up its owned process. Run `35496170506` remains linked as adverse evidence; run `35496397251` passed all six jobs.

## Personal HTTPS connector evidence

The released connector source is `346ba2324e4427f1e31dda7558646716050175f777525dad97bb2f350fc307e1`. Its cloud health endpoints and pinned Mac installation attest that source. The core runtime digest remains `761967b356bb30dc7610b3f3ad5092b5523157696fd36da32fca1ef58e942615`.

The actual personal ChatGPT HTTPS endpoint uses Netlify OAuth/edge routing, a Cloudflare SQLite Durable Object, and an outbound Mac WebSocket. With `ProcessType=Interactive` and precise timers, twenty paired inline rounds measured **2.067×** throughput (**837.415 ms** versus RDC's **1,730.57 ms**; paired 95% interval **2.010–2.186×**). All 40 product workflows and 160 workers verified. The separately frozen delivery suite observed **0/30** Commander failures and **10/30** RDC failures; all RDC failures were duplicate effects. Both products passed normal and reconnect cases. These gates pass for the specified workloads; the fixed fault mixture is not a production failure estimate.

Run `node scripts/verify-personal-connector.mjs` to recompute the reports' predicates and check source/harness hashes. The [throughput report](../evidence/personal-interactive-inline.json), [delivery report](../evidence/personal-interactive-delivery.json), and [acceptance record](../evidence/personal-connector-0.1.1-acceptance.json) preserve the measurements. Verification of a record is not a fresh hosted test or independent certification.

Earlier negative results remain public: the initial polling pilots measured 0.931× and 0.925×; subsequent polling runs measured 1.072× and 0.9361×. The first WebSocket run with default macOS scheduling measured 2.0565× but failed because its lower interval bound was 1.8142×. A standalone Cloudflare run under default scheduling measured 1.8759×. The four-pair interactive-scheduling pilot was exploratory. The final 20-pair result above is the gate-bearing run. Its report records the exact launch profile and verifies it stayed unchanged.

Owner-only OAuth/PKCE, a separate agent credential, immutable intents, durable acknowledgements, and reconnect journals protect the execution path. The installation uses existing Netlify Free and Cloudflare Workers Free accounts, with hard limits rather than paid overages. No paid model API or new subscription was used. Free quotas and the existing ChatGPT account's limits still apply.

The earlier real ChatGPT mutation conversation failed: the model selected the wrong append content, a repeat was denied, and the platform's automatic review blocked worker launches. That adverse record remains unchanged. Protocol and execution benchmark passes do not override the chat result. Fully unattended ChatGPT execution, an actual Claude Desktop extension installation, public directory approval, and independent certification remain unestablished. The connector stays an evaluation candidate.

A connector CI run at `5b2ed2a` failed in the local Wrangler proxy immediately after an unauthenticated request: OAuth registration received HTTP 500 with `Network connection lost`. The same revision's push workflow passed. The negative probes now consume their response bodies and close their client connections; the test also reports the registration status/body explicitly and never retries it. The full 102-test suite passed after this test-only change. Two additional focused comparisons passed under both connection modes, so these observations do not prove a unique root cause. [Run 35510018056](https://github.com/KumarNavish/navish-commander/actions/runs/35510018056) remains adverse evidence. Cloudflare has documented related dev-proxy stream failures, but equivalence to [issue 15203](https://github.com/cloudflare/workers-sdk/issues/15203) is an inference, not established. The deployed connector code was not changed to hide this test failure.

Final cross-version validation exposed a separate reentrant WebSocket error handler on Node 22.18: calling `close()` from the handler could emit another synchronous error and overflow the stack. The listener now removes itself before closing. A bounded regression fails on the prior implementation and passes after the fix; real local workerd tests pass on Node 22.16 and 22.18, and the full suite passes 103 tests. See the [regression record](../evidence/channel-node22-close-regression.json). Remaining jobs in the prior CI runs were cancelled after local reproduction. The final cloud/agent source was redeployed and both hosted benchmark suites rerun. The earlier successful 2.304× source and its reports remain in the `before-node22-fix` records; they are not used to certify changed bytes.

At revision `4099f0a`, all four runtime/platform combinations passed in the push workflow, but its isolated Chromium process did not publish `DevToolsActivePort` within ten seconds. The fixture now allows thirty seconds for startup without retrying any browser action; all 17 browser checks passed locally. The parallel PR workflow's Linux/Node 22 channel test hit its 120-second deadline, and its remaining job was cancelled to retrieve diagnostics. Local emulator requests and shutdown phases now have explicit bounds, phase diagnostics, and teardown that stops the owned server before awaiting its socket close handshake. Both adverse runs (`35511484884`, `35511486692`) remain public. These harness changes do not alter the deployed source or benchmark workload.

Version 0.1.0's post-merge Linux/Node 22.16 run reached `TEST_TIMEOUT: agent shutdown` ([run 35512073992](https://github.com/KumarNavish/navish-commander/actions/runs/35512073992)). The bounded harness exposed that the agent could still await a missing socket close event. Version 0.1.1 settles the connection once on error, stop, or a closed socket, clears timers and acknowledgements, and ignores late messages. Both missing-close regressions fail on 0.1.0 and pass on 0.1.1; the full suite passes 105 tests. See the [shutdown regression record](../evidence/channel-shutdown-regression.json). The final hosted reports were rerun against the new deployed source. Version 0.1.0's 2.528× result remains in `personal-0.1.0-inline.json`; the current 0.1.1 result is 2.067×. Historical measurements are not reused for changed source.

The 0.1.1 extracted test initially reproduced the earlier local dev-proxy HTTP 500 immediately after a body-bearing unauthorized request. Local proxy authentication probes now omit a body, since authentication rejects before parsing it. The in-process handler test still checks an unauthorized body, and fresh unauthenticated JSON-RPC requests to both deployed endpoints returned 401; these checks are recorded in the 0.1.1 acceptance file. All 23 extracted-package tests then passed. No request replay or retry was added to hide an uncertain mutation.
