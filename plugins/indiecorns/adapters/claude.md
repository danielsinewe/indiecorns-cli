# Claude Adapter

Claude project instructions can include the Indiecorns skill summary.

Recommended instruction:

```text
For Indiecorns tasks, use `npx indiecorns agent` as the source of truth for
auth, dashboard, and onboarding actions. Use `--no-open` in automation and ask
the user to complete browser OAuth themselves.
```

Useful commands:

```bash
npx indiecorns agent
npx indiecorns login --no-open
npx indiecorns tasks --agent
```
