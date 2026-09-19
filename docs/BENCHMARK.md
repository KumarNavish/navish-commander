# Compare complete outcomes

The requested comparator is **Remote Desktop Commander**. The acceptance targets are at least a 50% reduction in failed or unresolved complete workflows and at least twice the completed-work throughput on identical multi-worker workloads. Neither target may substitute for the other.

## Local diagnostic

`scripts/benchmark.mjs` compares Commander over stdio MCP with `@wonderwhy-er/desktop-commander@0.2.51` over stdio MCP on the same host. It uses four concurrent deterministic workers, equal shell commands, separate temporary directories, exact output checks, and one-effect markers. Both sides may issue concurrent tool calls. There is no artificial serial baseline and no paid model call.

The harness alternates execution order. It runs ten uninterrupted rounds per backend and four reconnect rounds per backend. Startup is excluded for both; reconnect and final client close are included. Throughput compares median elapsed times of uninterrupted rounds and requires every Commander round to verify. Reconnect outcomes are reported separately. The mix is a fixed diagnostic, not an estimate of everyday failure prevalence.

This measures execution mechanics. It does not measure the hosted Remote Desktop Commander relay, ChatGPT or Claude planning, model-generated coordination, network faults, provider quality, or a representative production failure rate. Finite descriptive counts do not establish a universal reliability advantage. Zero observed failures does not prove zero risk.

Install and run the pinned local baseline without changing an existing installation:

```sh
npm install --prefix .bench/baseline --ignore-scripts --no-audit --no-fund @wonderwhy-er/desktop-commander@0.2.51
npm run benchmark
```

The baseline's telemetry is disabled by environment and isolated config. Samples contain only timings, test identities, counts, and outcomes. Raw user state is never part of the workload. Temporary test directories are retained for diagnosis; no cleanup kills unrelated workers.

## Remote certification gate

Run both products from fresh conversations using the same model, resource limits, machine, prompts, and artifact predicates. Freeze the task set and failure-injection schedule first. Include file lifecycle, interrupted responses, reconnect, long-running jobs, concurrent workers, failures, and real browser workflows. Preserve failed trials and command/result identities. Report denominators, latency distribution, confidence intervals, duplicates, and unresolved effects.

The current task has no callable authenticated RDC connector. Local Desktop Commander measurements must not be relabeled as Remote Desktop Commander measurements. Until the remote comparator and both real chat-client paths are exercised, the requested certification remains blocked regardless of local improvements.
