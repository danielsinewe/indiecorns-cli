# Codex Adapter

Codex reads this plugin through `.codex-plugin/plugin.json` and the repo
marketplace entry in `.agents/plugins/marketplace.json`.

Use the included skill when the user asks for Indiecorns:

```bash
node plugins/indiecorns/scripts/indiecorns-agent.mjs
```

Preferred agent-safe commands:

```bash
npm run cli -- agent
npm run cli -- tasks --agent
npm run cli -- login --no-open
```

PostHog MCP:

- The Indiecorns PostHog project ID is `183838`.
- The plugin MCP manifest wires `posthog` to
  `https://mcp.posthog.com/mcp?project_id=183838`.
- In Codex, verify the active PostHog project before analytics work:

```text
posthog:exec({ "command": "info project-get", "context": "Checking active PostHog project before querying Indiecorns analytics through MCP." })
posthog:exec({ "command": "call project-get {\"id\":\"@current\"}", "context": "Confirming PostHog MCP targets the Indiecorns project before analytics or dashboard changes." })
```
