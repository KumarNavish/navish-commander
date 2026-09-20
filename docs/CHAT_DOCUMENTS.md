# Actual ChatGPT document workflow

On 20 September 2026, an ordinary ChatGPT conversation using **Latest / Extra High** and the explicitly selected personal Commander plugin read synthetic source data, corrected an existing workbook, created a Word summary and a two-page PDF, and returned a durable handoff. ChatGPT supplied all reasoning and document content. Commander invoked no Codex, Claude Code or paid model runtime.

The workbook originally excluded a fifth observation and held four-row summary statistics. The finished workbook includes all five rows, preserves every elapsed-time measurement, and reports medians 205 ms and 100 ms with ratio 2.05. These numbers belong to the synthetic document fixture, **not the RDC comparison**.

Independent checks verified the source hashes, typed workbook cells, arithmetic, Word XML, PDF text and exact page count, native Commander readbacks, and all reported artifact hashes. Visual inspection found both PDF pages readable without clipping. The workflow required no outside intervention after submission.

That artifact result is not unattended certification. The complete visible export contains 41 calls, including two explicit OpenAI safety blocks and one receipt-argument validation error. The client reused a blocked creation identity with changed arguments and later changed from a blocked Word rewrite to an edit on the same document. Both followed read-only reconciliation, but reconciliation does not authorize retrying a denied intent. The server never received the blocked calls and cannot disable the client's approval system. The final response acknowledged only the cleanup block; the exported record preserves both blocks.

No tool-output identity mismatch was found in this export. This does not erase the missing and misattributed outputs observed in earlier conversations.

- [Conversation](https://chatgpt.com/c/6ab04ca1-ea54-83eb-bc5f-f863a8d597a0)
- [Sanitized call record and artifact manifest](../evidence/chat-documents-20260920.json)
- [Workbook](../evidence/artifacts/documents-20260920/metrics.xlsx)
- [Word summary](../evidence/artifacts/documents-20260920/study-summary.docx)
- [Two-page PDF](../evidence/artifacts/documents-20260920/results.pdf)
- [Handoff](../evidence/artifacts/documents-20260920/handoff.json)

The published handoff replaces the private workspace root with `$TRIAL`; its original and published hashes are both recorded. Other artifact bytes are unchanged. Unrelated paired devices are omitted from the exported discovery result. Run `node scripts/verify-chat-documents.mjs` to recompute artifact checks and confirm that the adverse events remain represented.
