import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const cli = resolve("indiecorns/bin/indiecorns.mjs")

const runCli = ({ args, home }) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolveRun({ code, stdout, stderr }))
  })

test("device-code login exchanges once and uses Bearer auth", async () => {
  const home = await mkdtemp(join(tmpdir(), "indiecorns-cli-test-"))
  const requests = []
  const requestBodies = []
  let completed = false
  let origin = ""

  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    })
    response.setHeader("content-type", "application/json")

    const readBody = async () => {
      let raw = ""
      for await (const chunk of request) raw += chunk
      const body = raw ? JSON.parse(raw) : null
      requestBodies.push({ url: request.url, body })
      return body
    }

    if (request.method === "POST" && request.url === "/api/public/cli/session") {
      response.end(JSON.stringify({
        code: "ABC123",
        verification_url: `${origin}/collective?cli=ABC123`,
        expires_at: "2099-01-01T00:00:00.000Z",
        poll_url: `${origin}/api/public/cli/session/ABC123`,
        exchange_url: `${origin}/api/public/cli/session/ABC123/exchange`,
      }))
      return
    }
    if (request.method === "GET" && request.url === "/api/public/cli/session/ABC123") {
      response.end(JSON.stringify({
        code: "ABC123",
        status: completed ? "completed" : "pending",
        completed_at: completed ? "2026-07-27T06:30:00.000Z" : null,
      }))
      return
    }
    if (request.method === "POST" && request.url === "/api/public/cli/session/ABC123/exchange") {
      response.end(JSON.stringify({
        token: "ic_test_token",
        user_id: "11111111-1111-4111-8111-111111111111",
        token_expires_at: "2099-01-01T00:00:00.000Z",
      }))
      return
    }
    if (request.method === "GET" && request.url?.startsWith("/api/public/cli/agent-plan")) {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      response.end(JSON.stringify({
        credits: 100,
        plan: [{
          key: "cli_install",
          title: "Install the CLI",
          description: "Connect this terminal.",
          category: "setup",
          points: 100,
          required: true,
          action_url: null,
          depends_on: [],
          missing_deps: [],
          status: "completed",
        }],
      }))
      return
    }
    if (request.method === "GET" && request.url === "/api/public/cli/tasks") {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      response.end(JSON.stringify({
        credits: 100,
        tasks: [{
          key: "cli_install",
          title: "Install the CLI",
          description: "Connect this terminal.",
          points: 100,
          required: true,
          category: "setup",
          depends_on: [],
          action_url: null,
          status: "completed",
          completed_at: "2026-07-27T06:30:00.000Z",
        }],
      }))
      return
    }
    if (request.method === "POST" && request.url === "/api/public/cli/external-profiles") {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      await readBody()
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (request.method === "POST" && request.url === "/api/public/cli/launches") {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      const body = await readBody()
      response.end(JSON.stringify({ saved: true, launch: { id: "launch-1", ...body } }))
      return
    }
    if (request.method === "POST" && request.url === "/api/public/cli/posts") {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      const body = await readBody()
      response.end(JSON.stringify({ saved: true, post: { id: "post-1", ...body } }))
      return
    }
    if (request.method === "POST" && request.url === "/api/public/cli/events") {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      await readBody()
      response.end(JSON.stringify({ ok: true, duplicate: false }))
      return
    }
    if (request.method === "GET" && request.url?.startsWith("/api/public/cli/events")) {
      assert.equal(request.headers.authorization, "Bearer ic_test_token")
      response.end(JSON.stringify({
        events: [{
          id: "event-1",
          target_platform: "x",
          target_type: "post",
          action_type: "like",
          target_url: "https://x.com/daniel/status/123",
          target_username: "daniel",
          before_label: "Like",
          after_label: "Liked",
          status: "recorded",
          source: "cli",
          occurred_at: "2026-07-27T06:31:00.000Z",
          verified_at: null,
          idempotency_key: "event-1",
        }],
      }))
      return
    }

    response.statusCode = 404
    response.end(JSON.stringify({ error: "not_found" }))
  })

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen))
  origin = `http://127.0.0.1:${server.address().port}`

  try {
    const login = await runCli({
      home,
      args: ["login", "--json", "--no-open", "--no-telemetry", "--app-url", origin],
    })
    assert.equal(login.code, 0, login.stderr)
    assert.deepEqual(JSON.parse(login.stdout), {
      status: "browser_auth_required",
      mode: "login",
      url: `${origin}/collective?cli=ABC123`,
      code: "ABC123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      message: "Open the login URL to continue with Indiecorns.",
    })

    const pending = await runCli({
      home,
      args: ["status", "--json", "--no-telemetry", "--app-url", origin],
    })
    assert.equal(JSON.parse(pending.stdout).status, "pending")

    completed = true
    const linked = await runCli({
      home,
      args: ["status", "--json", "--no-telemetry", "--app-url", origin],
    })
    assert.equal(linked.code, 0, linked.stderr)
    assert.equal(JSON.parse(linked.stdout).authenticated, true)

    const config = JSON.parse(await readFile(join(home, ".indiecorns", "config.json"), "utf8"))
    assert.equal(config.pendingCliSession, undefined)
    assert.equal(config.browserSession.authMode, "device_code")
    assert.equal(config.browserSession.accessToken, "ic_test_token")
    assert.equal(config.browserSession.cliSecret, undefined)

    const tasks = await runCli({
      home,
      args: ["tasks", "--json", "--no-telemetry", "--app-url", origin],
    })
    assert.equal(tasks.code, 0, tasks.stderr)
    const taskBody = JSON.parse(tasks.stdout)
    assert.equal(taskBody.authenticated, true)
    assert.equal(taskBody.summary.total, 1)
    assert.equal(taskBody.summary.completed, 1)
    assert.equal(taskBody.tasks[0].id, "cli_install")

    assert.equal(
      requests.filter((item) => item.url === "/api/public/cli/session/ABC123/exchange").length,
      1,
    )
    assert.ok(requests.some((item) =>
      item.url?.startsWith("/api/public/cli/agent-plan") &&
      item.authorization === "Bearer ic_test_token"
    ))

    const profile = await runCli({
      home,
      args: [
        "profile", "set", "website", "--profile-url", "https://example.com",
        "--json", "--no-telemetry", "--app-url", origin,
      ],
    })
    assert.equal(profile.code, 0, profile.stderr)
    assert.equal(JSON.parse(profile.stdout).saved, true)

    const launch = await runCli({
      home,
      args: [
        "launch", "set", "peerlist",
        "--url", "https://peerlist.io/daniel/project/indiecorns",
        "--name", "Indiecorns", "--json", "--no-telemetry", "--app-url", origin,
      ],
    })
    assert.equal(launch.code, 0, launch.stderr)
    assert.equal(JSON.parse(launch.stdout).saved, true)

    const post = await runCli({
      home,
      args: [
        "post", "set", "x", "--url", "https://x.com/daniel/status/123",
        "--title", "Launch", "--json", "--no-telemetry", "--app-url", origin,
      ],
    })
    assert.equal(post.code, 0, post.stderr)
    assert.equal(JSON.parse(post.stdout).saved, true)

    const record = await runCli({
      home,
      args: [
        "record", "x", "--type", "like", "--target-type", "post",
        "--target-url", "https://x.com/daniel/status/123", "--target", "daniel",
        "--json", "--no-telemetry", "--app-url", origin,
      ],
    })
    assert.equal(record.code, 0, JSON.stringify(record))
    assert.equal(JSON.parse(record.stdout).saved, true)

    const events = await runCli({
      home,
      args: ["events", "--json", "--no-telemetry", "--app-url", origin],
    })
    assert.equal(events.code, 0, events.stderr)
    assert.equal(JSON.parse(events.stdout).events[0].event_type, "like")

    assert.deepEqual(
      requestBodies.find((item) => item.url === "/api/public/cli/external-profiles")?.body,
      { platform: "website", url: "https://example.com/", username: "example.com" },
    )
    assert.deepEqual(
      requestBodies.find((item) => item.url === "/api/public/cli/launches")?.body,
      {
        platform: "peerlist",
        url: "https://peerlist.io/daniel/project/indiecorns",
        title: "Indiecorns",
      },
    )
    assert.deepEqual(
      requestBodies.find((item) => item.url === "/api/public/cli/posts")?.body,
      {
        platform: "x",
        url: "https://x.com/daniel/status/123",
        title: "Launch",
      },
    )
    const eventBody = requestBodies.find((item) => item.url === "/api/public/cli/events")?.body
    assert.equal(eventBody.target_platform, "x")
    assert.equal(eventBody.target_type, "post")
    assert.equal(eventBody.action_type, "like")
    assert.match(eventBody.idempotency_key, /^cli:x:like:/)
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
    await rm(home, { recursive: true, force: true })
  }
})
