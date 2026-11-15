import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const cli = fileURLToPath(new URL("../indiecorns/bin/indiecorns.mjs", import.meta.url))
const endpoint = "/api/herd/v1/campaigns"
const campaignId = "6adccd76-8b61-4ff5-934e-76ae2dfd1b6e"

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "indiecorns-campaign-"))
  const requests = []
  const accounts = new Map()
  let signingInAs = "alpha"
  let fail = false
  let redirect = false
  const server = createServer(async (request, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    const url = new URL(request.url, "http://127.0.0.1")
    const actorFor = (id, secret) => {
      const account = accounts.get(id)
      return account?.secret === secret ? account?.actor : undefined
    }
    const actor = actorFor(request.headers["x-indiecorns-cli-session"], request.headers["x-indiecorns-cli-secret"])
    response.setHeader("Content-Type", "application/json")
    if (url.pathname === "/api/public/cli/session") {
      response.writeHead(404).end("{}")
      return
    }
    if (url.pathname === "/api/cli/sessions" && request.method === "POST") {
      const id = `session-${signingInAs}`
      const secret = `secret-${signingInAs}`
      accounts.set(id, { actor: signingInAs, secret })
      response.end(JSON.stringify({ id, secret }))
      return
    }
    if (url.pathname === "/api/cli/sessions" && request.method === "GET") {
      const userId = actorFor(url.searchParams.get("id"), url.searchParams.get("secret"))
      response.end(JSON.stringify(userId ? { status: "completed", userId } : { status: "pending" }))
      return
    }
    if (url.pathname === "/api/onboarding/actions" && actor) {
      response.end(JSON.stringify({ saved: true }))
      return
    }
    requests.push({ method: request.method, path: request.url, actor, body })
    response.setHeader("Cache-Control", "public, max-age=3600")
    if (request.url !== endpoint || !actor || fail) {
      response.statusCode = fail ? 503 : 401
      response.end(JSON.stringify({ error: "private response detail" }))
      return
    }
    if (redirect) {
      response.writeHead(307, { Location: "/credential-trap" })
      response.end()
      return
    }
    if (request.method === "POST") {
      const result = body.operation === "create" ? { campaign: { id: campaignId } } :
        body.operation === "cancel" ? { ok: true } : { preferences: { paused: body.paused } }
      response.end(JSON.stringify(result))
      return
    }
    response.end(JSON.stringify({
      myCampaigns: [{ id: actor }],
      forYou: [{ campaign: { id: "recommended" }, reason: "Matches software" }],
      preferences: { topics: [actor], paused: false },
      results: [{ campaignId: actor, signups: null }],
    }))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const app = `http://127.0.0.1:${server.address().port}`
  const execute = (args, { token = "", input, appUrl = app } = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--app-url", appUrl, "--json", "--no-telemetry"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, INDIECORNS_TOKEN: token, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", code => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  })
  const signIn = async actor => {
    signingInAs = actor
    const login = success(await execute(["login", "--no-open"]))
    assert.equal(login.status, "browser_auth_required")
    assert.equal(success(await execute(["status"])).authenticated, true)
  }
  const run = (args, options) => execute(["campaign", ...args], options)
  return { home, app, signIn, run, requests, unavailable: () => { fail = true }, redirect: () => { redirect = true } }
}

const success = result => {
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, "")
  return JSON.parse(result.stdout)
}

test("campaign reads use current authenticated actor without cached or cross-origin credentials", async t => {
  const f = await fixture(t)
  assert.equal((await f.run(["list"])).code, 1)
  assert.equal(f.requests.length, 0)

  await f.signIn("alpha")
  assert.deepEqual(success(await f.run(["list"])), [{ id: "alpha" }])
  assert.deepEqual(success(await f.run(["summary"])), [{ campaignId: "alpha", signups: null }])
  assert.equal(success(await f.run(["recommendations"]))[0].reason, "Matches software")

  await f.signIn("beta")
  assert.deepEqual(success(await f.run(["list"])), [{ id: "beta" }])
  assert.deepEqual(success(await f.run(["preferences"])), { topics: ["beta"], paused: false })

  const crossOrigin = await f.run(["list"], { appUrl: f.app.replace("127.0.0.1", "localhost") })
  assert.match(JSON.parse(crossOrigin.stderr).error, /another app origin/)
  const envOverride = await f.run(["list"], { token: "ic_should_not_override" })
  assert.match(JSON.parse(envOverride.stderr).error, /Unset INDIECORNS_TOKEN/)
  assert.equal(f.requests.length, 5)
  f.unavailable()
  const unavailable = await f.run(["list"])
  assert.equal(unavailable.code, 1)
  assert.equal(unavailable.stdout, "")
  assert.doesNotMatch(unavailable.stderr, /alpha|secret-beta|private response detail/)
  assert.deepEqual(await readdir(join(f.home, ".indiecorns")), ["config.json"])
  assert.deepEqual(f.requests.map(request => request.actor), ["alpha", "alpha", "alpha", "beta", "beta", "beta"])
})

test("campaign writes forward only explicit supplied content and never follow auth redirects", async t => {
  const f = await fixture(t)
  await f.signIn("alpha")
  const campaign = {
    clientEventId: "7b035f31-5d2c-4107-a417-f10affb76c0c", title: "Original = title", description: "Original\nmultiline description.  ",
    productUrl: "https://indiecorns.com/?ref=campaign", topics: ["software"], audience: "indie builders",
    language: "en", allowPublicSpotlight: false,
  }
  const create = input => f.run(["create", "--stdin"], { input: JSON.stringify(input) })
  assert.equal((await f.run(["create"])).code, 1)
  assert.equal((await create({ ...campaign, userId: "beta" })).code, 1)
  assert.equal((await create({ ...campaign, allowPublicSpotlight: undefined })).code, 1)
  assert.equal((await f.run(["cancel", "id", "--account", "beta"])).code, 1)
  assert.equal(f.requests.length, 0)

  assert.deepEqual(success(await create(campaign)), { campaign: { id: campaignId } })
  assert.deepEqual(f.requests.at(-1).body, { ...campaign, operation: "create" })

  const preferences = {
    topics: ["tools"], languages: ["en"], audiences: [], mutedTopics: [], paused: true,
    digestEnabled: false, quietHours: null, productName: "Indiecorns", productUrl: "https://indiecorns.com/",
  }
  const file = join(f.home, "my=preferences.json")
  await writeFile(file, JSON.stringify(preferences))
  assert.deepEqual(success(await f.run(["preferences", "--file", file])), { preferences: { paused: true } })
  assert.deepEqual(f.requests.at(-1).body, { ...preferences, operation: "update_preferences" })
  assert.deepEqual(success(await f.run(["cancel", campaignId])), { ok: true })
  assert.deepEqual(f.requests.at(-1).body, { campaignId, operation: "cancel" })

  f.redirect()
  const uncertain = await create(campaign)
  assert.equal(uncertain.code, 1)
  assert.match(uncertain.stderr, /Check current campaign state/)
  assert.equal(f.requests.length, 4)
  assert.ok(f.requests.every(request => request.path === endpoint && request.method === "POST"))
})
