import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { syncCommunityFeed } from "../indiecorns/lib/community-feed.mjs"
import { supportInboxReport } from "../indiecorns/lib/support-inbox.mjs"

const appUrl = "https://app.indiecorns.com"
const week = 7 * 86400000
const start = 1700000000000
const headersFor = actor => ({
  "x-indiecorns-cli-session": `fixture-${actor}`,
  "x-indiecorns-cli-secret": `credential-${actor}`,
})
const snapshotAt = (now, memberIds = ["UJUAN"]) => ({
  version: 1, workspaceId: "TTEST", channelId: "CTEST", observedAt: now,
  expiresAt: now + 86400000, memberIds, identities: [],
})
const linkless = {
  id: "a".repeat(64), platform: "peerlist", requesterSlackUserId: "UJUAN", source: "slack_launch_request",
  createdAt: start - 1000, expiresAt: start + week - 1000,
  requestedActions: ["feedback", "upvote"], status: "needs_link", ownershipVerified: false,
}
const linked = {
  ...linkless, id: "b".repeat(64), status: "review_available", targetUrl: "https://peerlist.io/juan/project/denker",
}
const envelope = (actorId, now, requests, status = "ready") => ({
  version: 1, actorId, status, observedAt: now, expiresAt: now + 300000, requests,
})
const response = (now, support, { cursor = "", latest = "1700000000.000000", memberIds, targets = [] } = {}) =>
  Response.json({ version: 1, snapshot: snapshotAt(now, memberIds), targets, cursor, latest, support })
const report = (state, actor, now, overrides = {}) =>
  supportInboxReport(state.supportInbox, { appUrl, headers: headersFor(actor), expectedActorId: actor, now, ...overrides })

test("support pages persist minimal, same-actor requests without queuing social jobs", async () => {
  let now = start
  let state = { jobs: {}, actions: { original: { status: "completed" } }, actionBudget: { attempts: 2 } }
  const checkpoints = []
  let polls = 0
  const sync = () => syncCommunityFeed({
    state, appUrl, headers: headersFor("actorA"), expectedActorId: "actorA", now: () => now,
    checkpoint: () => checkpoints.push(structuredClone(state)),
    request: async (url, options) => {
      assert.equal(url.origin, appUrl)
      assert.equal(url.searchParams.get("support"), "1")
      assert.equal(options.method, undefined)
      if (++polls === 1) return response(now, envelope("actorA", now, [{ ...linkless, text: "private Slack body" }]), { cursor: "page-2" })
      assert.equal(url.searchParams.get("cursor"), "page-2")
      return response(now, envelope("actorA", now, [linkless, linked, linked]))
    },
  })
  await sync()
  assert.equal(checkpoints.at(-1).communityFeed.cursor, "page-2")
  assert.deepEqual(checkpoints.at(-1).supportInbox.requests, [linkless])
  assert.doesNotMatch(JSON.stringify(state), /private Slack body|credential-actorA/)
  state = JSON.parse(JSON.stringify(state))
  await sync()
  assert.equal(polls, 1)
  now += 60001
  await sync()
  const result = report(state, "actorA", now)
  assert.equal(result.count, 2)
  assert.equal(result.needsLinkCount, 1)
  assert.equal(result.automaticExternalActions, false)
  assert.match(result.requests[0].requirement, /supply the exact launch link/)
  assert.equal(result.requests[1].targetUrl, linked.targetUrl)
  assert.deepEqual(state.jobs, {})
  assert.deepEqual(state.actions, { original: { status: "completed" } })
  assert.deepEqual(state.actionBudget, { attempts: 2 })
  assert.equal(state.communityFeed.supportCatchup.status, "complete")
})

test("stale, unsupported, unavailable and revoked support never return cached requests", async () => {
  let now = start
  const state = { jobs: {}, actions: { preserved: { status: "completed" } } }
  const sync = async reply => {
    await syncCommunityFeed({ state, appUrl, headers: headersFor("actorA"), now: () => now, request: async () => reply })
    now += 300001
  }
  await sync(response(now, undefined))
  assert.equal(report(state, "actorA", now).status, "endpoint_unsupported")
  await sync(response(now, envelope("actorA", now, [linked])))
  assert.equal(report(state, "actorA", now - 1000).status, "ready")
  assert.equal(report(state, "actorA", now).status, "stale")
  assert.equal(report(state, "actorA", now - 1000, { headers: headersFor("actorB") }).count, 0)
  assert.equal(report(state, "actorB", now - 1000, { headers: headersFor("actorA") }).count, 0)

  await sync(response(now, envelope("actorA", now, [], "unavailable")))
  assert.equal(report(state, "actorA", now).status, "unavailable")
  assert.deepEqual(report(state, "actorA", now).requests, [])
  await sync(response(now, envelope("actorA", now, [], "membership_required")))
  assert.equal(report(state, "actorA", now).status, "membership_required")
  assert.deepEqual(state.supportInbox.requests, [])

  await sync(response(now, envelope("actorA", now, [linkless])))
  await sync(new Response("", { status: 403 }))
  assert.equal(report(state, "actorA", now).status, "auth_required")
  assert.deepEqual(state.supportInbox.requests, [])
  assert.equal(state.lastError, "auth_required")
  assert.equal(state.actions.preserved.status, "completed")

  await syncCommunityFeed({
    state, appUrl, headers: headersFor("actorB"), now: () => now,
    request: async () => response(now, envelope("actorB", now, [])),
  })
  assert.equal(report(state, "actorB", now).status, "ready")
  assert.deepEqual(report(state, "actorB", now).requests, [])
  assert.equal(report(state, "actorA", now).status, "awaiting_sync")
})

test("actor change with unchanged headers also conceals earlier requests", async () => {
  let now = start
  const state = { jobs: {} }
  const sync = (actor, requests) => syncCommunityFeed({
    state, appUrl, headers: headersFor("same"), now: () => now,
    request: async () => response(now, envelope(actor, now, requests)),
  })
  await sync("actorA", [linked])
  assert.equal(report(state, "actorA", now, { headers: headersFor("same") }).count, 1)
  now += 300001
  await sync("actorB", [])
  assert.equal(report(state, "actorA", now, { headers: headersFor("same") }).count, 0)
  assert.equal(report(state, "actorB", now, { headers: headersFor("same") }).status, "ready")
  assert.deepEqual(state.supportInbox.requests, [])
})

test("malformed support does not advance the normal cursor or ingest link jobs", async () => {
  const bad = [
    { ...linked, targetUrl: "https://peerlist.io.evil.example/juan/project/denker" },
    { ...linked, targetUrl: linked.targetUrl + "?utm_source=fake" },
    { ...linked, targetUrl: "https://peerlist.io/launchpad/2026/week/46" },
    { ...linked, targetUrl: "https://peerlist.io:443/juan/project/denker" },
    { ...linked, requesterSlackUserId: "UDEPARTED" },
    { ...linked, expiresAt: start + week + 4000 },
    { ...linked, ownershipVerified: true },
  ]
  for (const request of bad) {
    const state = { jobs: {} }
    await syncCommunityFeed({
      state, appUrl, headers: headersFor("actorA"), now: () => start,
      request: async () => response(start, envelope("actorA", start, [request]), {
        cursor: "uncommitted",
        targets: [{ platform: "peerlist", eventType: "inspect", profileUrl: linked.targetUrl }],
      }),
    })
    assert.equal(state.communityFeed.cursor, "")
    assert.equal(state.communityFeed.health, "invalid_feed")
    assert.equal(report(state, "actorA", start).status, "unavailable")
    assert.deepEqual(state.jobs, {})
  }
})

test("one bounded catch-up waits for the legacy cursor chain and retains the existing latest watermark", async () => {
  let now = start
  let state = { jobs: {}, actions: { existing: { status: "completed" } } }
  const calls = []
  const sync = (support, page) => syncCommunityFeed({
    state, appUrl, headers: headersFor("actorA"), now: () => now,
    request: async url => {
      calls.push(Object.fromEntries(url.searchParams))
      return response(now, support, page)
    },
  })
  await sync(undefined, { cursor: "old-page-2", latest: "1700000000.000000" })
  now += 60001
  await sync(envelope("actorA", now, []), { cursor: "old-page-3", latest: "1700000000.000001" })
  assert.equal(state.communityFeed.supportCatchup.status, "pending")
  now += 60001
  await sync(envelope("actorA", now, []), { latest: "1700000000.000002" })
  assert.equal(calls.at(-1).cursor, "old-page-3")
  assert.equal(calls.at(-1).oldest, "0")
  now += 300001
  const recovered = { ...linkless, createdAt: start - 2 * 86400000, expiresAt: start + 5 * 86400000 }
  await sync(envelope("actorA", now, [recovered]), { cursor: "catch-up-page-2", latest: "1699999900.000000" })
  const originalCutoff = calls.at(-1).oldest
  assert.ok(Number(originalCutoff) >= (start - week) / 1000)
  assert.ok(Number(originalCutoff) < start / 1000)
  assert.equal(calls.at(-1).cursor, undefined)
  assert.equal(state.communityFeed.oldest, "1700000000.000002")
  assert.equal(state.communityFeed.supportCatchup.status, "running")
  state = JSON.parse(JSON.stringify(state))
  now += 60001
  await sync(envelope("actorA", now, [], "unavailable"), { latest: "1699999999.000000" })
  assert.equal(state.communityFeed.cursor, "catch-up-page-2")
  assert.equal(report(state, "actorA", now).status, "unavailable")
  now += 60001
  await sync(envelope("actorA", now, []), { latest: "1699999999.000000" })
  assert.equal(calls.at(-1).cursor, "catch-up-page-2")
  assert.equal(calls.at(-1).oldest, originalCutoff)
  assert.equal(state.communityFeed.supportCatchup.status, "complete")
  assert.equal(report(state, "actorA", now).needsLinkCount, 1)
  assert.equal(state.actions.existing.status, "completed")
  now += 300001
  await sync(envelope("actorA", now, []), {})
  assert.equal(calls.at(-1).oldest, "1700000000.000002")
})

test("normal ready deltas prune expired requests and departed requesters", async () => {
  let now = start
  const state = { jobs: {} }
  const sync = (requests, memberIds) => syncCommunityFeed({
    state, appUrl, headers: headersFor("actorA"), now: () => now,
    request: async () => response(now, envelope("actorA", now, requests), { memberIds }),
  })
  const almostExpired = { ...linked, createdAt: now - week + 2000, expiresAt: now + 2000 }
  await sync([linkless, almostExpired], ["UJUAN"])
  assert.equal(report(state, "actorA", now + 2001).count, 1)
  now += 300001
  await sync([], [])
  assert.equal(report(state, "actorA", now).count, 0)
  assert.deepEqual(state.supportInbox.requests, [])
})

test("real CLI worker consumes launch requests without social calls and status hides earlier accounts", t => {
  const directory = mkdtempSync(join(tmpdir(), "indiecorns-support-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const configDir = join(directory, ".indiecorns")
  mkdirSync(configDir)
  const configPath = join(configDir, "config.json")
  const connect = actor => writeFileSync(configPath, JSON.stringify({
    browserSession: { appUrl, userId: actor, cliSessionId: `fixture-${actor}`, cliSecret: `credential-${actor}` },
  }))
  connect("actorA")
  const stub = join(directory, "stub.mjs")
  const calls = join(directory, "calls.jsonl")
  writeFileSync(stub, `
    import {appendFileSync} from "node:fs"
    globalThis.fetch=async (input, opts={})=>{
      const url=new URL(input), method=opts.method || "GET"
      appendFileSync(${JSON.stringify(calls)}, JSON.stringify({origin:url.origin,path:url.pathname,query:url.search,method})+"\\n")
      if (url.origin !== ${JSON.stringify(appUrl)}) throw new Error("unexpected target")
      if (url.pathname.endsWith("/action-targets")) return Response.json({
        targets: process.argv.includes("peerlist-launches") ? [{
          platform:"peerlist", profileUrl:"https://peerlist.io/another/project/known-launch",
          targetType:"project", targetSource:"projects", displayName:"Known launch",
        }] : [],
        pagination:{hasMore:false,nextCursor:null},
      })
      if (url.pathname.endsWith("/worker-feed") && method==="POST") return Response.json({accepted:true,task:null})
      const now=Date.now(), day=86400000
      const launch={...${JSON.stringify(linkless)},createdAt:now-1000,expiresAt:now+7*day-1000}
      if (url.pathname.endsWith("/worker-feed") && url.searchParams.get("support")==="1") return Response.json({
        version:1, targets:[], cursor:"", latest:"1700000000.000000",
        snapshot:{version:1,workspaceId:"TTEST",channelId:"CTEST",observedAt:now,expiresAt:now+day,memberIds:["UJUAN"],identities:[]},
        support:{version:1,actorId:"actorA",status:"ready",observedAt:now,expiresAt:now+300000,requests:[launch]},
      })
      throw new Error("unexpected feed operation")
    }
  `)
  const cli = fileURLToPath(new URL("../indiecorns/bin/indiecorns.mjs", import.meta.url))
  const environment = {
    ...process.env, HOME: directory, USERPROFILE: directory, INDIECORNS_TOKEN: "",
    INDIECORNS_SLACK_TOKEN: "", INDIECORNS_GITHUB_TOKEN: "", INDIECORNS_PRODUCTHUNT_TOKEN: "",
  }
  const run = (...args) => {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, cli, ...args, "--json", "--no-telemetry"], {
      env: environment, encoding: "utf8", timeout: 20000,
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  run("worker", "run", "--once")
  assert.equal(run("worker", "support").needsLinkCount, 1)
  const legacy = run("peerlist-launches", "--force")
  assert.equal(legacy.launches[0].targetUrl, "https://peerlist.io/another/project/known-launch")
  assert.ok(legacy.targets.every(target => target.recordCommand === undefined))
  assert.deepEqual(legacy.afterProofCommands, [])
  assert.equal(legacy.rating, undefined)
  assert.match(legacy.reminder, /independently/)
  const current = run("worker", "status")
  assert.equal(current.support.count, 1)
  assert.equal(current.state.supportInbox, undefined)
  assert.doesNotMatch(JSON.stringify(current), /credential-actorA|UJUAN.*requesterSlackUserId/)
  connect("actorB")
  assert.deepEqual(run("worker", "support").requests, [])
  assert.equal(run("worker", "status").support.count, 0)
  const network = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse)
  assert.ok(network.some(entry => entry.query.includes("support=1") && entry.method === "GET"))
  assert.ok(network.every(entry => entry.origin === appUrl))
})
