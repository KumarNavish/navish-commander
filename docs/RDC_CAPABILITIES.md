# RDC capability coverage

The acceptance baseline is the live Remote Desktop Commander catalog observed
on 20 and 21 September 2026: 30 tools (Mac agent 0.2.48). A higher tool count
alone is not capability parity. Candidate 1.6.0-rc.5 exposes 35 tools directly
to Claude, ChatGPT and other MCP clients. The chat supplies reasoning and code;
execution does not launch another model.

| RDC capability | Current Commander route | Limit |
| --- | --- | --- |
| Device discovery, configuration, ping | `commander_devices`, `commander_get_config`, `commander_set_config_value`, `commander_ping` | Commander pairings are separate from RDC pairings; the RDC research gateway is not silently substituted |
| Text reads and multiple files | `commander_read_file`, `commander_read_multiple_files` | Bounded text, DOCX, XLSX, PDF, native images and explicit HTTP(S) URLs; up to 64 KiB per file in multi-file reads; inspect truncation |
| Write, create directory, list directory, move | Corresponding `commander_*` tools | Directory output is explicitly bounded |
| File metadata | `commander_get_file_info` | SHA-256, `wc -l` line counts, PDF page counts, DOCX and spreadsheet metadata |
| Surgical text editing | `commander_edit_block` | Exact text and DOCX XML replacement; XLSX range edits; staged validation, optional source hash, preserved permissions; a failed match reports the closest text with a character diff |
| Search start, pagination, stop, list | Corresponding `commander_*search*` tools | Persistent sessions; regex or literal matching; filename glob filter; skips symlinks, binary content and content files over 16 MiB; reports skipped files/truncation |
| Process launch, output and interactive input | `commander_start_process`, `commander_process_output`, `commander_interact_with_process` | Stable session identity and duplicate-input suppression; up to 10 s inline wait at launch; `wait_ms` waits for new output; output uses byte offsets |
| Blocked commands and shell selection | `blockedCommands` and `defaultShell` in `commander_set_config_value` | RDC's default list; checked before any launch claim for processes and batch workers; an empty list disables it |
| Sessions, processes, owned termination, PID signal | `commander_list_sessions`, `commander_list_processes`, `commander_force_terminate`, `commander_kill_process` | Newest sessions first with a total; listing omits saved environment and command bodies; PID signaling needs authorization for that process |
| Usage and recent calls | `commander_get_usage_stats`, `commander_get_recent_tool_calls` | Durable audit events; `includeArguments` adds this instance's bounded arguments and outputs (lost on restart), like RDC's in-memory history |
| PDF creation/editing | `commander_write_pdf` | Markdown/HTML creation, ordered page insertion/deletion; edits preserve original; installed Chrome required for rendering |
| RDC identity/billing, shutdown, onboarding prompts and feedback | No equivalent account/control UI | Product-specific features remain distinct |

Commander additionally exposes bounded Ego browser workflows, durable receipts
with `commander_receipt` and `commander_reconcile`, and parallel command
batches. RDC has no equivalents. These additions do not offset a missing
baseline capability or prove a 2× improvement.

## Hosts

The Claude Desktop extension runs as an Electron utility process on Claude's
built-in Node, where `process.execPath` is the Claude application binary and
modules load several times slower than under a plain Node. Detached supervisors
and the search runner therefore use a resolved Node.js 22.16+ executable
(`NAVISH_NODE`, a plain `node` execPath, PATH, then `/usr/local/bin`,
`/opt/homebrew/bin` and `/usr/bin`), reported by `commander_devices` as
`processRuntime.nodeExecutable`. Document engines are warmed after connect.
`test/claude-host-parity.test.mjs` runs the real MCP server from a Node binary
named like an application to keep this working.

`test/rdc-core-parity.test.mjs` exercises the real stdio MCP interface against
isolated files and owned processes. It covers a full file-edit workflow, search
reconnection and pagination, search cancellation and timeout, and duplicate-free
interactive input across client restart. Document round trips and reconnect
tests are in `test/document-parity.test.mjs`. Automated protocol checks are
separate from an actual model conversation; the first real Claude conversation
is recorded in the acceptance ledger. No full unattended certification is claimed.
See [document formats](DOCUMENTS.md) for limits and upstream attribution.
