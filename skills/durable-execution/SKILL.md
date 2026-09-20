---
name: durable-execution
description: Run authorized file, process, and independent worker-batch tasks through Navish Commander; recover known work after an interrupted tool response.
---

Use Commander when the user requests execution on a configured machine. Discover exact IDs with `commander_devices`; `local` is the machine hosting the MCP server. Do not infer a remote target from list order.

Before a mutation, choose a stable call ID and, for processes or batches, a stable session or batch ID. Keep the same intent and identity through a lost response. Inspect `commander_receipt`, `commander_process_output`, or `commander_collect_batch` to recover known work. An uncertain outcome does not authorize a replacement mutation.

Use absolute paths and explicit working directories. Parallel workers that edit files need separate working directories or a proven non-overlapping scope. Supply expected artifact hashes when outputs are known. Commander's workers execute the commands you provide; they are not automatically language-model agents, and this plugin supplies no model credentials or paid capacity.

Set `transport: "pipe"` on each noninteractive process or batch worker. Use `transport: "pty"` for programs that require a terminal, such as interactive REPLs. Omission preserves the older PTY behavior. Pipe workers also retain durable identities and output across client restarts. For short jobs, use the bounded `wait_ms` option and check whether the launch already returned a completed operation before making a collection call.

Distinguish a completed observation from a completed task. Check `operationState`, all exit codes, and expected output or artifacts. Report unknown, failed, running, and completed states accurately. Cancel only when authorized. Do not run unrelated jobs, modify permissions, install services, send messages, or spend money merely because the execution tools are available.

This local MCP server runs with its operating-system account permissions. It is not a sandbox. Existing scientific admission, ownership, protected-data and cost constraints still apply. Do not put credentials in shell commands, tool arguments, receipts intended for sharing, or published evidence.
