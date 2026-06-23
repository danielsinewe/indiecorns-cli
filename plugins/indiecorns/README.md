# Indiecorns User Plugin

Public user-facing Indiecorns workflows for Codex, Cursor, Claude, OpenClaw,
and similar coding agents.

This is the bundle shipped by the public `indiecorns` CLI package.

## What It Provides

- A Codex plugin manifest at `.codex-plugin/plugin.json`.
- A public `indiecorns` skill for CLI auth, onboarding tasks, dashboard handoff,
  social profile actions, and safe browser boundaries.
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

List or install the bundled Indiecorns skills with the open `skills` CLI:

```bash
npx skills add ./plugins/indiecorns --list --full-depth
npx skills add ./plugins/indiecorns --skill indiecorns
```

Install the plugin into a user's local Codex plugin marketplace:

```bash
npx indiecorns plugin install
```

This installs the public user bundle to `~/plugins/indiecorns`, updates
`~/.agents/plugins/marketplace.json`, and installs the public skill at
`~/.agents/skills/indiecorns`.

`npx indiecorns login` runs this installation automatically after a successful
browser sign-in. The explicit `plugin install` command remains available for
repairing or refreshing the local plugin and skill bundle.

The plugin should appear as `indiecorns` in Codex, using the Indiecorns PNG
logo from `assets/logo.png`.

## Auth Model

Interactive auth is browser-first. `indiecorns login` opens the browser and
waits for the app to complete auth. Agent-safe commands use `--agent`, `--json`,
or `--no-open`.
