# Conversation acceptance

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
