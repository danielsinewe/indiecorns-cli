import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const cli = resolve("indiecorns/bin/indiecorns.mjs")

test("no-argument Codex runs return one concise next-step handoff", () => {
  const testHome = mkdtempSync(join(tmpdir(), "indiecorns-codex-"))

  try {
    const output = execFileSync(process.execPath, [cli], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_CI: "1",
        HOME: testHome,
        INDIECORNS_APP_URL: "http://127.0.0.1:1",
        INDIECORNS_TELEMETRY_DISABLED: "1",
      },
    })
    const handoff = JSON.parse(output)

    assert.equal(handoff.mode, "codex_handoff")
    assert.equal(handoff.version, "0.3.40")
    assert.deepEqual(handoff.quickStart, {
      completed: 0,
      total: 4,
      percent: 0,
    })
    assert.equal(handoff.state, "action_required")
    assert.equal(handoff.nextAction.id, "login")
    assert.match(handoff.instruction, /verify completed CLI session/)
    assert.equal("setup" in handoff, false)
  } finally {
    rmSync(testHome, { recursive: true, force: true })
  }
})

test("the default setup check does not inspect the caller's source tree", () => {
  const source = readFileSync(cli, "utf8")

  assert.doesNotMatch(source, /expected at indiecorns\/node_modules/)
  assert.doesNotMatch(source, /Next app layout exists/)
  assert.doesNotMatch(source, /dev script configured/)
})
