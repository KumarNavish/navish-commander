# Acceptance ledger

## Connector 0.4.3 / unchanged runtime 1.6.0-rc.4

Fixes a reproduced delivery deadlock: a valid 700,000-byte interactive result generated a 1,401,286-byte MCP response, exceeding the channel limit. Two upload attempts failed while the mutation ran once. The fix preserves the original local journal and delivers a bounded notice with status, identity, size and hash. Isolated real-MCP/SQLite-channel tests cover lost upload, reconnect, duplicate suppression, complete bounded output recovery and a drained queue. The full local suite has 143 tests. The [deployed endpoint confirmation](../evidence/connector-0.4.3-output-recovery.json) recovered all 700,000 bytes in 11 bounded reads, verified exactly one side effect, preserved the full journal, stopped its owned worker and confirmed zero pending requests. No new hosted RDC throughput or unattended ChatGPT certification claim is made for this connector revision.

## Historical 1.6.0-rc.4 / connector 0.4.1

Adds native DOCX, XLSX, PDF, image and URL workflows. Document writes use staged validation and existing durable call receipts. Large outbound responses are compressed with a bounded decoder; durable records retain their original JSON representation. The full local suite passes 142 tests.

The [actual Latest + Extra High document conversation](CHAT_DOCUMENTS.md) produced and read back a corrected workbook, Word report, two-page PDF and handoff. Independent artifact and arithmetic checks passed. All 41 visible tool calls were exported with no mismatched response identities. Two Word writes were blocked by OpenAI's safety checks; the client subsequently retried those intents despite the connector's instruction to stop. **Artifact completion passed; unattended certification failed.** The owner had selected Allow all actions. No model runner or paid model API was invoked.

After candidate selection, a [predeclared 50-pair confirmation](../evidence/personal-0.4.1-final-plan.json) verified all 400 worker outcomes. Commander measured **808.325 ms** median versus hosted RDC's **1,680.730 ms**, or **2.0793×**, with paired 95% interval **1.9883–2.1652×**. The strict lower-bound-at-least-2 gate **fails**. The [30-workflow delivery comparison](../evidence/personal-0.4.1-delivery.json) passes: **0/30 Commander failures versus 10/30 RDC failures**, all RDC failures being duplicate effects. Both products passed normal delivery and client reconnect. This fixed mixture is not a population reliability estimate.

The 0.4.0, 0.4.1 qualification and rejected 0.4.2 notification-candidate measurements remain in `evidence/`. The notification change was removed after it failed to improve hosted performance. The final confirmation was run once with exactly 50 pairs; no failed sample was dropped, no timing-based rerun replaced it, and selection samples were not pooled into its interval.

Recompute the final records without making a live request:

```sh
node scripts/verify-current-connector.mjs evidence/personal-0.4.1-final-inline.json evidence/personal-0.4.1-delivery.json evidence/personal-0.4.1-final-plan.json
node scripts/verify-chat-documents.mjs
```

The [Claude host installation](../evidence/claude-host-installation-20260920.json) verifies the current extension installed and enabled, all 33 tool permissions persisting, and an identical installed runtime digest. A fresh ZIP extraction passed 49 MCP tests, strict plugin validation, and a real Claude Code MCP connection check without a model call. A Claude model conversation is untested.

A [fresh Latest / Extra High chat](../evidence/chat-natural-recovery-20260921.json) invoked Commander by name without manually selecting a plugin. Its two read-only calls recovered the correct metrics and three artifact hashes, with no mutations or denials. This verifies that specific automatic-routing and recovery path; it does not override the earlier mutation denials.

The deployed personal ChatGPT connection uses the direct Cloudflare MCP route. Public distribution remains self-hosted, and these results do not establish a public directory approval or full unattended certification.

## Historical 1.6.0-rc.3 / connector 0.3.0 core tools

Adds 19 native MCP tools for directory access, multi-file reads, precise text edits, metadata, persistent search, interactive processes, configuration and audit inspection. Four isolated MCP workflow regressions cover edits and replay, search and reconnect, timeout and cancellation, and exactly-once interactive input. The full local suite passes 137 tests. This closes concrete tool-interface gaps; it does not establish full RDC parity or a new performance result. [Capability coverage](RDC_CAPABILITIES.md).

## Historical 1.6.0-rc.2 / connector 0.2.1 architecture correction

The Codex-backed repository executor was removed because consuming Codex allowance contradicts the intended chat-to-tools workflow. ChatGPT or Claude supplies reasoning; Commander provides direct file, process, browser and command-batch execution. No replacement model runner or paid API was added. Historical jobs and all adverse evidence remain recoverable. The rc.1 model-backed results below do not satisfy the chat-only requirement. This correction makes no new throughput or full unattended-certification claim.

## Historical 1.6.0-rc.1 / connector 0.2.0 repository jobs

Commander now accepts a repository goal as one durable job, keeps an isolated
checkout, runs the existing ChatGPT-authenticated Codex client, verifies declared
checks in a managed workspace sandbox, and retains a patch recoverable from
another chat. No paid API fallback was added.

The [real engineering job](../evidence/durable-job-20260920.json) produced the
`navish jobs` and `navish job` CLI and eight focused regressions. It remained
`needs_attention` after incomplete full-suite checks in its sandbox. Its patch
was reviewed and the focused regressions independently passed before integration.
The full resulting suite passed 138 tests on Linux/macOS and Node 22.16/24 in CI.
An actual-CLI preflight now checks the standalone verification interface before
accepting a job; isolated fake-CLI tests alone had not exposed its missing
permission-profile argument.

A [ChatGPT Latest + Extra High job](../evidence/chat-repository-job-20260920.json)
submitted the README improvement, finished as `review_ready` with an independent
check exit of zero, and was recovered by a fresh chat without supplying the job
ID. The original recovery's unsupported assertion about downstream application
is retained as adverse evidence. Job status now explicitly reports those actions
as unobserved. A fresh status call in that same conversation correctly reported
the unknown integration state after the fix. The original 13,619-byte
[patch](../evidence/patches/chat-readme-20260920.patch) is published with its
SHA-256. These observations establish a bounded workflow result, not broad model
reliability, directory approval or independent certification.

The frozen current-source comparison verified all 160 workers. Commander took
914.46 ms median versus RDC's 1,764.50 ms: **1.9296×**, with a paired 95% interval
of **1.8083–1.9865×**. The strict 2× throughput gate **fails**. The controlled
delivery gate passes with **0/30 Commander failures versus 10/30 RDC failures**;
all ten RDC failures were duplicate effects. Normal delivery and reconnect
passed for both products. This fixed fault mixture is not a production failure
rate. No timing-based rerun was used to replace the negative result.

The [frozen protocol](../evidence/personal-0.2.0-protocol.json),
[throughput samples](../evidence/personal-0.2.0-inline.json), and
[delivery samples](../evidence/personal-0.2.0-delivery.json) are public. Recompute
their source binding and predicates with:

```sh
node scripts/verify-current-connector.mjs evidence/personal-0.2.0-inline.json evidence/personal-0.2.0-delivery.json
```

## Historical rc.3 / connector 0.1.3 candidate

The [workflow continuation](WORKFLOW_REMEDIATION.md) attempts all six previously unsubmitted tasks using Latest + Extra High. Four complete their required outcomes, including actual code repair and both four-worker batches; two code tasks remain incomplete. A completed write omitted from the chat export exposed a false no-change report. Connector 0.1.3 adds durable response identity and receipt-recovery guidance, with three regressions reproduced before the fix. The full suite passes 120 tests and the extracted bundle passes 27 tests. New source-bound confirmation evidence is kept separate from the unchanged continuation and historical performance records. Fully unattended certification remains unachieved.

The refreshed 0.1.3 comparison verifies all 160 workers and measures 2.0119× throughput versus hosted RDC, but its paired 95% interval is 1.7668–2.1605×. The strict 2× throughput gate therefore fails for this run. The separately frozen delivery gate passes: 0/30 Commander failures versus 10/30 RDC duplicate-effect failures, with normal and reconnect scenarios passing for both. At commit `321cf94a6dcf608323e73440153215ac217d46b0`, run `node scripts/verify-current-connector.mjs` to verify those source-bound records. This is deterministic execution evidence, not a model productivity comparison.

## Historical rc.3 / connector 0.1.2 reader repair

The [Latest + Extra High conversation evaluation](CHAT_EFFICACY.md) completed ten baseline conversations and two separate repair confirmations, with 116 exported calls. It found a reproducible large-file pagination defect in rc.2. The rc.3 repair passed both fresh read-only conversations, 117 runtime/MCP tests and 24 extracted-bundle tests. Six planned mutation tasks were unrun; UI-export defects and uncorroborated denial reports remain recorded. The rc.2/0.1.1 throughput, delivery, and earlier conversation evidence below remains tied to its original source. It is not comparative acceptance of this changed candidate. Current package integrity and historical performance predicates are separate CI checks. Fully unattended certification remains unachieved.

## Historical rc.2 / connector 0.1.1 acceptance

**Earlier full-access ChatGPT gate:** the owner selected Allow all actions, and the setting was applied. The fresh 33-call conversation verified the exact write and parallel artifacts but incurred nine platform safety blocks; the deliberate failure worker remained unsubmitted. A six-call fresh-chat recovery passed with independent journal and file verification. Full unattended certification remains blocked. [Detailed record and export limitations](CHAT_ACCEPTANCE.md#full-access-personal-chatgpt-check-20-september-2026).

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
| Historical rc.2/0.1.1 2× throughput in the defined execution workload | PASS for those older bytes: personal HTTPS connector 2.067× (95% interval 2.010–2.186×); local plugin 2.80× staged and 3.11× inline. Current 0.1.3 result is above. |
| At least 50% fewer failures under the defined delivery faults | PASS for both personal HTTPS and local routes: 0/30 versus 10/30 failures in each fixed suite (all RDC failures were duplicate effects) |
| Duplicate suppression, caller loss, output draining, artifact verification, cancellation | Automated runtime/MCP regressions |
| Claude Code recognizes the plugin and connects to its MCP server | Observed through `claude --plugin-dir … mcp list` |
| Actual authorized-client conversation using the packaged server | PASS: Codex, eight initial calls and four calls after a new client process connected; all fixture predicates verified |
| Claude model conversation | Not observed; Desktop quota prompted the user-authorized client substitution |
| Actual Claude Desktop extension installation | Not observed |
| Personal authenticated ChatGPT connector | Implemented and connected; fresh ordinary ChatGPT read verified; direct HTTPS write/reconnect/four-worker checks pass |
| Unattended ChatGPT worker conversation | Not passed: with full access selected, nine platform blocks occurred and the deliberate failure worker remained unsubmitted; exact append, four-worker artifacts, and fresh-chat recovery verified |
| Public ChatGPT directory approval | Not submitted or approved |
| Cross-platform CI and extracted final bundle | PASS: six CI jobs; 105 runtime/MCP tests per platform matrix, 17 Chromium fixture tests, extracted-bundle MCP checks |
| Installed Ego Lite and historical Komoot session | Earlier acceptance used a new authorized space; the original uncertain session remains preserved |

The benchmarks use deterministic shell workers, not model-powered agents. The original comparison uses local stdio for Commander and the hosted relay for RDC. The personal connector comparison uses both products' hosted HTTPS routes to the same Mac. Network and scheduling costs contribute to the measured differences. The local-only negative results remain relevant; these results do not show a universal runtime speedup.

Controlled Chromium tests use a real browser and a test-only Ego adapter. They do not certify the installed Ego Lite application or a chat UI. The original rc.1 CI included a Chromium startup timeout; its transient cause was not established. Subsequent passing runs do not erase that observation.

A first rc.2 Linux/Node 24 run failed because a test assumed an acknowledged input would produce shell output within 150 ms. The corrected test sends once, observes durable output with a bounded wait, and always cleans up its owned process. Run `35496170506` remains linked as adverse evidence; run `35496397251` passed all six jobs.

## Personal HTTPS connector evidence

The released connector source is `346ba2324e4427f1e31dda7558646716050175f777525dad97bb2f350fc307e1`. The cloud and pinned Mac installation attested that source during those measurements. The corresponding core runtime digest is `761967b356bb30dc7610b3f3ad5092b5523157696fd36da32fca1ef58e942615`.

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
