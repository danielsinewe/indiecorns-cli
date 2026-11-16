import { createHash } from "node:crypto"
import { credentialContext, credentialRevision } from "./auth-context.mjs"

const day = 86400000
const maxRequests = 200
const freshnessMs = 300000
const clockSkewMs = 60000
const actions = new Set(["review", "feedback", "share", "upvote"])
const patterns = new Map([
  ["peerlist", { host: "peerlist.io", path: /^\/[a-z0-9_-]+\/project\/[a-z0-9_-]+$/i }],
  ["producthunt", { host: "producthunt.com", path: /^\/(?:posts|products)\/[a-z0-9_-]+$/i }],
  ["x", { host: "x.com", path: /^\/[a-z0-9_]+\/status\/\d+$/i }],
  ["linkedin", { host: "linkedin.com", path: /^\/(?:posts\/[a-z0-9_-]+|feed\/update\/urn:li:(?:activity|share|ugcPost):\d+)$/i }],
])
const accountId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const timestamp = value => Number.isSafeInteger(value) && value >= 0

function targetUrl(platform, value) {
  if (typeof value !== "string" || value.length > 512 || value.trim() !== value || /[?#]/.test(value)) return false
  try {
    const url = new URL(value)
    const pattern = patterns.get(platform)
    return url.href === value && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && !url.search &&
      url.hostname === pattern.host && pattern.path.test(url.pathname)
  } catch {
    return false
  }
}

function validateRequest(value, members, now) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.id ?? "") || typeof value.id !== "string" ||
      !patterns.has(value.platform) || !members.has(value.requesterSlackUserId) ||
      value.source !== "slack_launch_request" || value.ownershipVerified !== false ||
      !timestamp(value.createdAt) || !timestamp(value.expiresAt) || value.createdAt > now + clockSkewMs ||
      value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > 7 * day ||
      !Array.isArray(value.requestedActions) || !value.requestedActions.length ||
      value.requestedActions.length > actions.size ||
      new Set(value.requestedActions).size !== value.requestedActions.length ||
      value.requestedActions.some(action => !actions.has(action))) {
    throw new Error("Invalid launch request")
  }
  if ((value.status === "needs_link" && value.targetUrl != null) ||
      (value.status === "review_available" && !targetUrl(value.platform, value.targetUrl)) ||
      !["needs_link", "review_available"].includes(value.status)) throw new Error("Invalid launch request link")
  return {
    id: value.id,
    platform: value.platform,
    requesterSlackUserId: value.requesterSlackUserId,
    source: value.source,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    requestedActions: [...value.requestedActions],
    status: value.status,
    ownershipVerified: false,
    ...(value.status === "review_available" ? { targetUrl: value.targetUrl } : {}),
  }
}

function supportBinding(appUrl, headers, actorId = null) {
  return createHash("sha256").update(JSON.stringify([
    new URL(appUrl).origin, credentialRevision(headers), actorId,
  ])).digest("hex")
}

export function supportFeedState(previous, { appUrl, headers, status, now }) {
  const binding = supportBinding(appUrl, headers)
  if (previous?.binding === binding && status === "unavailable" && Array.isArray(previous.requests)) {
    return { ...previous, status, requests: previous.requests.filter(request => request.expiresAt > now) }
  }
  return { version: 1, binding, status, requests: [] }
}

export function ingestSupportFeed(previous, { appUrl, headers, support, snapshot, expectedActorId, now }) {
  if (support === undefined) return supportFeedState(previous, { appUrl, headers, status: "endpoint_unsupported", now })
  if (!support || support.version !== 1 || !accountId(support.actorId) ||
      !["ready", "membership_required", "unavailable"].includes(support.status) ||
      !timestamp(support.observedAt) || !timestamp(support.expiresAt) ||
      support.observedAt > now + clockSkewMs || support.expiresAt < support.observedAt ||
      support.expiresAt - support.observedAt > freshnessMs ||
      !Array.isArray(support.requests) || support.requests.length > maxRequests ||
      (support.status === "ready" && (support.expiresAt <= now || support.expiresAt > snapshot.expiresAt)) ||
      (support.status !== "ready" && support.requests.length)) throw new Error("Invalid support feed")
  if (expectedActorId && support.actorId !== expectedActorId) throw new Error("Support actor mismatch")

  const members = new Set(snapshot.memberIds)
  const scopedBinding = supportBinding(appUrl, headers, support.actorId)
  const requests = new Map()
  if (support.status === "ready" || support.status === "unavailable") {
    if (previous?.scopedBinding === scopedBinding && Array.isArray(previous.requests)) {
      for (const request of previous.requests) {
        if (request.expiresAt > now && members.has(request.requesterSlackUserId)) requests.set(request.id, request)
      }
    }
    for (const value of support.requests) {
      const request = validateRequest(value, members, now)
      const prior = requests.get(request.id)
      if (prior && (prior.createdAt !== request.createdAt ||
          prior.requesterSlackUserId !== request.requesterSlackUserId)) throw new Error("Conflicting launch request")
      if (request.expiresAt > now) requests.set(request.id, request)
    }
  }
  return {
    version: 1,
    binding: supportBinding(appUrl, headers),
    scopedBinding,
    actorId: support.actorId,
    status: support.status,
    observedAt: support.observedAt,
    expiresAt: Math.min(support.expiresAt, snapshot.expiresAt),
    requests: [...requests.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, maxRequests),
  }
}

const instructions = {
  auth_required: "Sign in to Indiecorns on this CLI to read your launch requests.",
  account_origin_mismatch: "Sign in to the selected Indiecorns app origin before reading launch requests.",
  source_required: "Use the Indiecorns community feed as your worker's Slack source to receive launch requests.",
  awaiting_sync: "A signed-in worker syncs launch requests on its next community feed poll.",
  endpoint_unsupported: "The community feed endpoint does not yet return launch requests.",
  membership_required: "Your Indiecorns account needs active membership in the configured community Slack channel.",
  unavailable: "The last community feed check could not verify current launch requests.",
  stale: "Community evidence has expired. Wait for the next successful worker check.",
  ready: "Launch inbox synced.",
}

export function supportInboxReport(inbox, { appUrl, headers, expectedActorId, sourceAvailable = true, originMatches = true, now = Date.now(), includeRequests = true, platform }) {
  let status
  if (!credentialContext(headers).length) status = "auth_required"
  else if (!originMatches) status = "account_origin_mismatch"
  else if (!sourceAvailable) status = "source_required"
  else if (inbox?.binding !== supportBinding(appUrl, headers) ||
      (inbox.actorId && inbox.scopedBinding !== supportBinding(appUrl, headers, inbox.actorId)) ||
      (expectedActorId && inbox.actorId && expectedActorId !== inbox.actorId)) status = "awaiting_sync"
  else if (inbox.status === "ready" && inbox.expiresAt <= now) status = "stale"
  else status = inbox.status

  const visible = status === "ready" ? inbox.requests.filter(request =>
    request.expiresAt > now && (!platform || request.platform === platform)) : []
  return {
    status,
    count: visible.length,
    needsLinkCount: visible.filter(request => request.status === "needs_link").length,
    ...(status === "ready" ? { observedAt: inbox.observedAt, expiresAt: inbox.expiresAt } : {}),
    automaticExternalActions: false,
    requirement: instructions[status],
    ...(includeRequests ? { requests: visible.map(request => ({
      ...request,
      requirement: request.status === "needs_link"
        ? "The requester needs to supply the exact launch link."
        : "Decide independently whether to review the launch and give genuine first-hand feedback.",
    })) } : {}),
  }
}
