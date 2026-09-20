# Conversation acceptance

The user selected another already-authorized client after Claude Desktop reached its message limit. Codex CLI 0.155.0-alpha.9.2, authenticated through the existing ChatGPT login, then exercised the extracted rc.2 package through its real MCP tool path. No extra credits or model subscriptions were purchased.

The first configuration used `approval_policy=never`, which caused the client to refuse mutation tools before dispatch. The successful run used normal automatic review (`--approve-for-me`) with the same stable operation IDs. No denied safety review was bypassed. This configuration failure remains in the evidence.

The initial conversation made eight tool calls and verified a single append despite repeating the same call ID, four pipe workers with declared output hashes, stable batch collection, and a worker failure with exit code 7. The client exited. A second conversation connected a new client process, made four read-only calls, and recovered the same results. Independent filesystem checks confirmed one append, all four hashes, exactly three mutation receipts, five sessions, and unchanged process identities and terminal records across reconnect.

[The sanitized trace](../evidence/chat-client-rc2.json) contains both prompts, all twelve tool calls and results, model conclusions, private raw-trace hashes, the runtime digest, and the independently checked predicates. Paths are normalized; hidden model reasoning is omitted. Tool-level error indications for the deliberately failed worker are expected and were reported correctly by the model.

The actual Claude Code host separately loaded the same extracted plugin and reported its MCP server connected. Claude Desktop GUI installation and conversational use remain unobserved. This is one initial conversation plus one reconnect conversation, not a model-mediated completion-rate comparison with RDC. Controlled delivery benchmarks measure execution behavior under specified faults, not general chat reliability.

To repeat the client check, use an isolated fixture directory and stable IDs. Discover the local device; append once under the same call ID twice; launch four pipe workers with separate directories and known artifact hashes; reconnect and collect without relaunch; and accurately report a worker that exits 7. Retain the private conversation and durable receipts, then publish only fixture data. Use the same model and prompts against RDC before making any model-mediated comparative reliability claim.
