# Distribution and verification

GitHub publication makes the source and downloadable packages available. It does not grant an OpenAI or Anthropic directory listing.

## Claude

The `.mcpb` release bundles the local MCP server and production dependencies. The Claude plugin manifest and `.mcp.json` support a local Claude Code checkout. Validate with `claude plugin validate . --strict`. Actual Claude Desktop extension installation remains unobserved. Conversational acceptance used a user-authorized Codex client against the same packaged server after Claude Desktop reached its usage limit.

Authoritative references: [MCP bundle format](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), [Claude Desktop extension installation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

## ChatGPT

OpenAI's current [plugin submission guide](https://developers.openai.com/plugins/deploy/submission) requires a stable public HTTPS endpoint for remote MCP submissions. The [Claude migration guide](https://developers.openai.com/plugins/guides/submit-claude-plugin) states that a local MCP server must be deployed remotely or discussed with an OpenAI contact for local MCP support; `.mcpb` files are not accepted by that portal.

For this product, a public service needs authenticated per-user device pairing and isolation, OAuth 2.1, appropriate tool permissions, privacy and support details, domain verification, and review. Publishing a shell server on an unauthenticated URL would not meet that design. This repository does not expose the author's Mac, credentials, or personal control repository to public users.

The root `plugin.json` follows the [portable plugin layout](https://developers.openai.com/plugins/build/plugins#plugin-structure). It includes a provider-neutral skill. A manifest alone does not make local execution available in ChatGPT, and a skills-only listing would not fulfill the execution-product claim.

The separate [personal connector](PERSONAL_CONNECTOR.md), component version 0.1.0, supplies an authenticated HTTPS endpoint backed by an outbound Mac agent. Its owner connected it in ChatGPT developer mode. An ordinary chat performed a verified read and one file write, but the broader mutation acceptance did not pass: the model selected incorrect append content and the client blocked worker execution. Direct protocol tests passed; these do not override the chat result. The deployment uses existing free hosting and requires no OpenAI API key. Public users must deploy their own single-owner instance; the author's endpoint is private.

## Observed Claude Code host integration

The real Claude Code CLI recognized the plugin, its `durable-execution` skill, and its MCP server. From a directory outside the source checkout, `claude --plugin-dir /absolute/path/navish-commander mcp list` reported `plugin:navish-commander:navish-commander` as **Connected**. This tests the host's plugin path expansion and MCP handshake, not a simulated manifest reader. Run it against the extracted release ZIP to verify your installation without a model call.

Use `--plugin-dir` when loading this package. Opening the source checkout alone treats `.mcp.json` as a project MCP file, where `CLAUDE_PLUGIN_ROOT` is unavailable. Dependencies are included in release archives; a Git checkout needs the documented `npm ci` step. No global configuration edit or install hook is required.

The local runtime supports Linux as well as macOS. Claude Desktop's platform support is separate. The Claude Code distribution is the verified host route for this release; custom Desktop installation remains a separate check.
