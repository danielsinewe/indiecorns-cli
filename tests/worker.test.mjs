import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorker, workerStatus } from '../indiecorns/lib/worker.mjs'
const target = (path, slackMember = false) => ({ platform: 'x', eventType: 'like', profileUrl: `https://x.com/${path}`, slackMember })
const fixture = () => mkdtempSync(join(tmpdir(), 'indiecorns-worker-'))

test('queue persists across restart, deduplicates, and prioritizes explicit Slack membership', async () => {
  const directory = fixture()
  let clock = 1000
  const options = { directory, once: true, intervalMs: 1000, now: () => clock,
    discover: async () => [target('Other'), target('Slack', true), target('Other'), target('other')] }
  try {
    const first = await runWorker(options)
    assert.equal(Object.keys(first.jobs).length, 3)
    assert.equal(first.jobs[first.pending[0]].target.slackMember, true)
    clock = 3000
    const second = await runWorker(options)
    assert.deepEqual(second.jobs, first.jobs)
    assert.equal(workerStatus(directory).lock, null)
  } finally { rmSync(directory, { recursive: true }) }
})

test('failed polls persist backoff across restart and do not leak error secrets', async () => {
  const directory = fixture()
  let attempts = 0
  const options = { directory, once: true, intervalMs: 1000, now: () => 1000,
    discover: async () => { attempts++; throw new Error('secret-token') } }
  try {
    const first = await runWorker(options)
    assert.equal(first.nextPollAt, 3000)
    await runWorker(options)
    assert.equal(attempts, 1)
    assert.doesNotMatch(readFileSync(join(directory, 'state.json'), 'utf8'), /secret-token/)
  } finally { rmSync(directory, { recursive: true }) }
})

test('only one worker may own a directory', async () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'worker.lock'), JSON.stringify({ pid: process.pid, owner: 'other' }))
    await assert.rejects(runWorker({ directory, once: true, discover: async () => [] }), /already running/)
    assert.equal(workerStatus(directory).lock.owner, 'other')
  } finally { rmSync(directory, { recursive: true }) }
})

test('corrupt state fails closed and releases worker ownership', async () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'state.json'), 'broken')
    await assert.rejects(runWorker({ directory, once: true, discover: async () => [] }))
    assert.equal(existsSync(join(directory, 'worker.lock')), false)
    assert.equal(readFileSync(join(directory, 'state.json'), 'utf8'), 'broken')
  } finally { rmSync(directory, { recursive: true }) }
})

test('shutdown interrupts the scheduled sleep', async () => {
  const directory = fixture()
  const controller = new AbortController()
  try {
    await runWorker({ directory, signal: controller.signal, discover: async () => [],
      onCycle: () => controller.abort() })
    assert.equal(workerStatus(directory).lock, null)
  } finally { rmSync(directory, { recursive: true }) }
})

test('new credentials bypass old authentication backoff without resetting jobs', async () => {
  const directory = fixture()
  try {
    await runWorker({ directory, once: true, now: () => 1000, authRevision: 'old',
      discover: async () => { throw Object.assign(new Error(), { code: 'AUTH_REQUIRED' }) } })
    const state = await runWorker({ directory, once: true, now: () => 1100, authRevision: 'new',
      discover: async () => [target('authenticated')] })
    assert.equal(state.lastError, null)
    assert.equal(state.pending.length, 1)
  } finally { rmSync(directory, { recursive: true }) }
})
