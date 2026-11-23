import { createHash } from 'node:crypto'
import { credentialContext } from './auth-context.mjs'

const WEEK = 7 * 86400000
const hasWhitespaceOrControl = value => /[\x00-\x20\x7f-\x9f]/.test(value)
const decimal = value => typeof value === 'string' &&
  !hasWhitespaceOrControl(value) && /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n
const identifier = value => typeof value === 'string' &&
  !hasWhitespaceOrControl(value) && /^[A-Za-z0-9_-]{1,256}$/.test(value)
const slackId = (value, pattern) => typeof value === 'string' &&
  !hasWhitespaceOrControl(value) && pattern.test(value)
const safeText = value => value.replace(
  /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' '
)

export const mentionBinding = (appUrl, headers) => createHash('sha256')
  .update(JSON.stringify([new URL(appUrl).origin, credentialContext(headers)]))
  .digest('hex')

const emptyInbox = () => ({ cursor: '0', announcedCursor: '0', items: [], hasMore: false })

export function prepareMentions(state, appUrl, headers, now = Date.now()) {
  const binding = mentionBinding(appUrl, headers)
  if (state.mentions?.binding !== binding) {
    state.mentions = { binding, ...emptyInbox(), status: 'pending' }
  }
  state.mentions.items = state.mentions.items
    .filter(item => item.createdAt >= now - WEEK).slice(-200)
  return state.mentions
}

function validPermalink(value, channelId) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) {
    return false
  }
  try {
    const url = new URL(value)
    const validHost = /^([a-z0-9][a-z0-9-]*)\.slack\.com$/.test(url.hostname)
    const validPath = new RegExp(`^/archives/${channelId}/p[0-9]+$`).test(url.pathname)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.hash || !validHost || !validPath) return false
    return [...url.searchParams].every(([key, val]) => key === 'thread_ts'
      ? /^\d+\.\d+$/.test(val)
      : key === 'cid' && val === channelId)
  } catch {
    return false
  }
}

function validEnvelope(envelope, now) {
  return envelope && envelope.version === 1 && identifier(envelope.actorId) &&
    ['ready', 'membership_required', 'unavailable'].includes(envelope.status) &&
    Number.isSafeInteger(envelope.observedAt) && Number.isSafeInteger(envelope.expiresAt) &&
    envelope.observedAt <= now && envelope.expiresAt > now &&
    envelope.expiresAt > envelope.observedAt &&
    envelope.expiresAt - envelope.observedAt <= 300000
}

function validItem(item, previous, channelId, now) {
  return item && decimal(item.id) && BigInt(item.id) > previous &&
    slackId(item.senderId, /^[UW][A-Z0-9]+$/) &&
    typeof item.text === 'string' && item.text.length <= 500 &&
    validPermalink(item.permalink, channelId) && Number.isSafeInteger(item.createdAt) &&
    item.createdAt <= now && item.createdAt >= now - WEEK
}

// Validate the entire page before changing a cursor or retaining any message.
export function ingestMentions(state, envelope, { now = Date.now(), snapshot } = {}) {
  const inbox = state.mentions
  if (envelope === undefined) {
    inbox.status = 'unsupported'
    inbox.hasMore = false
    return
  }
  const invalid = () => {
    inbox.status = 'invalid'
    inbox.hasMore = false
    return false
  }
  if (!validEnvelope(envelope, now)) return invalid()

  if (envelope.status !== 'ready') {
    if (!Array.isArray(envelope.items) || envelope.items.length ||
        !['0', undefined].includes(envelope.nextCursor) || envelope.hasMore !== false) {
      return invalid()
    }
    if (envelope.status === 'membership_required') {
      Object.assign(inbox, emptyInbox(), { actorId: envelope.actorId })
      delete inbox.workspaceId
      delete inbox.channelId
    }
    inbox.hasMore = false
    inbox.status = envelope.status
    inbox.expiresAt = envelope.expiresAt
    return
  }

  const validScope = slackId(envelope.workspaceId, /^T[A-Z0-9]+$/) &&
    slackId(envelope.channelId, /^[CG][A-Z0-9]+$/)
  const matchesSnapshot = !snapshot ||
    snapshot.workspaceId === envelope.workspaceId && snapshot.channelId === envelope.channelId
  if (!validScope || !matchesSnapshot || !Array.isArray(envelope.items) ||
      envelope.items.length > 200 || !decimal(envelope.nextCursor) ||
      typeof envelope.hasMore !== 'boolean') return invalid()

  const contextChanged = inbox.actorId && inbox.actorId !== envelope.actorId ||
    inbox.workspaceId && inbox.workspaceId !== envelope.workspaceId ||
    inbox.channelId && inbox.channelId !== envelope.channelId
  // A page requested with a previous identity's cursor cannot establish catch-up.
  if (contextChanged) {
    Object.assign(inbox, emptyInbox(), {
      actorId: envelope.actorId,
      workspaceId: envelope.workspaceId,
      channelId: envelope.channelId,
      status: 'pending',
    })
    return
  }

  let previous = BigInt(inbox.cursor)
  const items = []
  for (const item of envelope.items) {
    if (!validItem(item, previous, envelope.channelId, now)) return invalid()
    previous = BigInt(item.id)
    items.push({
      id: item.id, senderId: item.senderId, text: safeText(item.text),
      permalink: item.permalink, createdAt: item.createdAt,
    })
  }
  const cursor = BigInt(envelope.nextCursor)
  if (cursor !== previous || envelope.hasMore && cursor <= BigInt(inbox.cursor)) {
    return invalid()
  }
  Object.assign(inbox, {
    actorId: envelope.actorId,
    workspaceId: envelope.workspaceId,
    channelId: envelope.channelId,
    status: 'ready',
    expiresAt: envelope.expiresAt,
    cursor: envelope.nextCursor,
    hasMore: envelope.hasMore,
    items: [...inbox.items, ...items].filter(item => item.createdAt >= now - WEEK).slice(-200),
  })
}

export function mentionView(state, { appUrl, headers, now = Date.now() } = {}) {
  const inbox = state?.mentions
  if (!headers || !inbox || inbox.binding !== mentionBinding(appUrl, headers)) {
    return { status: 'pending', items: [] }
  }
  const status = inbox.status === 'ready' && inbox.expiresAt <= now ? 'expired' : inbox.status
  return {
    status,
    items: status === 'ready' ? inbox.items.filter(item => item.createdAt >= now - WEEK)
      .map(item => ({ ...item, text: safeText(item.text) })) : [],
    hasMore: status === 'ready' && inbox.hasMore === true,
  }
}

export function unannouncedMentions(state, view) {
  const cursor = state?.mentions?.announcedCursor ?? '0'
  if (!decimal(cursor)) throw new Error('Invalid notification announcement cursor')
  return view.items.filter(item => BigInt(item.id) > BigInt(cursor))
}

export function mentionsText(view) {
  return [
    'INDIECORNS · Slack @indiecorns notifications',
    view.items.length ? `${view.items.length} saved notification(s)`
      : `No available notifications (${view.status}).`,
    ...view.items.flatMap(item => ['', `${item.senderId}: ${item.text}`, item.permalink]),
    ...(view.hasMore ? ['', 'Catching up; the worker will fetch the next page automatically.'] : []),
  ].join('\n')
}
