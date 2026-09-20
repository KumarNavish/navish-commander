# Repository jobs from chat

Give Commander a bounded engineering goal, the absolute repository root, and
the checks that should pass. `commander_start_job` returns a durable `jobId`.
Commander creates a detached Git worktree at the recorded HEAD, uses the
existing ChatGPT-authenticated Codex CLI to implement the change, and runs the
declared checks independently in the Codex workspace sandbox.

For example: “In my Commander repository, add a read-only CLI command to find
and inspect durable jobs. Add focused regression tests and return the patch.”
The client supplies the repository and the appropriate test command as argv,
such as `["node", "--test", "test/job-cli.test.mjs"]`.

The source checkout's uncommitted changes are **not** copied. The job records
the base commit and retains its isolated checkout. It does not commit, push,
deploy, publish, or merge on the user's behalf.

## Recover without reconstructing the conversation

Call `commander_job_status` with the same `jobId`. If the chat lost that ID,
`commander_jobs` lists recent jobs. Reads return current state and do not start
work or create mutation receipts. `includePatch: true` returns the patch;
larger patches continue at `patch.nextOffset`.

The local terminal can recover the same durable records without a chat session:

```sh
navish jobs
navish jobs --limit 5
navish job my-job
navish job my-job --patch
```

Replace `my-job` with the returned `jobId`. `jobs` lists the newest jobs first,
defaults to 10 results, and accepts a decimal integer `--limit` from 1 to 50.
`job` requires one ID; extra arguments, unknown or repeated flags, and malformed
limits are errors. IDs use 1 to 100 letters, digits, dots, underscores or hyphens,
cannot be `.` or `..`, and cannot start with a hyphen in this CLI.

Both commands print the repeatable observation API's JSON envelope: the list is
at `result.jobs`, and a single job's lifecycle state is at `result.state`.
Each invocation reads current state. These commands observe local state only,
using the normal `NAVISH_CONFIG_DIR`, `NAVISH_STATE_DIR` and `NAVISH_DATA_DIR`
settings. They do not start, cancel or resume jobs or create mutation receipts.
Normal configuration initialization and observation audit logging still apply.

`--patch` includes `result.patch` for terminal jobs and reads at most the first
16,384 bytes. Its `output`, `offset`, `nextOffset`, `totalBytes` and `truncated`
fields identify the returned window. A missing patch file returns an empty
window; active and unsubmitted jobs have no `patch` field. Larger patches can
be continued through `commander_job_status` with `includePatch: true`,
`patchOffset` set to the previous `nextOffset`, and `maxPatchBytes: 16384`.

Exit statuses for `navish jobs` and `navish job`:

| Exit status | Meaning |
| --- | --- |
| `0` | Observation succeeded, including an empty list or an unknown ID (`result.state: "unsubmitted"`). A job in `needs_attention`, `cancelled` or `uncertain` also returns `0`: inspect `result.state` to assess the job. |
| `1` | Invalid CLI arguments or an unexpected CLI error. A diagnostic is written to stderr. |
| `2` | Observation failed, for example because a durable record could not be read or parsed. The JSON envelope has `state: "failed"` and a `reason`. |

An observation's success is not a claim that the engineering goal is complete.

| State | What is observed |
| --- | --- |
| `launching` / `running` | The executor is being started or is still working. |
| `review_ready` | Executor finished, reported completion, all declared checks passed, and the patch was captured. Review is still required to establish goal correctness. |
| `needs_attention` | Execution, reporting, checks or collection did not complete successfully. Partial changes and available evidence are retained. |
| `cancelled` | The owned executor stopped after cancellation; partial changes are retained. |
| `uncertain` | Terminal evidence is missing. Inspect the retained workspace and logs; Commander will not relaunch the job. |

Keep both `callId` and `jobId` stable. Repeating an identical job returns its
existing state, including after failure. A different goal or check contract
under the same job ID is rejected. A timeout, denial or lost response is never
permission to submit the same intent with a new identity.

`commander_cancel_job` records a cancellation request. Read status to observe
the executor stopping. There is no automatic resume, self-retry or mutation
replay in this release. Retained Codex thread IDs are diagnostic references.

## Execution and cost

Requires a Git repository and an installed Codex CLI already logged in using
ChatGPT. Commander requests `xhigh` reasoning with the user's configured Codex
model. The tested interface is documented in the official
[noninteractive Codex reference](https://learn.chatgpt.com/docs/developer-commands#codex-exec).
Subscription usage limits still apply. Commander neither provisions API keys
nor falls back to API billing; API/provider credential environment variables
are removed from executor processes and ChatGPT login is required.

The job uses `workspace-write`, disables shell network access and external MCP
tools for that invocation, and preserves ordinary project rules, hooks and
managed requirements. It does not change global Codex or ChatGPT permissions.
Declared checks run only after a successful executor report; a denied or
blocked executor does not trigger an alternate execution path. This restriction
means dependency downloads or tasks needing an external connector can require
attention. Existing raw Commander process tools retain their documented OS
permissions; they are separate from this executor.

Private plans, lifecycle records, check output, executor logs and patches live
under Commander's state directory. Worktrees live under its data directory.
`NAVISH_CODEX_EXECUTABLE` may select an existing CLI locally; an MCP request
cannot supply an executable or override the execution policy.

## Evidence boundaries

Deterministic tests use a fake CLI with no model or network. They exercise real
Git worktrees, subprocesses, MCP disconnects, patch application, check failures,
cancellation and duplicate suppression. These establish lifecycle behavior,
not model efficacy or live ChatGPT certification. Live acceptance is recorded
separately. Earlier RDC comparisons remain bound to their original source.
