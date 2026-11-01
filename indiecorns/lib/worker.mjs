import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const read = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
// A corrupted state must never silently reset deduplication or action history.
export function saveState(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd) }
  finally { closeSync(fd) }
  renameSync(temporary, path)
}
export function targetKey(target) {
  const url = new URL(target.profileUrl ?? target.targetUrl)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported target URL')
  url.hash = ''
  // Preserve case-sensitive paths and query strings.
  return createHash('sha256').update(JSON.stringify([
    target.platform, target.eventType, url.href.replace(/\/$/, '')
  ])).digest('hex')
}
export function enqueue(state, targets, now) {
  for (const target of targets) {
    const key = targetKey(target)
    if (state.jobs[key]) continue
    state.jobs[key] = { key, target, status: 'queued', discoveredAt: now,
      priority: target.slackMember === true ? 0 : 1 }
  }
}
export async function runWorker({ directory, discover, once = false, intervalMs = 300000,
  signal, now = Date.now, onCycle = () => {}, authRevision }) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('Interval must be at least 1000ms')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, 'worker.lock')
  // OS supervisors restart a crashed worker. Reclaim only a demonstrably dead PID.
  const previous = read(lock, null)
  if (previous) {
    try { process.kill(previous.pid, 0); throw new Error('Worker already running') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    rmSync(lock)
  }
  const owner = randomUUID()
  const fd = openSync(lock, 'wx', 0o600)
  writeFileSync(fd, JSON.stringify({ pid: process.pid, owner })); closeSync(fd)
  const path = join(directory, 'state.json')
  try {
    const state = read(path, { version: 1, failures: 0, nextPollAt: 0, jobs: {} })
    if (state.version !== 1 || !state.jobs) throw new Error('Unsupported worker state')
    if (authRevision && state.authRevision !== authRevision) {
      state.nextPollAt = 0
      state.authRevision = authRevision
    }
    do {
      if (signal?.aborted) break
      const delay = Math.max(0, state.nextPollAt - now())
      if (delay) {
        if (once) return state
        await sleep(delay, undefined, { signal }).catch(error => { if (error.name !== 'AbortError') throw error })
        if (signal?.aborted) break
      }
      try {
        const targets = await discover(signal)
        if (!Array.isArray(targets)) throw new Error('Discovery must return targets')
        enqueue(state, targets, now())
        state.failures = 0
        state.lastSuccessAt = now()
        state.lastError = null
      } catch (error) {
        state.failures++
        // Persist only classified errors, never tokens, response bodies or URLs.
        state.lastError = error.code === 'AUTH_REQUIRED' ? 'auth_required' : 'discovery_failed'
      }
      state.lastPollAt = now()
      state.nextPollAt = now() + Math.min(3600000, intervalMs * 2 ** Math.min(state.failures, 10))
      state.pending = Object.values(state.jobs).filter(job => job.status === 'queued')
        .sort((a, b) => a.priority - b.priority || a.discoveredAt - b.discoveredAt).map(job => job.key)
      saveState(path, state)
      onCycle({ pending: state.pending.length, lastError: state.lastError, nextPollAt: state.nextPollAt })
      if (once) return state
    } while (!signal?.aborted)
    return state
  } finally {
    if (read(lock, null)?.owner === owner) rmSync(lock)
  }
}
export const workerStatus = directory => ({
  lock: read(join(directory, 'worker.lock'), null),
  state: read(join(directory, 'state.json'), null),
})
