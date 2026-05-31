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

## CLI Release Path

Completed Indiecorns CLI or bundled-plugin changes should be published, not
left only as local monorepo edits.

The npm package source of truth is the public repository:

```text
https://github.com/danielsinewe/indiecorns-cli
```

The private Indiecorns monorepo may contain matching package files for local app
development, but it is not the reliable npm publishing source. If a publish from
the private monorepo fails with npm registry permission errors, move the release
through `danielsinewe/indiecorns-cli` instead.

Release checklist:

```bash
npm view indiecorns version dist-tags --json
npm version <next-version> --no-git-tag-version
node --check indiecorns/bin/indiecorns.mjs
npm run cli -- wizard --json --no-telemetry --app-url http://localhost:3000
npm run cli -- wizard --ndjson --no-open --no-telemetry --app-url http://localhost:3000
npm test
git commit -m "Release Indiecorns CLI <next-version>"
git tag v<next-version>
git push origin main
git push origin v<next-version>
```

After the public repository publish workflow finishes, verify the real package:

```bash
npm view indiecorns version dist-tags --json
npx -y indiecorns@latest help
```
