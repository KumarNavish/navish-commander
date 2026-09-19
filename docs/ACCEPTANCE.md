# Release acceptance is incomplete

The local MCP package runs and preserves worker identities across reconnects. It is not fully product-certified and has not met the requested 2× Remote Desktop Commander target. Version 1.5.0-rc.1 is a release candidate for evaluation.

## Executed locally

On macOS ARM64 with Node 26.8.2, 83 core and MCP integration tests passed. Another 17 controlled Chromium tests passed through a test-only Ego API adapter. The latter exercise real browser behavior and Commander's process envelope, but they are not tests of the installed Ego Lite application or the ChatGPT UI.

The core tests cover authenticated encryption, receipt identity, duplicate prevention, resource contention, remote-outcome classification, output bounds, worker exit failures, expected artifact hashes, cross-process concurrency, and recovery after caller death. The MCP tests perform real protocol initialization, tool discovery, typed calls, and reconnects against the packaged server entry point.

The local comparator completed ten normal four-worker rounds for each implementation. Four additional rounds per implementation restarted the MCP server between launch and collection. Commander recovered all four; the local Desktop Commander server did not recover the corresponding in-memory sessions. These are deliberately injected server restarts, not observed production failure rates or hosted-relay failures.

After the asynchronous launch change, the measured normal median was 806.825 ms for Commander and 680.27 ms for Desktop Commander, a throughput ratio of 0.843× in this local workload. **The 2× throughput gate failed.** Commander used two tool calls per normal round; that lower call count is not equivalent to higher completed-work throughput. Full samples and the slower pre-change result are in `evidence/`.

Manifest validation and an npm dependency audit passed locally. The audit reported zero known vulnerabilities at the time of the check. This does not establish absence of implementation defects.

## Outstanding gates

| Gate | Status |
| --- | --- |
| Requested Remote Desktop Commander service comparison | Blocked: no callable authenticated RDC connector in the current task |
| 2× multi-agent throughput | Failed in the local diagnostic; remote target unmeasured |
| At least 50% fewer real chat-workflow failures | Unmeasured; deterministic restart cases are insufficient |
| Actual Claude Desktop installation and conversation | Not yet observed |
| Actual ChatGPT public integration | Not deployed or submitted |
| Public multi-user authentication and device isolation | Not implemented in the local package |
| macOS/Linux CI matrix and packaged-artifact checks | Results must be verified on the published commit |
| Independent certification | Not obtained; these are first-party engineering checks |

Public GitHub availability, passing fixtures, and a valid manifest do not waive these gates. The installed personal controller and existing research jobs were not upgraded or restarted by this release work.
