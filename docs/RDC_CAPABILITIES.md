# RDC capability coverage

The acceptance baseline is the live Remote Desktop Commander catalog observed
on 20 September 2026: 30 tools. A higher tool count alone is not capability parity.
Commander 1.6.0-rc.3 exposes 32 tools directly to ChatGPT and other MCP clients.
The chat supplies reasoning and code; execution does not launch another model.

| RDC capability | Current Commander route | Limit |
| --- | --- | --- |
| Device discovery and configuration | `commander_devices`, `commander_get_config`, `commander_set_config_value` | Commander pairings are separate from RDC pairings; the RDC research gateway is not silently substituted |
| Text reads and multiple files | `commander_read_file`, `commander_read_multiple_files` | Bounded UTF-8 reads; rich document conversion and URL reading remain gaps |
| Write, create directory, list directory, move | Corresponding `commander_*` tools | Directory output is explicitly bounded |
| File metadata | `commander_get_file_info` | Includes SHA-256 and text line counts; spreadsheet sheet metadata remains a gap |
| Surgical text editing | `commander_edit_block` | Exact-match count, optional source hash, atomic replacement, preserved permissions; no spreadsheet or DOCX editing |
| Search start, pagination, stop, list | Corresponding `commander_*search*` tools | Persistent sessions; regex or literal matching; filename glob filter; skips symlinks, binary content and content files over 16 MiB; reports skipped files/truncation |
| Process launch, output and interactive input | `commander_start_process`, `commander_process_output`, `commander_interact_with_process` | Stable session identity and duplicate-input suppression; output uses byte offsets |
| Sessions, processes, owned termination, PID signal | `commander_list_sessions`, `commander_list_processes`, `commander_force_terminate`, `commander_kill_process` | Session listing omits saved environment and command bodies; PID signaling needs authorization for that process |
| Usage and recent calls | `commander_get_usage_stats`, `commander_get_recent_tool_calls` | Commander execution telemetry, not RDC account billing |
| PDF creation/editing | No dedicated tool yet | Gap |
| RDC identity/billing, shutdown, onboarding prompts and feedback | No equivalent account/control UI | Product-specific features remain distinct |

Commander also exposes bounded Ego browser workflows, durable receipts and
parallel command batches. These additions do not offset a missing baseline
capability or prove a 2× improvement.

`test/rdc-core-parity.test.mjs` exercises the real stdio MCP interface against
isolated files and owned processes. It covers a full file-edit workflow, search
reconnection and pagination, search cancellation and timeout, and duplicate-free
interactive input across client restart. Automated protocol checks are separate
from an actual model conversation. No full unattended certification is claimed.
