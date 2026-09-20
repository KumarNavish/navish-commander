# Personal ChatGPT connector

The optional HTTPS connector exposes the same ten Commander tools plus a connector receipt tool. Its standalone Cloudflare endpoint uses owner-only OAuth with PKCE, a SQLite Durable Object, and an outbound Mac WebSocket. A Netlify OAuth/front-door installation and the original polling transport remain explicit options. The Mac opens no listening port. The existing local MCP/Claude plugin continues to work independently.

This is a single-owner installation, not a multi-tenant public service. Anyone may use the source to deploy their own installation. Never distribute your installation password, agent token, signing secret, or authenticated endpoint access to other users.

## Cost and availability

No model API key, new model subscription, paid tunnel, or paid hosting is required. The verified personal installation uses existing **legacy Netlify Free** and **Cloudflare Workers Free ($0)** accounts and the user's existing ChatGPT subscription. Both verified free plans stop operations at their limits rather than charging overages. Other accounts and future plans may differ: confirm the selected plan and its billing controls before deployment. Never enable paid capacity or automatic credit purchases to recover a paused site.

The persistent agent sends a heartbeat every 30 seconds (about 2,880 WebSocket messages per day) and no idle Netlify polling requests. Cloudflare's hibernation API releases idle compute while keeping the socket connected. Workers Free allows 100,000 requests per day; SQLite Durable Objects have separate request, duration, row and storage limits. A legacy Netlify Free plan provides one million edge and 125,000 function invocations per month. Actual workload traffic adds usage. See [Cloudflare limits and pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Netlify legacy billing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/billing-faq-for-legacy-plans/), and [Netlify plan limits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/).

The optional polling transport instead uses a five-second edge long poll and a heartbeat about once per minute: approximately 536,000 edge invocations and 45,000 function invocations in a 31-day month, plus actual tool traffic. These are estimates; outages and active workloads change usage. Free quotas can pause either transport.

The Mac must be powered on, connected, and logged into the account running the LaunchAgent. There is no uptime SLA. Custom instructions guide tool selection; they cannot give a chat unavailable tools or override ChatGPT's approvals, usage limits, or safety checks.

The Mac LaunchAgent uses `ProcessType=Interactive` and precise legacy timers for chat-driven work. macOS otherwise throttles launchd jobs' CPU/I/O and coalesces their timers. These settings grant no additional file or account permissions. They favor response latency during execution; the outbound connection still sleeps between bounded heartbeats when idle.

## Deploy your own instance

### Standalone Cloudflare endpoint

This route needs no Netlify account or model API key. Confirm the account is on **Workers Free ($0)** before deployment.

1. Clone this repository into a dedicated directory and run `npm ci --ignore-scripts`. Verify the local MCP setup. Authenticate the pinned Wrangler CLI with user/account read and Workers/Workers Scripts write scopes; set your own `CLOUDFLARE_ACCOUNT_ID` explicitly.
2. Run `node connector/prepare-release.mjs`, then `WRANGLER_SEND_METRICS=false npx wrangler deploy --config connector/channel/wrangler.jsonc`. The initial service rejects execution until private credentials are installed. Record the returned HTTPS origin.
3. Run `node connector/setup.mjs https://YOUR-WORKER.workers.dev --channel`. It creates private owner and Mac-agent configuration plus `channel-secrets.json`, refuses an existing directory, and prints no credentials. For an existing installation, preserve its configuration and receipts and reconcile pending operations before migration.
4. Run `WRANGLER_SEND_METRICS=false npx wrangler secret bulk /ABSOLUTE/PRIVATE/PATH/channel-secrets.json --config connector/channel/wrangler.jsonc`. Keep this file outside Git. It contains the owner signing secret, owner password hash, agent token, internal server token, and origin. The Worker implements OAuth directly with single-use codes in its SQLite storage.
5. Run `node connector/install-agent.mjs` on the Mac. Check the cloud `/health` source hash against the installation manifest. Use the private server token for `POST /status`; wait for `online: true` before acceptance. The public MCP endpoint must return 401 without OAuth. An offline agent yields a blocked, not-dispatched result.
6. Create your personal ChatGPT developer app using `https://YOUR-WORKER.workers.dev/mcp`, OAuth, and scope `commander`. Authenticate with your private owner password. Verify all eleven tools and a fresh read-only fixture in ordinary chat. Choose permissions deliberately; this setup never disables platform safety review.

OAuth and SDK processing execute within the Durable Object. The outer Worker only routes requests, avoiding a paid Worker CPU upgrade. The same persistent journal and duplicate-suppression rules below apply.

### Optional Netlify front door

1. Clone this repository into its own permanent directory and run `npm ci --ignore-scripts`. Use Node 22.16 or newer. Verify the normal local MCP setup first.
2. Create a **dedicated** Netlify site on a confirmed free plan. Do not reuse an unrelated site's deployment. Link the checkout to this site using the official Netlify CLI.
3. Run `node connector/setup.mjs https://YOUR-SITE.netlify.app`. This generates private files under `~/.config/navish-chatgpt-connector` with mode 0600, without printing secrets. It refuses to replace an existing configuration.
4. Add the four values from the private `relay.env` to that site's **production** environment. Mark `CONNECTOR_SECRET`, `CONNECTOR_OWNER_PASSWORD_HASH`, and `CONNECTOR_AGENT_TOKEN` secret. They must be available to both functions and edge functions. Do not commit the file or paste it into a chat. Verify that the variables actually persisted; a CLI exit status alone is insufficient.
5. From the repository root, deploy with `npx --yes netlify-cli@27.8.0 deploy --prod --context production --site YOUR_SITE_ID`. The root `netlify.toml` defines the static page, MCP/OAuth function, and authenticated edge poll. Check `/health` and both OAuth metadata endpoints; unauthenticated `/mcp` and `/agent/poll` must reject access.
6. On macOS, run `node connector/install-agent.mjs`. It pins the current source and installed dependencies, writes its own LaunchAgent, and records the source hash. It refuses to replace a loaded agent. On another supported host, run `node connector/agent.mjs /absolute/path/to/agent.json` under a suitable process manager.
7. In ChatGPT, enable developer mode where available, open **Plugins**, choose **Create app**, and use `https://YOUR-SITE.netlify.app/mcp`, OAuth, and scope `commander`. Sign in using the password in your private `owner.json`. Refresh the app's actions after connecting; 34 tools should appear. The current callback allowlist supports ChatGPT. Claude uses the separately documented local MCP plugin.
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

## Bounded file reads in connector 0.1.2 / runtime rc.3

Text line offsets are now resolved before applying the response byte limit. Responses expose `offset`, `returnedLines`, `nextOffset`, `hasMore`, and `partialLastLine`. A normal complete page can have `hasMore: true` and `truncated: false`. If the byte budget clips a line, `truncated` and `partialLastLine` identify the incomplete result, and the next offset does not skip that line. A single line longer than the permitted byte budget can still be incomplete; do not interpret an empty or partial byte-limited response as EOF. Binary reads preserve their existing prefix-byte behavior. Negative offsets preserve the existing whole-tail semantics.

## Recovery and execution semantics

Connector 0.1.3 persists `connectorOperation` in new responses, including completed reads. It identifies the original tool, target and relay operation ID. Use that known ID with `commander_connector_receipt` to retrieve the exact response without dispatching again. After a denied action, reconcile already dispatched operations read-only before reporting their effects. [Response identity and partial-effect recovery](RESPONSE_RECOVERY.md) describes the contract and its limits.

A mutating request needs a stable `callId`. The relay atomically records its canonical intent and rejects the same ID with different arguments. The agent writes and fsyncs a local journal before dispatch and retains the result before uploading it. A lost upload acknowledgement resends the recorded result. On an agent restart, a previously running mutation is reconciled through its original Commander receipt, never automatically executed again. The installed tool catalog determines mutation semantics.

The relay checks the agent heartbeat before admitting new work. Unstarted requests expire after ten minutes. A queued response is not a completed operation: inspect `commander_connector_receipt` with its exact operation ID, or the original mutation `callId` if the first response was lost. A lost storage acknowledgement is reported as uncertain, never as a replayable failure. `commander_receipt` reports the original call; use batch/process observations and artifact checks for current state. A completed launch is not a completed worker or user goal.

Local journals and cloud intent/result records persist. There is no automatic deletion policy that could silently erase duplicate-suppression history. Back them up before maintenance. Deleting a receipt can permit a later old request to be treated as new. Retention also consumes storage; use bounded outputs and review usage.

## Privacy and trust

OAuth requires the installation password, S256 PKCE, an allowlisted redirect, the exact MCP resource, and the `commander` scope. Authorization codes are single use. Access tokens expire in one hour; refresh tokens expire in thirty days. The Mac agent has a separate random secret. Neither a GitHub token nor an OpenAI API key is sent to Netlify.

HTTPS protects transport. **Netlify and, when enabled, Cloudflare can access arguments and results**; this route is not end-to-end encrypted against the hosting providers. The older encrypted GitHub control route remains separate. Do not send protected work data through this connector unless its policy permits ChatGPT and the selected providers to process it. Private cloud and local records can contain commands, paths, file contents, and output. Credentials and raw personal traces must never enter the public repository.

The runtime executes with the host account's OS permissions. This is not an OS sandbox. Only connect trusted clients, retain explicit device selection, and obey each workload's data and authorization boundaries. The agent does not start model APIs or buy credits, but a command supplied by a trusted client could invoke an installed paid service; the client's no-spending instruction remains necessary.

ChatGPT's **Allow all actions** app setting does not remove all platform safety checks. The owner's live full-access acceptance test still received nine explicit blocks. A denied action must not be retried or routed through another tool merely because no host effect occurred. See [the observed conversation results](CHAT_ACCEPTANCE.md#full-access-personal-chatgpt-check-20-september-2026).

## Stop, update, and revoke

Use `launchctl print gui/$(id -u)/io.navish.commander.personal-connector` to inspect this agent. Before updating, reconcile its in-flight records. Stop only this LaunchAgent with `launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/io.navish.commander.personal-connector.plist"`, then run the installer from the verified checkout. Existing Commander worker processes are separate; stopping the connector does not authorize cancelling them.

To revoke execution access, stop this agent first and disconnect the ChatGPT app. Rotate the cloud signing secret to invalidate all access and refresh tokens, and rotate the agent token in both the cloud environment and local configuration. Redeploy, then reconnect only the intended client. Disconnecting a client alone is not a server-side revocation endpoint. Reconcile queued operations before restarting; preserve uncertain records.

No installation or recovery step should change a billing plan, buy a model reset, disable client safety review, or replace an unrelated Commander controller.

## Oversized responses in connector 0.4.3

A completed interactive command can produce more output than the relay can deliver in one message. The agent now uploads a bounded `CONNECTOR_RESULT_TOO_LARGE` notice instead of entering a reconnect loop. The notice preserves the original state, operation identity and process/batch IDs, plus the full response's SHA-256 and byte count. `isError: true` reports incomplete delivery; it does not mean a completed command failed or authorize re-execution.

The original response remains unchanged in the local durable journal. Use `commander_process_output` with `offset` and `maxBytes` or a bounded `commander_collect_batch` to recover output. For a large read, request less content. A connector receipt returns the same delivery notice; it does not paginate the omitted response. Both the WebSocket channel and legacy polling upload retain their existing size limits.

An isolated real-MCP regression emits 700,000 output bytes from one interactive input, drops its first upload, reconnects, verifies exactly one side effect, recovers every output byte through bounded reads and confirms zero pending requests. Ordinary small responses remain unchanged. This is a specific recovery fix, not unattended platform certification or a new RDC throughput measurement.
