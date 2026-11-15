import { createReadStream } from "node:fs"

const endpoint = "/api/herd/v1/campaigns"
const readViews = {
  list: "myCampaigns",
  recommendations: "forYou",
  preferences: "preferences",
  summary: "results",
}
const commands = "Use campaign list, recommendations, summary, create, cancel, or preferences."
const uncertainWrite = "Campaign request did not return a receipt. Check current campaign state before retrying."
const createFields = new Set([
  "clientEventId", "title", "description", "productUrl", "links",
  "topics", "audience", "language", "startsAt", "expiresAt", "allowPublicSpotlight",
])

const preferenceFields = new Set([
  "topics", "languages", "audiences", "mutedTopics", "paused",
  "digestEnabled", "quietHours", "productName", "productUrl",
])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = value => value && typeof value === "object" && !Array.isArray(value)

async function readDocument(flags, stdin) {
  const file = flags.file
  const useStdin = flags.stdin === true
  if (useStdin === (typeof file === "string" && file.length > 0) ||
      (Object.hasOwn(flags, "stdin") && !useStdin) ||
      (Object.hasOwn(flags, "file") && typeof file !== "string")) {
    throw new Error("Supply one JSON document using --file <path> or --stdin.")
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of useStdin ? stdin : createReadStream(file)) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 32768) throw new Error("Campaign JSON exceeds 32 KiB.")
      chunks.push(bytes)
    }
  } catch (error) {
    if (error.code) throw new Error("Could not read the supplied campaign JSON document.")
    throw error
  }

  let document
  try {
    document = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error("Supply a valid JSON object.")
  }
  if (!isObject(document)) {
    throw new Error("Supply a valid JSON object.")
  }
  return document
}

export async function runCampaign({ args, flags, appUrl, sessionOrigin, headers, stdin = process.stdin }) {
  const [command = "list", id, ...extra] = args
  const readView = Object.hasOwn(readViews, command) ? readViews[command] : null
  if ((!readView && !["create", "cancel"].includes(command)) || extra.length ||
      (id !== undefined && command !== "cancel") || (command === "cancel" && !id)) {
    throw new Error(commands)
  }

  const updatingPreferences = command === "preferences" &&
    (Object.hasOwn(flags, "file") || Object.hasOwn(flags, "stdin"))
  const usesDocument = command === "create" || updatingPreferences
  const allowedFlags = new Set(["app-url", "json", "no-telemetry", "no-open", "agent"])
  if (usesDocument) {
    allowedFlags.add("file")
    allowedFlags.add("stdin")
  }
  if (Object.keys(flags).some(flag => !allowedFlags.has(flag))) {
    throw new Error("Unsupported campaign option. Campaign requests use the authenticated CLI account.")
  }
  if (command === "cancel" && !uuid.test(id)) throw new Error("Supply a valid campaign ID.")
  if (!headers) throw new Error("Connect your Indiecorns account with indiecorns login first.")

  const url = new URL(endpoint, appUrl)
  if (sessionOrigin && new URL(sessionOrigin).origin !== url.origin) {
    throw new Error("The saved Indiecorns session belongs to another app origin. Sign in to the requested origin first.")
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Indiecorns campaign requests require HTTPS.")
  }

  let body
  if (usesDocument) {
    const document = await readDocument(flags, stdin)
    const allowed = updatingPreferences ? preferenceFields : createFields
    if (!Object.keys(document).length || Object.keys(document).some(field => !allowed.has(field))) {
      throw new Error("The JSON document contains an unsupported field.")
    }
    if (command === "create" &&
        (!["title", "description", "productUrl", "audience", "language"].every(
          field => typeof document[field] === "string" && document[field].trim()
        ) || !Array.isArray(document.topics) || typeof document.allowPublicSpotlight !== "boolean")) {
      throw new Error("Supply title, description, productUrl, audience, language, topics, and an explicit allowPublicSpotlight value.")
    }
    if (command === "create" && (typeof document.clientEventId !== "string" || !uuid.test(document.clientEventId))) {
      throw new Error("Supply a stable clientEventId in UUID format.")
    }
    body = { ...document, operation: updatingPreferences ? "update_preferences" : "create" }
  }
  if (command === "cancel") body = { operation: "cancel", campaignId: id }

  const requestBody = body ? JSON.stringify(body) : undefined
  if (requestBody && Buffer.byteLength(requestBody) > 24576) {
    throw new Error("Campaign request exceeds 24 KiB.")
  }

  let response
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: requestBody,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error(body ? uncertainWrite : "Indiecorns campaign service is unavailable.")
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("The Indiecorns campaign request was not authorized. Check your CLI sign-in.")
  }
  if (body && response.status >= 500) throw new Error(uncertainWrite)
  if (!response.ok) throw new Error(`Indiecorns campaign request failed (HTTP ${response.status}).`)
  let result
  try {
    result = await response.json()
    if (!isObject(result)) throw new Error()
    if (command === "preferences" && !isObject(result.preferences)) throw new Error()
    if (readView && command !== "preferences" && !Array.isArray(result[readView])) throw new Error()
    if (command === "create" &&
        (typeof result.campaign?.id !== "string" || !uuid.test(result.campaign.id))) throw new Error()
    if (command === "cancel" && result.ok !== true) throw new Error()
  } catch {
    throw new Error("Indiecorns returned an invalid campaign response. Check current campaign state before retrying a change.")
  }
  return body ? result : result[readView]
}
