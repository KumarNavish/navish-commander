# Conversation acceptance

## Full-access personal ChatGPT check, 20 September 2026

The owner explicitly requested **Allow all actions** for Navish Commander. Plugin Management returned `app_permission_mode: full_access` and `status: updated`. This setting applies to that personal app; global defaults and other apps were not changed. No new spending occurred.

A fresh ordinary chat used the installed 0.1.1 connector without a manual app mention. Its exact append and four-worker batch eventually completed. Two successful identical append calls shared one durable receipt and produced one 13-byte line. All four workers exited zero, their artifacts matched the frozen SHA-256 values, and their execution intervals overlapped by 2.042 seconds. The host retained two mutation receipts and four completed process records.

**The unattended acceptance gate failed.** The downloaded record contains 33 tool calls and nine explicit OpenAI safety blocks: two append attempts, two batch attempts, and five attempts to launch the separate `exit 7` worker. The model retried denied intents with the same IDs after checking state. That behavior is recorded, not endorsed as an acceptable recovery strategy. A platform denial must not be treated as an uncertain transport response or permission to retry through another route. No supervising approval or corrective message was sent during the run. The failure session remained unsubmitted and had no host receipt or process record.

A second, fresh chat made six read-only calls and recovered the original append, receipt, batch, worker identities, exit codes, and hashes. All six calls matched fresh agent-journal fingerprints. The rejected failure session remained unsubmitted. Artifact hashes, mutation receipt hashes, batch metadata, and process metadata were unchanged across this conversation.

The UI export has an additional evidence limitation: four outputs in the first conversation and three in recovery are null, and the last parallel call in each is associated with a different call's result. The published record preserves these anomalies. Null or misattributed outputs are not counted as executions. Matching earlier outputs, six recovery journal records, and independent host observations establish the results above.

The [sanitized record](../evidence/chatgpt-full-access-20260920.json) includes both prompts, model conclusions, exported calls, journal observations, raw-source hashes, and independent predicates. Run `node scripts/verify-chat-full-access.mjs` to check their consistency. Its successful exit verifies the recorded **blocked** outcome; it does not certify unattended execution or remove platform safeguards.

OpenAI's [additional-check documentation](https://help.openai.com/en/articles/20001326) explains that automated checks may delay or prevent a response. The live tool error supplied no more specific cause. The setting change is complete; full unattended ChatGPT certification remains unachieved.

## Personal ChatGPT HTTPS connector, 20 September 2026

A fresh ordinary ChatGPT chat, using the existing Pro subscription, automatically discovered Navish Commander without an app mention and read the exact undisclosed fixture line from the Mac. Owner OAuth and all eleven tool definitions were observed in the real ChatGPT UI. Global personalization was saved and read back, including the instruction to use existing subscriptions/free tiers and incur no new spending. Personal settings and their original backup remain private.

The follow-up mutation test did **not** pass. The model used the earlier opaque proof as the append content instead of the requested literal `exactly-once`. Its first append completed. The second identical call triggered an opaque-payload review, which the supervising acceptance run denied. OpenAI's safety checks separately blocked a batch launch before dispatch. The model reported further blocked attempts; these are not counted as executions. Independent inspection found a single 55-byte append and no worker artifacts. The low-risk permission default was preserved. The [sanitized tool trace](../evidence/personal-connector-acceptance.json) retains the adverse evidence.

Separately, a real OAuth/HTTPS protocol client against the deployed relay passed a fresh file challenge, a repeated append across a new client connection, and four parallel workers with independently verified hashes. The agent was then updated after checking that its journal and queue had no in-flight work; fresh protocol checks passed again. This proves transport/runtime behavior, not an unattended ChatGPT workflow or universal agent reliability.

## Packaged local MCP client, rc.2

The user selected another already-authorized client after Claude Desktop reached its message limit. Codex CLI 0.155.0-alpha.9.2, authenticated through the existing ChatGPT login, then exercised the extracted rc.2 package through its real MCP tool path. No extra credits or model subscriptions were purchased.

The first configuration used `approval_policy=never`, which caused the client to refuse mutation tools before dispatch. The successful run used normal automatic review (`--approve-for-me`) with the same stable operation IDs. No denied safety review was bypassed. This configuration failure remains in the evidence.

The initial conversation made eight tool calls and verified a single append despite repeating the same call ID, four pipe workers with declared output hashes, stable batch collection, and a worker failure with exit code 7. The client exited. A second conversation connected a new client process, made four read-only calls, and recovered the same results. Independent filesystem checks confirmed one append, all four hashes, exactly three mutation receipts, five sessions, and unchanged process identities and terminal records across reconnect.

[The sanitized trace](../evidence/chat-client-rc2.json) contains both prompts, all twelve tool calls and results, model conclusions, private raw-trace hashes, the runtime digest, and the independently checked predicates. Paths are normalized; hidden model reasoning is omitted. Tool-level error indications for the deliberately failed worker are expected and were reported correctly by the model.

The actual Claude Code host separately loaded the same extracted plugin and reported its MCP server connected. Claude Desktop GUI installation and conversational use remain unobserved. This is one initial conversation plus one reconnect conversation, not a model-mediated completion-rate comparison with RDC. Controlled delivery benchmarks measure execution behavior under specified faults, not general chat reliability.

To repeat the client check, use an isolated fixture directory and stable IDs. Discover the local device; append once under the same call ID twice; launch four pipe workers with separate directories and known artifact hashes; reconnect and collect without relaunch; and accurately report a worker that exits 7. Retain the private conversation and durable receipts, then publish only fixture data. Use the same model and prompts against RDC before making any model-mediated comparative reliability claim.
