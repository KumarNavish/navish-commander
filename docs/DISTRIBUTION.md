# Distribution and verification

GitHub publication makes the source and downloadable packages available. It does not grant an OpenAI or Anthropic directory listing.

## Claude

The `.mcpb` release bundles the local MCP server and production dependencies. The Claude plugin manifest and `.mcp.json` support a local Claude Code checkout. Validate with `claude plugin validate . --strict`. Actual Claude Desktop extension installation remains unobserved. Conversational acceptance used a user-authorized Codex client against the same packaged server after Claude Desktop reached its usage limit.

Authoritative references: [MCP bundle format](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), [Claude Desktop extension installation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

## ChatGPT

OpenAI's current [plugin submission guide](https://developers.openai.com/plugins/deploy/submission) requires a stable public HTTPS endpoint for remote MCP submissions. The [Claude migration guide](https://developers.openai.com/plugins/guides/submit-claude-plugin) states that a local MCP server must be deployed remotely or discussed with an OpenAI contact for local MCP support; `.mcpb` files are not accepted by that portal.

For this product, a public service needs authenticated per-user device pairing and isolation, OAuth 2.1, appropriate tool permissions, privacy and support details, domain verification, and review. Publishing a shell server on an unauthenticated URL would not meet that design. This repository does not expose the author's Mac, credentials, or personal control repository to public users.

The root `plugin.json` follows the [portable plugin layout](https://developers.openai.com/plugins/build/plugins#plugin-structure). It includes a provider-neutral skill. A manifest alone does not make local execution available in ChatGPT, and a skills-only listing would not fulfill the execution-product claim.

The separate [personal connector](PERSONAL_CONNECTOR.md) supplies an authenticated HTTPS endpoint backed by an outbound Mac agent. Its owner connected it in ChatGPT developer mode. Component 0.1.2 carries the rc.3 file-reader repair and passed two fresh read-only ChatGPT checks. The broader [Latest + Extra High evaluation](CHAT_EFFICACY.md) preserves incomplete analyses, unrun mutation tasks, and export-fidelity defects. Historical 0.1.1 protocol and 2× execution/failure-reduction benchmarks do not override those chat results or certify changed source. The deployment uses existing Netlify Free and Cloudflare Workers Free hosting and requires no OpenAI API key. Public users must deploy their own single-owner instance; the author's endpoint is private.

## Observed Claude Code host integration

The real Claude Code CLI recognized the plugin, its `durable-execution` skill, and its MCP server. From a directory outside the source checkout, `claude --plugin-dir /absolute/path/navish-commander mcp list` reported `plugin:navish-commander:navish-commander` as **Connected**. This tests the host's plugin path expansion and MCP handshake, not a simulated manifest reader. Run it against the extracted release ZIP to verify your installation without a model call.

Use `--plugin-dir` when loading this package. Opening the source checkout alone treats `.mcp.json` as a project MCP file, where `CLAUDE_PLUGIN_ROOT` is unavailable. Dependencies are included in release archives; a Git checkout needs the documented `npm ci` step. No global configuration edit or install hook is required.

The rc.3 extracted package also passed strict manifest validation and the real Claude Code connection check. These checks do not include a Claude model conversation. The local runtime supports Linux as well as macOS. Claude Desktop's platform support is separate; custom Desktop installation remains a separate check.

## Connector source release

The `v1.5.0-rc.3` candidate publishes the Claude Code ZIP, Desktop MCPB, complete source archive including connector 0.1.2, and SHA-256 checksums. The source archive includes lockfiles, tests, deployment configurations, and sanitized evidence. It requires the documented dependency installation and private configuration; it contains no owner's tokens or Mac state. Earlier `connector-v0.1.1` and `v1.5.0-rc.2` assets remain unchanged and have separate source-bound evidence.

WebMCP browser APIs are not an installation format for this native command service. The supported distribution forms are standard MCP, the Claude Code plugin, the MCPB Desktop bundle, and the authenticated remote MCP connector. Availability in an app's public directory requires that provider's approval and is not implied by these artifacts.
