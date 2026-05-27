# Contributing

Thanks for helping improve the Indiecorns CLI.

## Development

```bash
npm install
npm run smoke
npm run pack:check
```

The CLI entrypoint is `indiecorns/bin/indiecorns.mjs`. The npm package ships
only the CLI, plugin assets, README, changelog, and license.

## Pull Requests

- Keep changes focused on the public CLI and agent plugin surface.
- Do not add hosted app source, production data, local auth state, generated
  build output, or secrets.
- Update `CHANGELOG.md` for user-visible package changes.
- Run `npm test` before opening a pull request.

## Release Process

Releases are published to npm as the `indiecorns` package. The GitHub Actions
workflow publishes from tags. It currently supports the `NPM_TOKEN` repository
secret as a fallback until npm trusted publishing is approved for this
repository.
