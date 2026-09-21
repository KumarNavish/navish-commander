# Commander contribution rules

Keep runtime changes scoped and preserve durable IDs, write-ahead launch claims, uncertain states, and evidence of failed runs. Never turn an unknown outcome into permission to replay a mutation.

The Claude Desktop extension runs as an Electron utility process: `process.execPath` is the Claude binary there and modules load slowly. Launch detached helpers through `prepareNodeRuntime()` in `runtime/app/src/process.mjs`, never `process.execPath`, and keep heavy imports out of the first tool call.

Use isolated temporary state for tests. Do not use the developer's configured machines, browser sessions, credentials, or running workers as test fixtures. The server is local and trusted; do not introduce an unauthenticated network listener.

Run `npm test` after runtime or MCP changes. Browser fixture tests use `CHROMIUM_BIN=/absolute/path/to/chromium python3 runtime/test/runtime/run_browser_tests.py`; that fixture adapter is not Ego Lite. After packaging changes, build and run the MCP tests against an extracted bundle.

Keep benchmark workload definitions and negative results visible. A local Desktop Commander result cannot certify the hosted Remote Desktop Commander service. Do not add performance or reliability claims stronger than the recorded evidence. Keep the release a candidate until the documented acceptance gates pass.

Do not commit installed state, control repositories, credentials, raw user outputs, temporary environments, or build archives. Release archives are uploaded separately with SHA-256 checksums. Match versions across package and plugin manifests.
