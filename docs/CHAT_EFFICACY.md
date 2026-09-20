# Real ChatGPT efficacy evaluation — 20 September 2026

Follow-up: all six tasks recorded here as unrun were subsequently attempted independently. See the [workflow continuation and response-recovery repair](WORKFLOW_REMEDIATION.md). The original results below remain unchanged.

Twelve real ChatGPT conversations used the personal Navish Commander connector with **Latest + Extra High** selected. They exposed a reproducible large-file reader defect and incomplete execution of analysis tasks. The reader repair then passed two new real-chat checks. These results do **not** establish fully unattended operation or a general advantage over RDC.

The [machine-readable record](../evidence/chat-efficacy-extra-high-20260920.json) contains all 18 assignments, prompts, synthetic-input hashes, assistant answers, sanitized tool exports, host-journal observations, scoring, and evaluator corrections. Six assignments were never submitted. No paid API, new subscription, credit purchase, or hosting upgrade was used; conversations consumed the existing account allowance.

## Method and evidence boundaries

The baseline protocol was frozen at 14:57:54 UTC before the first submission. It prescribed 12 primary tasks and four fresh-chat recovery checks, one scored attempt per case, one active conversation, no corrective prompts, no supervisor approval clicks, and isolated synthetic workspaces. It required stopping a denied intent without retry or route changes and suspending subsequent mutation tasks after two such reports. The UI mode was read back for submissions. “Latest” is the observed UI selection; the underlying model revision was not independently exposed or pinned.

The baseline used connector **0.1.1**, runtime **1.5.0-rc.2**, and source commit `631721c88208f611e9a3817337cc21c4f959718f`. Original protocol SHA-256: `1172faa176a04da331deaa2803f09b0100603ed88e45ff5827a5a25823ce8e91`. Inputs, scripts and source stayed unchanged except the explicitly requested analysis-script write in case 06. Case 04 ran a reviewed read-only Python computation; it did not apply the proposed remediation.

Host dispatch is matched using the canonical tool name and arguments, the journal fingerprint, and the conversation's time window. Output equality is checked separately. Locally retained journals provide independent host observations, not provider-signed attestations. Published records redact personal paths, other devices, and private control metadata; hashes identify the retained originals. Conversation links require access to the owner's account.

## Baseline outcomes

| Case | Observed result | Exported calls |
| --- | --- | ---: |
| 01 Evidence synthesis | Pass: rejected an outdated release proposal using newer failed validation | 6 |
| 02 Large-file retrieval | Incomplete: could not reach the final rollback event beyond the byte cap | 33 |
| 03 Configuration review | Correct differences; qualified result because the claimed verification denial was uncorroborated | 5 |
| 04 Incident diagnosis | Pass: correct duplicate-export cause and read-only computation, exit 0 | 7 |
| 05 Decimal sales analysis | Incomplete: reported a write denial; no analysis script, process, or result appeared | 3 |
| 06 Latency analysis | Incomplete: script write verified, reported process denial; no execution or saved result | 4 |
| 07 Inventory reconciliation | Not submitted after the conservative stopping rule | — |
| 08 Interval code repair | Not submitted | — |
| 09 Pagination code repair | Not submitted | — |
| 10 Dependency-order repair | Not submitted | — |
| 11 Four-worker execution | Not submitted | — |
| 12 Four-worker partial failure | Not submitted | — |
| 13 Fresh-chat large-file recovery | Incomplete: reproduced the reader limit and correctly qualified missing evidence | 24 |
| 14 Fresh-chat inventory recovery | Pass for absence detection and static reconciliation; no completed job recovered | 8 |
| 15 Fresh-chat code recovery | Pass for static bug review; explicitly no executed tests or repair | 3 |
| 16 Fresh-chat batch recovery | Pass for absent-batch reporting; no worker execution recovered | 2 |

Two of the six submitted primary tasks completed fully. Four were incomplete or had reporting problems. Three of four recovery checks satisfied their limited absence/static-review contracts; none demonstrated recovery of a completed analysis, repaired program, or multi-agent job. Combining these different outcomes into a single general reliability percentage would be misleading.

Cases 03, 05 and 06 **reported** safety denials in their final answers. The alleged denied calls are absent from the tool exports and host process/receipt records. An unexported pre-dispatch denial cannot be excluded; these are neither confirmed platform-denial events nor confirmed fabricated calls. The two intended mutation tasks triggered the stopping rule conservatively based on their reports. The remaining six mutation tasks were not evaluated. Their code-evaluator controls were validated independently against known correct and seeded incorrect implementations; those controls are not ChatGPT repair results.

## Export fidelity and environment observations

All **95 exported baseline call fingerprints** match finished host journals. Of their exported outputs, **89 match exactly** and one differs only by ChatGPT's added `is_error` annotation. Case 14 contains **four null outputs and one misattributed output**: a `counted.json` result appears under the `reconcile.py` request. The corresponding host journals preserve the actual file results and missing-file errors. The final absence/static-reconciliation answer is consistent with those host results.

Case 16's export omits the collection error entirely. A separate finished host journal records `agent batch not found: ce20-11-parallel-batch` at 15:30:46 UTC. This corroborates the final answer without inventing worker identities or successful execution. Export counts therefore do not capture every host observation.

At 15:31:38 UTC ChatGPT displayed **Too many requests** after the tenth baseline conversation finished. No new prompt was submitted during cooldown. At 15:42 UTC the informational dialog was acknowledged and the existing conversation exported through the same client. A slow earlier trace-export control also required reopening the same completed conversation in an existing page; no prompt was resubmitted. Collection timestamps include observation/export delays and are not latency benchmarks.

## Reader defect and separate repair confirmation

The original reader clipped the file to the response byte budget **before** applying line offsets. On a 102,660-byte, 1,300-line archive, the 65,536-byte MCP cap exposed only 830 complete lines. A direct runtime check requesting offset 1200 returned zero bytes instead of the expected 7,894. Both baseline conversations correctly refused to invent the unreachable final event.

Runtime **1.5.0-rc.3** resolves line positions with a fixed-size scanning buffer before limiting returned bytes. It adds `offset`, `returnedLines`, `nextOffset`, `hasMore`, and `partialLastLine`. A byte-limited partial line is retained for the next request instead of being skipped. UTF-8 character and CRLF boundaries are preserved. Negative offsets locate the actual whole-file tail; binary reads retain prefix-byte behavior. A single line larger than the response cap may remain incomplete. Reads are not atomic snapshots of files being concurrently modified.

The repaired connector **0.1.2**, HTTPS frontend, channel and pinned Mac runtime were aligned before the new prompts. An intermediate stale catalog version was corrected before testing; the earlier unexecuted repair protocol remains recorded as superseded. Final runtime SHA-256: `85d87aeca2d2f4c5c9b61ff72fd8e1c0f92d2388c10aad42335ae5dfdc5f200f`. Final connector SHA-256: `cf060ded9e13d2ae14c5e3e7488e78962088daef8d0c3395c82732086deb48cb`.

| Separate check | Real-chat and host-verified outcome | Calls |
| --- | --- | ---: |
| [17 Same archive after repair](https://chatgpt.com/c/6aafffa4-7fbc-83ed-bb6c-15bbde459f2c) | All 1,300 lines observed, all three events found, final state `rolled_back`, restored release `atlas-21`, EOF checked | 17 |
| [18 Unicode tail](https://chatgpt.com/c/6ab00084-43a4-83ed-ab8e-a0431da69183) | Exact final three records from a 1,800-line UTF-8/CRLF file, accents and emoji preserved, size 97,893 bytes | 4 |

Both checks passed, with **21/21 exact export-to-host output matches**, unchanged inputs, no writes/process launches, no corrective prompts, and no supervisor approval clicks. Case 17 is a same-byte regression retest, not an untouched holdout. Case 18 is a separately generated boundary check. Neither replaces the failed baseline or establishes broad repaired-release reliability.

## Reproduce and inspect

From the release source checkout, run:

```sh
node scripts/verify-chat-efficacy.mjs
python3 scripts/chat-efficacy/generate-fixtures.py /tmp/navish-efficacy-fixtures
node scripts/verify-chat-efficacy.mjs evidence/chat-efficacy-extra-high-20260920.json /tmp/navish-efficacy-fixtures
```

The destination must not exist. Fixture generation performs no chat submissions or Commander calls. It reproduces all 52 original baseline input hashes. The evidence includes the exact repair inputs separately. The verifier checks source binding, assignment counts, input preservation, mode records, scoped calls, host/output comparisons, final semantic predicates, and actual line coverage. A successful exit means the **record is consistent**, including its failures; it does not grant certification or rerun live conversations.

The repair passes **117 runtime/MCP tests**, including 11 new pagination regressions and a new MCP integration test, plus **24 tests against the extracted bundle**. The extracted rc.3 plugin passed strict Claude manifest validation and a real `claude --plugin-dir … mcp list` connection check from outside the checkout. This establishes host loading and MCP connectivity, not a Claude model conversation. The first local full-suite attempt failed two Python-crypto tests because the new worktree lacked its test environment; reusing the existing environment resolved that prerequisite. Public CI checks the supported macOS/Linux and Node matrix. Current package integrity is separate from the historical rc.2 comparison gates; the strict historical source verifier correctly rejects changed rc.3 bytes.

The old ≥2× deterministic-worker RDC benchmarks remain tied to rc.2/0.1.1. This evaluation has **no model-mediated RDC comparison**, no completed new multi-agent trial, no long-duration production soak, no Claude model conversation, and no public directory approval. Unattended execution across arbitrary chat tasks remains unestablished. External Markup AI review was unavailable because the configured token had no associated organization; this report received local evidence review.
