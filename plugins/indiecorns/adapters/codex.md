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
npm run cli -- run --agent
npm run cli -- complete all
```

For installed public CLI runs:

```bash
npx indiecorns agent
npx indiecorns tasks --agent
npx indiecorns login --no-open
npx indiecorns run --agent
npx indiecorns complete all
```
