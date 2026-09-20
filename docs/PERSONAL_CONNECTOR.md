# Personal ChatGPT connector

The optional HTTPS connector exposes the same ten Commander tools plus a connector receipt tool. It uses a dedicated Netlify site, owner-only OAuth with PKCE, and an outbound Mac agent. The Mac opens no listening port. The existing local MCP/Claude plugin continues to work independently.

This is a single-owner installation, not a multi-tenant public service. Anyone may use the source to deploy their own installation. Never distribute your installation password, agent token, signing secret, or authenticated endpoint access to other users.

## Cost and availability

No model API key, new model subscription, paid tunnel, or paid hosting is required. The verified personal installation uses an existing **legacy Netlify Free** account and the user's existing ChatGPT subscription. That account has hard free-tier limits rather than metered overage charges. Other accounts and future plans may differ: confirm the selected plan and its billing controls before deployment. Never enable paid capacity or automatic credit purchases to recover a paused site.

The current idle agent uses a five-second edge long poll and a heartbeat about once per minute: approximately 536,000 edge invocations and 45,000 function invocations in a 31-day month, plus actual tool traffic. A legacy Free plan provides one million edge and 125,000 function invocations per month. These are estimates; outages and active workloads change usage. Free quotas can pause service. See [legacy billing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/billing-faq-for-legacy-plans/), [plan limits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/), and [edge limits](https://docs.netlify.com/build/edge-functions/limits/).

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

## Recovery and execution semantics

A mutating request needs a stable `callId`. The relay atomically records its canonical intent and rejects the same ID with different arguments. The agent writes and fsyncs a local journal before dispatch and retains the result before uploading it. A lost upload acknowledgement resends the recorded result. On an agent restart, a previously running mutation is reconciled through its original Commander receipt, never automatically executed again. The installed tool catalog determines mutation semantics.

The relay checks the agent heartbeat before admitting new work. Unstarted requests expire after ten minutes. A queued response is not a completed operation: inspect `commander_connector_receipt` with its exact operation ID, or the original mutation `callId` if the first response was lost. A lost storage acknowledgement is reported as uncertain, never as a replayable failure. `commander_receipt` reports the original call; use batch/process observations and artifact checks for current state. A completed launch is not a completed worker or user goal.

Local journals and cloud intent/result records persist. There is no automatic deletion policy that could silently erase duplicate-suppression history. Back them up before maintenance. Deleting a receipt can permit a later old request to be treated as new. Retention also consumes storage; use bounded outputs and review usage.

## Privacy and trust

OAuth requires the installation password, S256 PKCE, an allowlisted redirect, the exact MCP resource, and the `commander` scope. Authorization codes are single use. Access tokens expire in one hour; refresh tokens expire in thirty days. The Mac agent has a separate random secret. Neither a GitHub token nor an OpenAI API key is sent to Netlify.

HTTPS protects transport. **Netlify can access queued arguments and results**; this route is not end-to-end encrypted against the hosting provider. The older encrypted GitHub control route remains separate. Do not send protected work data through this connector unless its policy permits ChatGPT and Netlify processing. Private cloud and local records can contain commands, paths, file contents, and output. Credentials and raw personal traces must never enter the public repository.

The runtime executes with the host account's OS permissions. This is not an OS sandbox. Only connect trusted clients, retain explicit device selection, and obey each workload's data and authorization boundaries. The agent does not start model APIs or buy credits, but a command supplied by a trusted client could invoke an installed paid service; the client's no-spending instruction remains necessary.

## Stop, update, and revoke

Use `launchctl print gui/$(id -u)/io.navish.commander.personal-connector` to inspect this agent. Before updating, reconcile its in-flight records. Stop only this LaunchAgent with `launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/io.navish.commander.personal-connector.plist"`, then run the installer from the verified checkout. Existing Commander worker processes are separate; stopping the connector does not authorize cancelling them.

To revoke execution access, stop this agent first and disconnect the ChatGPT app. Rotate the cloud signing secret to invalidate all access and refresh tokens, and rotate the agent token in both the cloud environment and local configuration. Redeploy, then reconnect only the intended client. Disconnecting a client alone is not a server-side revocation endpoint. Reconcile queued operations before restarting; preserve uncertain records.

No installation or recovery step should change a billing plan, buy a model reset, disable client safety review, or replace an unrelated Commander controller.
