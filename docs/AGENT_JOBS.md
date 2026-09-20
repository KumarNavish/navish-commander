# Historical repository-job recovery

The model-backed repository executor introduced in 1.6.0-rc.1 was removed in
1.6.0-rc.2. It invoked Codex and consumed Codex allowance, which contradicted the
intended workflow: ChatGPT supplies reasoning and Commander executes its explicit
authorized operations. `commander_start_job` is no longer offered. Stale runtime
`agent_job_start` requests fail with `CODEX_EXECUTION_REMOVED` before model
lookup, login checks, worktree creation or launch.

Existing records and patches are preserved. Use `commander_jobs` to list them,
`commander_job_status` to read their current status and bounded patch windows,
and `commander_cancel_job` to request stopping an already-owned historical job.
Cancellation is a request; read status to observe its effect. No job is resumed
or replayed.

The terminal equivalents remain:

```sh
navish jobs --limit 5
navish job JOB_ID --patch
```

Status and list observations are repeatable and do not create mutation receipts.
A successful observation is not a successful engineering task. Original
`review_ready`, `needs_attention`, `cancelled` and `uncertain` states retain their
original meaning and evidence; none is relabelled because the architecture was
removed. Missing terminal evidence remains uncertain.

A patch window includes `nextOffset` and `truncated`. Continue large patches via
`commander_job_status` with `includePatch: true` and `patchOffset: nextOffset`.
`integration.state: not_observed` means these records do not establish whether
another actor later applied, merged or published the patch.

The [original chat job record](../evidence/chat-repository-job-20260920.json) and
[unaltered patch](../evidence/patches/chat-readme-20260920.patch) remain historical
artifacts. They are not evidence of Codex-free chat execution.
