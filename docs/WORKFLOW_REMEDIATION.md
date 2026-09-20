# Completing the suspended workflows and repairing response recovery

The six previously unsubmitted tasks were all attempted in fresh ChatGPT conversations using **Latest + Extra High**. Four completed their required work: inventory reconciliation, a tested graph repair, a four-worker analysis, and accurate reporting of a batch with one intentionally failed worker. Two code-repair tasks remain incomplete. These are subsequent attempts of previously unsubmitted tasks, not rewrites of the original failed trials.

| Task | Observed result |
| --- | --- |
| Inventory reconciliation | Script executed; saved counts, discrepancy, duplicate ID and final alignment decision match the frozen oracle. |
| Interval repair | Incomplete. Chat reported a denied pretest; the export and host contain no execution of that test. Source files remain unchanged. |
| Pagination-code repair | Incomplete. A 499-byte module write completed, but the regression file and test execution are absent. The final answer incorrectly reported no changes; the completed write is missing from its export. |
| Topological ordering repair | Module and regression tests written; eight visible/regression tests passed through ChatGPT. Subsequent independent checks passed 93 predicates. |
| Four-worker analysis | All four 100,000-row workers completed; all results and saved summary match. Their durable session lifetimes overlap. Combined total: 201,590,906. |
| Mixed-success batch | Three workers completed and one rejected a negative row with exit code 2. All four artifacts and saved summary match; combined successful total: 12,085,786. The failed worker was not relaunched. |

The continuation contains **six conversations and 61 exported calls** against unchanged runtime rc.3 / connector 0.1.2. Both batches have exactly four worker sessions. The mixed-success chat first supplied invalid absolute artifact paths, then encountered a changed-request call-ID conflict. It inspected the original receipt before submitting the corrected specification under a new call ID and the original batch ID. Only that final batch launched workers. These autonomous parameter corrections remain visible; this was not a clean first-call success.

The two reported denials are not independently corroborated by an exported denial or a host execution record. Missing export entries alone cannot establish a platform denial. The pagination task demonstrates why: a completed write existed despite the model's no-change claim. No denied mutation was retried through another client or execution route.

## Repair and live confirmation

Connector **0.1.3** persists the original operation ID, tool, request hash and applicable target identifiers in newly journaled responses before uploading them. A chat can check which request a result belongs to and recover the recorded result using `commander_connector_receipt`. Server instructions also require read-only reconciliation of previously dispatched actions before claiming that nothing changed. See [the response contract](RESPONSE_RECOVERY.md).

The HTTPS frontend, channel and installed Mac agent were aligned to connector SHA-256 `324abcaf7b198839ab820b65855baa6bca077232d03b46a3a10604287a5ee8d0` before the separately frozen confirmation phase. The runtime is unchanged at SHA-256 `85d87aeca2d2f4c5c9b61ff72fd8e1c0f92d2388c10aad42335ae5dfdc5f200f`. The initial immediate post-install observation found the agent offline; a subsequent observation confirmed its completed startup, with no redeployment or work replay.

The first new chat accurately reconstructed the original partial write, observed the missing regression file and preserved every prior file and execution record. Its new file read carried the correct operation identity. However, the export still omits the missing-file check and the claimed relay receipt lookup. A read-only reload yielded the same three-call export. The host confirms the missing-file observation, but the relay receipt lookup has no separate Mac job; that part remains unverified, so this confirmation is scored partial.

The second confirmation passes all predicates. The chat identifies both planted configuration mismatches, obtains distinct IDs for the two file reads, and retrieves each stored result through the original ID. All five calls are exported; the two receipt responses exactly match their independent journals. Inputs remain unchanged and no process or file mutation occurs. Thus the two confirmation chats yield one pass and one partial outcome, with eight exported calls. Across the continuation and confirmation, this adds eight real conversations and 69 exported calls.

Some exports also omit the connector display label. These null labels are preserved; the verifier requires attribution through the actual Commander tool identity and matching durable request/result evidence. Seven deliberately corrupted workflow records and three corrupted comparison records are rejected by the verifiers.

Three new regression tests failed before the repair and pass afterward. The full runtime/MCP suite passes 120 tests; the extracted bundle passes 27 MCP tests and package/source integrity verification. The tests cover identified read recovery, concurrent equal-content reads, and preservation of failure semantics without echoing command bodies or environment variables. Existing lost-upload and no-reexecution checks remain active.

## Reproduce the evidence checks

```sh
npm ci --ignore-scripts
npm test
node scripts/verify-workflow-remediation.mjs
node scripts/verify-current-connector.mjs
node scripts/test-record-verifiers.mjs
```

The [sanitized record](../evidence/workflow-remediation-20260920.json) includes frozen prompts, model-setting readback, input/output hashes, exported calls, independent host observations, omitted host results, source alignment and explicit scoring notes. The verifier checks source binding, semantic results, worker exits, preserved prior effects, response identities and recorded receipt recovery. It validates a recorded observation; it does not rerun ChatGPT or establish independent certification.

The original [conversation evaluation](CHAT_EFFICACY.md) and source-bound verifier remain unchanged in historical CI. Scoring accepts either counts or exact distinct worker-name lists because the original task did not specify those JSON field types. A queue rejection with `dispatched: false` is checked against its existing same-ID/different-fingerprint durable intent; it should not have a new Mac execution journal.

All tasks use isolated synthetic workspaces and installed tools. There were no supervisor approval clicks, corrective follow-up prompts, model API purchases or new services. The existing app-specific **Allow all actions** setting was confirmed. ChatGPT's temporary request cooldowns were respected in the same browser space; recorded elapsed-time bounds include waiting to export completed conversations. The workers are ordinary Python processes launched by the model, not independent model-powered agents.

The separately frozen delivery comparison used ten repetitions each of normal delivery, concurrent duplicate delivery and client reconnect for each product. Commander passed all 30 workflows; RDC failed ten one-effect checks because duplicate delivery appended twice. Both passed normal delivery and reconnect. The controlled failure-reduction gate passes for connector 0.1.3; this artificial fault mixture is not a natural failure-rate estimate. The [throughput](../evidence/personal-0.1.3-inline.json) and [delivery](../evidence/personal-0.1.3-delivery.json) records bind to source commit `8591935`, the deployed connector/runtime hashes, and the unchanged benchmark harnesses.

This supplies completed work and a deployed recovery repair. It does not establish universal unattended reliability or a 2× model-mediated advantage over RDC. A fresh 20-pair hosted execution comparison of connector 0.1.3 verified all 160 workers and measured 2.0119× throughput: medians 883.12 ms for Commander and 1,776.775 ms for RDC. Its paired 95% interval, 1.7668–2.1605×, crosses below 2×, so the strict throughput gate fails. The earlier passing rc.2 / connector 0.1.1 result remains tied to that older source. Two failed tasks and the provider's export/denial ambiguities remain unresolved. External prose review was unavailable; this report was reviewed locally against the recorded artifacts.
