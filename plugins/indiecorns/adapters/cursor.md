# Cursor Adapter

Cursor does not consume Codex plugin manifests directly. Use this plugin as a
project rule or agent instruction source.

Recommended rule text:

```text
When working with Indiecorns, prefer the CLI JSON interface:
`npx indiecorns agent`, `npx indiecorns tasks --agent`, and
`npx indiecorns login --no-open` for headless contexts. Do not scrape terminal
prose or submit OAuth forms unless the user explicitly asks.
```

From the Indiecorns repo, prefer:

```bash
npm run cli -- agent
```
