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

The original local-plugin hosted-route results include the architectural advantage of local execution avoiding a cloud relay. They do not establish equal-network-hop performance, a hosted Navish service, model-driven multi-agent productivity, or a general chat reliability ratio. Real conversation tests must use matched clients/models and independently verified outputs before extending the claim to those settings.

## Frozen rc.2 results

| Workload | Commander median | RDC median | Ratio | 95% paired interval |
| --- | ---: | ---: | ---: | ---: |
| Staged, 20 paired rounds | 518.130 ms | 1,451.105 ms | 2.8007× | 2.6295–2.8982× |
| Inline, 20 paired rounds | 515.140 ms | 1,601.445 ms | 3.1088× | 2.9476–3.3892× |

All 80 product-workflow outcomes verified. Final controlled delivery failures were 0/30 for Commander and 10/30 for RDC; RDC's ten duplicate-delivery trials produced duplicate effects. Both products passed every normal and reconnect trial. The measured relative failure reduction in this specified mixture was 100%; this does not imply a zero production failure rate.

The three `evidence/hosted-rdc-rc2-*.json` files bind the trials to revision `55e71d443d003a1c65ef785911411f559550391b` and runtime digest `761967b356bb30dc7610b3f3ad5092b5523157696fd36da32fca1ef58e942615`. Later documentation and evidence commits preserve those runtime bytes. `scripts/verify_release.py` checks that the downloaded release contains the same runtime, matches the authored files in its checkout, and satisfies the recorded gates. The complete harnesses allow independent reruns; the records are project-generated evidence, not a third-party certificate.

## Personal HTTPS connector 0.1.1

The connector comparison uses the actual configured personal HTTPS endpoint, traversing Netlify's authenticated edge, a Cloudflare SQLite Durable Object, and an outbound WebSocket to the same Mac used by RDC. Both products use their supported hosted routes. The workload, four-worker concurrency, alternating paired order, timing boundaries, artifact predicates, and 20-round/95%-lower-bound gate match the inline protocol above. No model is involved. Mac launchd uses `ProcessType=Interactive` and `LegacyTimers=true`; the report records and freezes this profile as well as cloud, installed-agent, core, and harness hashes.

| Workload | Commander median | RDC median | Ratio | 95% paired interval |
| --- | ---: | ---: | ---: | ---: |
| Personal HTTPS inline, 20 pairs | 837.415 ms | 1,730.57 ms | 2.067× | 2.010–2.186× |

All 40 product workflows verified, covering 160 worker executions. The separate 60-workflow delivery suite observed 0/30 Commander failures versus 10/30 RDC failures, all in duplicate-delivery cases. The measured failure reduction is 100% for this deliberate mixture, not everyday chat usage. This tests deterministic parallel execution, not model-driven multi-agent productivity.

`evidence/personal-interactive-inline.json` and `evidence/personal-interactive-delivery.json` bind the measurements to source revision `1c81166cc8abd9ec067d5afeb0e226978a56e73a` and connector digest `346ba2324e4427f1e31dda7558646716050175f777525dad97bb2f350fc307e1`. Recompute the recorded gates with `node scripts/verify-personal-connector.mjs`. CI does this without credentials or live commands.

For an independent live run, authorize RDC using the existing harness, provision your own private connector test OAuth client, then set `RDC_BENCH_DEVICE`, `CONNECTOR_URL`, `CONNECTOR_CHANNEL_URL`, and `CONNECTOR_OAUTH_FILE`. Run `BENCH_ROUNDS=20 BENCH_WAIT_POLICY=inline BENCH_REPORT=evidence/my-personal-inline.json node scripts/benchmark-personal-connector.mjs`; use `BENCH_ROUNDS=10` and `scripts/benchmark-personal-delivery.mjs` for the fault suite. Keep OAuth credentials private. The harness targets the explicitly identified Mac and isolated fixture paths.

The previous polling, default-scheduling channel, and direct-endpoint reports remain in `evidence/`, including every negative result. The standalone Cloudflare endpoint passes protocol tests; the final 2× measurement applies specifically to the configured Netlify-fronted personal endpoint. A new host, profile, route, or model workflow requires its own measurements.
