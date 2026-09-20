# Personal ChatGPT connector

The optional HTTPS connector exposes the same ten Commander tools plus a connector receipt tool. It uses a dedicated Netlify site, owner-only OAuth with PKCE, and an outbound Mac agent. The persistent transport adds a Cloudflare SQLite Durable Object and an outbound WebSocket; the original Netlify polling transport remains an explicit installation option. The Mac opens no listening port. The existing local MCP/Claude plugin continues to work independently.

This is a single-owner installation, not a multi-tenant public service. Anyone may use the source to deploy their own installation. Never distribute your installation password, agent token, signing secret, or authenticated endpoint access to other users.

## Cost and availability

No model API key, new model subscription, paid tunnel, or paid hosting is required. The verified personal installation uses existing **legacy Netlify Free** and **Cloudflare Workers Free ($0)** accounts and the user's existing ChatGPT subscription. Both verified free plans stop operations at their limits rather than charging overages. Other accounts and future plans may differ: confirm the selected plan and its billing controls before deployment. Never enable paid capacity or automatic credit purchases to recover a paused site.

The persistent agent sends a heartbeat every 30 seconds (about 2,880 WebSocket messages per day) and no idle Netlify polling requests. Cloudflare's hibernation API releases idle compute while keeping the socket connected. Workers Free allows 100,000 requests per day; SQLite Durable Objects have separate request, duration, row and storage limits. A legacy Netlify Free plan provides one million edge and 125,000 function invocations per month. Actual workload traffic adds usage. See [Cloudflare limits and pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Netlify legacy billing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/billing-faq-for-legacy-plans/), and [Netlify plan limits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/).

The optional polling transport instead uses a five-second edge long poll and a heartbeat about once per minute: approximately 536,000 edge invocations and 45,000 function invocations in a 31-day month, plus actual tool traffic. These are estimates; outages and active workloads change usage. Free quotas can pause either transport.

The Mac must be powered on, connected, and logged into the account running the LaunchAgent. There is no uptime SLA. Custom instructions guide tool selection; they cannot give a chat unavailable tools or override ChatGPT's approvals, usage limits, or safety checks.

## Deploy your own instance

1. Clone this repository into its own permanent directory and run `npm ci --ignore-scripts`. Use Node 22.16 or newer. Verify the normal local MCP setup first.
2. Create a **dedicated** Netlify site on a confirmed free plan. Do not reuse an unrelated site's deployment. Link the checkout to this site using the official Netlify CLI.
3. Run `node connector/setup.mjs https://YOUR-SITE.netlify.app`. This generates private files under `~/.config/navish-chatgpt-connector` with mode 0600, without printing secrets. It refuses to replace an existing configuration.
4. Add the four values from the private `relay.env` to that site's **production** environment. Mark `CONNECTOR_SECRET`, `CONNECTOR_OWNER_PASSWORD_HASH`, and `CONNECTOR_AGENT_TOKEN` secret. They must be available to both functions and edge functions. Do not commit the file or paste it into a chat. Verify that the variables actually persisted; a CLI exit status alone is insufficient.
5. From the repository root, deploy with `npx --yes netlify-cli@27.8.0 deploy --prod --context production --site YOUR_SITE_ID`. The root `netlify.toml` defines the static page, MCP/OAuth function, and authenticated edge poll. Check `/health` and both OAuth metadata endpoints; unauthenticated `/mcp` and `/agent/poll` must reject access.
6. On macOS, run `node connector/install-agent.mjs`. It pins the current source and installed dependencies, writes its own LaunchAgent, and records the source hash. It refuses to replace a loaded agent. On another supported host, run `node connector/agent.mjs /absolute/path/to/agent.json` under a suitable process manager.
7. In ChatGPT, enable developer mode where available, open **Plugins**, choose **Create app**, and use `https://YOUR-SITE.netlify.app/mcp`, OAuth, and scope `commander`. Sign in using the password in your private `owner.json`. Refresh the app's actions after connecting; eleven tools should appear. The current callback allowlist supports ChatGPT. Claude uses the separately documented local MCP plugin.
8. Test a fresh chat with a read-only random fixture whose contents are not included in the prompt. Verify the actual file independently. Then test authorized writes and workers according to the app's selected permission mode. Do not label protocol-only tests as a successful chat conversation.

See OpenAI's [connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [OAuth requirements](https://developers.openai.com/plugins/build/auth). A personal developer app does not imply directory approval or availability to every account.

### Persistent channel

Before switching an existing installation, reconcile its old queue and local journal; stop only its connector LaunchAgent. Preserve all old records. Migration never authorizes replay of an uncertain mutation.

1. Verify the selected Cloudflare account is on **Workers Free**. Authenticate Wrangler with account/user read and Workers/Workers Scripts write scopes. No billing, model API, database product, or paid-plan permission is needed. Pass your own `CLOUDFLARE_ACCOUNT_ID` explicitly; the repository contains no personal account binding.
2. Run `node connector/prepare-release.mjs`, then `WRANGLER_SEND_METRICS=false npx wrangler deploy --config connector/channel/wrangler.jsonc`. SQLite Durable Objects are supported on the free plan. The endpoint rejects execution requests until secrets are configured.
3. Generate a separate random 256-bit server token. Use `wrangler secret bulk PRIVATE_FILE --config connector/channel/wrangler.jsonc` to install `SERVER_TOKEN` and `AGENT_TOKEN`; the latter must match the private Mac configuration. Keep the file private and outside Git. Do not put credentials in URLs or public configuration.
4. Add `CONNECTOR_CHANNEL_ORIGIN` (the HTTPS Worker origin) and secret `CONNECTOR_CHANNEL_TOKEN` to the dedicated Netlify site's production environment, available to both functions and edge functions. Redeploy Netlify. Its `/mcp` route runs at the edge; the existing OAuth issuer and ChatGPT connection remain unchanged.
5. Add `channelOrigin` to the private Mac `agent.json`, then install the pinned agent. It connects through outbound TLS and authenticates in WebSocket upgrade headers. Check the authenticated channel `/status` endpoint, both services' `/health` source hashes, and the local installation manifest. Run a fresh isolated acceptance workflow.

The channel atomically records immutable intents and results in SQLite and dispatches at most four simultaneous MCP calls. Each batch can manage its own parallel workers. Lost delivery reconnects to the same durable IDs and local journal. Failed responses do not cause automatic switching to the polling queue. Receipt lookup can read older polling records without dispatching them. `node --test test/channel.test.mjs` exercises the actual local Cloudflare runtime with isolated storage, including dropped delivery and process restart.

## Recovery and execution semantics

A mutating request needs a stable `callId`. The relay atomically records its canonical intent and rejects the same ID with different arguments. The agent writes and fsyncs a local journal before dispatch and retains the result before uploading it. A lost upload acknowledgement resends the recorded result. On an agent restart, a previously running mutation is reconciled through its original Commander receipt, never automatically executed again. The installed tool catalog determines mutation semantics.

The relay checks the agent heartbeat before admitting new work. Unstarted requests expire after ten minutes. A queued response is not a completed operation: inspect `commander_connector_receipt` with its exact operation ID, or the original mutation `callId` if the first response was lost. A lost storage acknowledgement is reported as uncertain, never as a replayable failure. `commander_receipt` reports the original call; use batch/process observations and artifact checks for current state. A completed launch is not a completed worker or user goal.

Local journals and cloud intent/result records persist. There is no automatic deletion policy that could silently erase duplicate-suppression history. Back them up before maintenance. Deleting a receipt can permit a later old request to be treated as new. Retention also consumes storage; use bounded outputs and review usage.

## Privacy and trust

OAuth requires the installation password, S256 PKCE, an allowlisted redirect, the exact MCP resource, and the `commander` scope. Authorization codes are single use. Access tokens expire in one hour; refresh tokens expire in thirty days. The Mac agent has a separate random secret. Neither a GitHub token nor an OpenAI API key is sent to Netlify.

HTTPS protects transport. **Netlify and, when enabled, Cloudflare can access arguments and results**; this route is not end-to-end encrypted against the hosting providers. The older encrypted GitHub control route remains separate. Do not send protected work data through this connector unless its policy permits ChatGPT and the selected providers to process it. Private cloud and local records can contain commands, paths, file contents, and output. Credentials and raw personal traces must never enter the public repository.

The runtime executes with the host account's OS permissions. This is not an OS sandbox. Only connect trusted clients, retain explicit device selection, and obey each workload's data and authorization boundaries. The agent does not start model APIs or buy credits, but a command supplied by a trusted client could invoke an installed paid service; the client's no-spending instruction remains necessary.

## Stop, update, and revoke

Use `launchctl print gui/$(id -u)/io.navish.commander.personal-connector` to inspect this agent. Before updating, reconcile its in-flight records. Stop only this LaunchAgent with `launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/io.navish.commander.personal-connector.plist"`, then run the installer from the verified checkout. Existing Commander worker processes are separate; stopping the connector does not authorize cancelling them.

To revoke execution access, stop this agent first and disconnect the ChatGPT app. Rotate the cloud signing secret to invalidate all access and refresh tokens, and rotate the agent token in both the cloud environment and local configuration. Redeploy, then reconnect only the intended client. Disconnecting a client alone is not a server-side revocation endpoint. Reconcile queued operations before restarting; preserve uncertain records.

No installation or recovery step should change a billing plan, buy a model reset, disable client safety review, or replace an unrelated Commander controller.
