# OpenClaw Adapter

Use the Indiecorns CLI as the OpenClaw action source. The stable machine
interface is JSON from `agent` or `--agent`.

Recommended action:

```bash
npx indiecorns agent
```

For local repo runs:

```bash
node plugins/indiecorns/scripts/indiecorns-agent.mjs
```

OpenClaw should treat returned actions with `kind: "open_url"` as user handoff
steps. Do not complete X, LinkedIn, or Google OAuth steps in an unattended
browser session.
