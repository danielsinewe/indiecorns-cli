#!/usr/bin/env node

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..", "..", "..")
const localCli = resolve(repoRoot, "indiecorns", "bin", "indiecorns.mjs")
const args = process.argv.slice(2)

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, {
    stdio: "inherit",
    ...options,
  }).status ?? 1

if (existsSync(localCli)) {
  process.exitCode = run(process.execPath, [localCli, ...(args.length ? args : ["agent"])])
} else {
  process.exitCode = run("npx", ["--yes", "indiecorns", ...(args.length ? args : ["agent"])])
}
