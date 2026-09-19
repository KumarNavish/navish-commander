# Distribution and verification

GitHub publication makes the source and downloadable packages available. It does not grant an OpenAI or Anthropic directory listing.

## Claude

The `.mcpb` release bundles the local MCP server and production dependencies. The Claude plugin manifest and `.mcp.json` support a local Claude Code checkout. Validate with `claude plugin validate . --strict`. Actual Claude Desktop extension installation and conversational tool use remain separate acceptance gates from protocol tests.

Authoritative references: [MCP bundle format](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), [Claude Desktop extension installation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

## ChatGPT

OpenAI's current [plugin submission guide](https://developers.openai.com/plugins/deploy/submission) requires a stable public HTTPS endpoint for remote MCP submissions. The [Claude migration guide](https://developers.openai.com/plugins/guides/submit-claude-plugin) states that a local MCP server must be deployed remotely or discussed with an OpenAI contact for local MCP support; `.mcpb` files are not accepted by that portal.

For this product, a public service needs authenticated per-user device pairing and isolation, OAuth 2.1, appropriate tool permissions, privacy and support details, domain verification, and review. Publishing a shell server on an unauthenticated URL would not meet that design. This repository does not expose the author's Mac, credentials, or personal control repository to public users.

The root `plugin.json` follows the [portable plugin layout](https://developers.openai.com/plugins/build/plugins#plugin-structure). It includes a provider-neutral skill. A manifest alone does not make local execution available in ChatGPT, and a skills-only listing would not fulfill the execution-product claim.
