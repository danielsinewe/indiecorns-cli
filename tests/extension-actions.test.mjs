import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const cli = resolve("indiecorns/bin/indiecorns.mjs")

const runCli = ({ args, home }) =>
  new Promise((resolveRun, reject) => {
    const env = { ...process.env, HOME: home, NO_COLOR: "1" }
    delete env.INDIECORNS_TOKEN
    const child = spawn(process.execPath, [cli, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolveRun({ code, stdout, stderr }))
  })

test("extension store commands are agent-safe and review is optional", async () => {
  const home = await mkdtemp(join(tmpdir(), "indiecorns-extension-test-"))

  try {
    const install = await runCli({
      home,
      args: ["extension", "install", "--agent", "--no-telemetry"],
    })
    assert.equal(install.code, 0, install.stderr)
    assert.deepEqual(JSON.parse(install.stdout), {
      kind: "open_url",
      action: "install_extension",
      extensionId: "oldjmlmncilgeagpfgkcjjlkbfbkiggk",
      url: "https://chromewebstore.google.com/detail/oldjmlmncilgeagpfgkcjjlkbfbkiggk",
      optional: false,
      note: "Open the installed extension and sign in once to verify installation.",
    })

    const review = await runCli({
      home,
      args: ["extension", "review", "--agent", "--no-telemetry"],
    })
    assert.equal(review.code, 0, review.stderr)
    const reviewOutput = JSON.parse(review.stdout)
    assert.equal(reviewOutput.optional, true)
    assert.equal(
      reviewOutput.url,
      "https://chrome.google.com/webstore/detail/oldjmlmncilgeagpfgkcjjlkbfbkiggk/reviews"
    )
    assert.match(reviewOutput.note, /honest experience/)

    const plan = await runCli({
      home,
      args: [
        "agent",
        "--no-telemetry",
        "--app-url",
        "http://127.0.0.1:1",
      ],
    })
    assert.equal(plan.code, 0, plan.stderr)
    const extensionAction = JSON.parse(plan.stdout).actions.find(
      (action) => action.id === "chrome-extension"
    )
    assert.equal(extensionAction.credits, 0)
    assert.equal(extensionAction.verification, "extension_session")
    assert.equal(extensionAction.platform, "chrome_web_store")
    assert.equal(extensionAction.browserAssist.mode, "manual_record")
    assert.match(extensionAction.completeCommand, /extension open/)
    assert.match(extensionAction.reviewUrl, /\/reviews$/)

    const complete = await runCli({
      home,
      args: ["complete", "chrome-extension", "--no-telemetry"],
    })
    assert.equal(complete.code, 1)
    assert.match(complete.stderr, /must verify this task itself/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
