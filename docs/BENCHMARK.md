# Compare complete outcomes

The requested comparator is **Remote Desktop Commander**. The targets are at least 50% fewer failed or unresolved workflows and at least twice the completed-work throughput. A lower tool-call count alone is insufficient.

## Hosted execution-route comparison

`scripts/benchmark-hosted-rdc.mjs` authenticates to the real hosted RDC MCP endpoint. It compares four simultaneous RDC workers with one four-worker Commander batch on the same Mac. Each worker waits 0.20 seconds, writes a deterministic artifact, and appends exactly one effect marker. Both products must report successful exits and satisfy identical independent file predicates. RDC calls run concurrently.

The chosen local Commander transport is `pipe`; this is an explicit product option for noninteractive work. Existing PTY behavior remains available. RDC uses its installed normal process implementation. The hosted service advertised version 1.0.0 and the selected device advertised 0.2.48 during initial checks; the report records those values. The separate local comparator is the newer pinned npm version 0.2.51. These versions and routes must not be conflated.

Twenty paired rounds alternate product order. MCP initialization is outside timing for both products. Launch, collection, independent verification, and client close are inside. Two wait policies are measured separately: staged submission/collection and inline completion with a 1,000 ms initial wait available to both products. If RDC's initial response lacks a successful exit status, collection is still required. Commander may finish in its initial bounded batch wait.

The report freezes source and harness hashes before execution, checks that source stayed unchanged, and records all samples, median, p95, tool counts, and a paired percentile bootstrap interval (10,000 resamples, seed 1729). A pass requires every outcome to verify and the lower 95% interval bound to exceed 2×. Reports from development are retained separately. Repeated measurements of one workload do not establish performance across arbitrary tasks.

```sh
node scripts/rdc-auth.mjs
# Open the generated authorization URL using your own RDC account.
# Use the exact device ID for the local benchmark host, never a research gateway.
RDC_BENCH_DEVICE=YOUR_MAC_DEVICE_ID BENCH_TRANSPORT=pipe BENCH_ROUNDS=20 \
  BENCH_REPORT=evidence/my-staged-run.json node scripts/benchmark-hosted-rdc.mjs
RDC_BENCH_DEVICE=YOUR_MAC_DEVICE_ID BENCH_TRANSPORT=pipe BENCH_WAIT_POLICY=inline \
  BENCH_ROUNDS=20 BENCH_REPORT=evidence/my-inline-run.json node scripts/benchmark-hosted-rdc.mjs
```

OAuth credentials stay in ignored `.bench/rdc-auth/`, with private file permissions. The harness verifies the host by reading an isolated nonce file through the selected RDC device. It uses only temporary fixture files and finite jobs. It does not restart the device agent or alter existing jobs.

## Controlled delivery faults

`scripts/benchmark-delivery.mjs` uses ten normal, ten duplicate-delivery, and ten client-reconnect workflows per product. The workflow appends one line and reads it back. The independent predicate requires exactly one line on disk. Duplicate delivery sends the identical MCP message, including JSON-RPC ID, twice concurrently; it does not invent a second user intent. The final observation waits for both sends to settle. Reconnect closes the client after an acknowledged append, reconnects, and observes without replaying the mutation.

This compares native duplicate protection without adding a caller-written idempotency framework to RDC. The failure-reduction gate applies only to this fixed fault mixture. It is not a production failure estimate, an LLM evaluation, or evidence that RDC normally retries mutations incorrectly.

```sh
RDC_BENCH_DEVICE=YOUR_MAC_DEVICE_ID BENCH_ROUNDS=10 \
  BENCH_REPORT=evidence/my-delivery-run.json node scripts/benchmark-delivery.mjs
```

## Local diagnostic and evidence boundary

`scripts/benchmark.mjs` preserves the original same-host stdio comparison with `@wonderwhy-er/desktop-commander@0.2.51`. Both sides have isolated homes, the same commands, four concurrent workers, ten normal rounds and four MCP-server restarts. `BENCH_TRANSPORT=pipe` selects the new noninteractive supervisor; omission preserves the older PTY diagnostic. Do not combine server restarts with client reconnects as if they were the same fault.

```sh
npm install --prefix .bench/baseline --ignore-scripts --no-audit --no-fund @wonderwhy-er/desktop-commander@0.2.51
npm run benchmark
```

The hosted-route results include the architectural advantage of local execution avoiding a cloud relay. They do not establish equal-network-hop performance, a hosted Navish service, model-driven multi-agent productivity, or a general chat reliability ratio. Real conversation tests must use matched clients/models and independently verified outputs before extending the claim to those settings.
