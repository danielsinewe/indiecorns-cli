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

CLI release handoff:

- When CLI changes are complete, publish them instead of leaving them local.
- Keep the human CLI playful, but keep `--json`, `--agent`, and `--ndjson`
  outputs parseable.
- The npm package is released from
  `https://github.com/danielsinewe/indiecorns-cli`, not from the private app
  monorepo.
- If direct `npm publish` fails with `E401` or `E404`, use the public repo's
  tag-triggered publish workflow and verify npm afterward.

Useful verification commands:

```bash
npm view indiecorns version dist-tags --json
npm test
npm pack --dry-run
npx -y indiecorns@latest help
```
