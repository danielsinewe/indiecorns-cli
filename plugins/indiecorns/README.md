# Indiecorns Plugin

Agent-ready Indiecorns workflows for Codex, Cursor, Claude, OpenClaw, and
similar coding agents.

## What It Provides

- A Codex plugin manifest at `.codex-plugin/plugin.json`.
- A PostHog MCP server manifest for the Indiecorns analytics project.
- An `indiecorns` skill for CLI auth, onboarding tasks, and dashboard handoff.
- A wrapper script that returns the Indiecorns CLI JSON action plan.
- Adapter notes for agent hosts that do not read Codex plugin manifests.

## Run

From this repo:

```bash
node plugins/indiecorns/scripts/indiecorns-agent.mjs
node plugins/indiecorns/scripts/indiecorns-agent.mjs tasks --agent
node plugins/indiecorns/scripts/indiecorns-agent.mjs login --no-open
```

Outside the repo:

```bash
npx indiecorns agent
```

Install the plugin into a user's local Codex plugin marketplace:

```bash
npx indiecorns plugin install
```

This installs to `~/plugins/indiecorns` and updates
`~/.agents/plugins/marketplace.json`.

`npx indiecorns login` runs this installation automatically after a successful
browser sign-in. The explicit `plugin install` command remains available for
repairing or refreshing the local plugin bundle.

The plugin should appear as `indiecorns` in Codex, using the Indiecorns PNG
logo from `assets/logo.png`.

The bundled MCP manifest also registers PostHog for the Indiecorns project:

```json
{
  "mcpServers": {
    "posthog": {
      "url": "https://mcp.posthog.com/mcp?project_id=183838"
    }
  }
}
```

## Auth Model

Interactive auth is browser-first. `indiecorns login` opens the browser and
waits for the app to complete auth. Agent-safe commands use `--agent`, `--json`,
or `--no-open`.
