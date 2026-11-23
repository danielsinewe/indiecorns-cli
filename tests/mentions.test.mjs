import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  prepareMentions, ingestMentions, mentionView, mentionsText, unannouncedMentions,
} from '../indiecorns/lib/mentions.mjs'
import { syncCommunityFeed } from '../indiecorns/lib/community-feed.mjs'
import { credentialRevision } from '../indiecorns/lib/auth-context.mjs'

const appUrl = 'https://app.indiecorns.com'
const headers = { Authorization: 'Bearer private-test' }
const now = 2000000000
const item = (id = '1') => ({
  id, senderId: 'UTEST', text: 'Community update', createdAt: now - 1000,
  permalink: 'https://indiecorns.slack.com/archives/CTEST/p123456789?thread_ts=123.456&cid=CTEST',
})
const page = (items = [item()], extra = {}) => ({
  version: 1, actorId: 'user_test', status: 'ready', workspaceId: 'TTEST', channelId: 'CTEST',
  observedAt: now - 1, expiresAt: now + 299999, items,
  nextCursor: items.at(-1)?.id ?? '0', hasMore: false, ...extra,
})
const memberSnapshot = (at = now) => ({
  version: 1, workspaceId: 'TTEST', channelId: 'CTEST', observedAt: at - 1,
  expiresAt: at + 3600000, memberIds: [], identities: [],
})
const fresh = () => {
  const state = { jobs: {} }
  prepareMentions(state, appUrl, headers, now)
  return state
}
const view = state => mentionView(state, { appUrl, headers, now })
const cli = resolve('indiecorns/bin/indiecorns.mjs')
const environment = (home, token = 'private-test') => ({
  ...process.env, HOME: home, USERPROFILE: home, INDIECORNS_TOKEN: token,
  INDIECORNS_TELEMETRY_DISABLED: '1',
})

test('idempotent bigint pages survive serialization and keep thread links and safe text', () => {
  let state = fresh()
  ingestMentions(state, page([item('9007199254740993')], { hasMore: true }), { now })
  state = JSON.parse(JSON.stringify(state))
  const prepared = prepareMentions(state, appUrl, {
    ...headers, 'x-indiecorns-cli-version': '100',
  }, now)
  assert.equal(prepared.cursor, '9007199254740993')
  ingestMentions(state, page([{
    ...item('9007199254740994'), text: 'hello\x1b]8;;https://evil\x07\n\u202e world',
  }]), { now })
  assert.equal(view(state).items.length, 2)
  assert.doesNotMatch(mentionsText(view(state)), /\x1b|\x07|\u202e/)
  ingestMentions(state, page([item('9007199254740994')]), { now })
  assert.equal(state.mentions.cursor, '9007199254740994')
  assert.equal(state.mentions.items.length, 2)
  assert.equal(view(state).status, 'invalid')
})

test('invalid, expired, private, mismatched and nonprogressing pages never advance cursor', () => {
  const invalidPages = [
    { version: 2 }, { expiresAt: now }, { observedAt: now + 1 },
    { expiresAt: now + 300001 }, { channelId: 'PRIVATE' }, { workspaceId: 'other' },
    { nextCursor: '1.1' }, { nextCursor: '9223372036854775808' }, { nextCursor: '2' },
    { items: [{ ...item(), permalink: 'https://evil.example/archives/CTEST/p123' }] },
    { items: [{ ...item(), permalink: 'https://indiecorns.slack.com/archives/CTEST/p123?redirect=https://evil' }] },
    { items: [{ ...item(), text: 'x'.repeat(501) }] },
    { items: [{ ...item(), senderId: 'UTEST\n' }] },
    { items: [{ ...item(), permalink: 'https://indiecorns.slack.com/archives/CTEST/p123\n' }] },
    { items: [{ ...item(), createdAt: now - 7 * 86400000 - 1 }] },
    { items: [item('2'), item('1')], nextCursor: '2' },
    { items: [], nextCursor: '0', hasMore: true },
  ]
  for (const extra of invalidPages) {
    const state = fresh()
    ingestMentions(state, page(undefined, extra), { now })
    assert.equal(state.mentions.cursor, '0', JSON.stringify(extra))
    assert.equal(state.mentions.items.length, 0)
  }
  const state = fresh()
  ingestMentions(state, page(), {
    now, snapshot: { workspaceId: 'TOTHER', channelId: 'CTEST' },
  })
  assert.equal(state.mentions.cursor, '0')
})

test('7d and 200 limits, old servers and credential changes hide messages', () => {
  const state = fresh()
  ingestMentions(state, page(Array.from({ length: 200 }, (_, i) => item(String(i + 1)))), { now })
  ingestMentions(state, page([item('201')]), { now })
  assert.equal(state.mentions.items.length, 200)
  assert.equal(state.mentions.items[0].id, '2')
  assert.equal(mentionView(state, { appUrl, headers, now: now + 300000 }).items.length, 0)
  ingestMentions(state, undefined, { now })
  assert.equal(view(state).status, 'unsupported')
  assert.equal(view(state).items.length, 0)
  assert.equal(mentionView(state, { appUrl: 'https://other.example', headers, now }).items.length, 0)
  const changedHeaders = { Authorization: 'Bearer other' }
  assert.equal(mentionView(state, { appUrl, headers: changedHeaders, now }).items.length, 0)
  prepareMentions(state, appUrl, changedHeaders, now)
  assert.equal(state.mentions.cursor, '0')
  assert.equal(state.mentions.announcedCursor, '0')
  assert.deepEqual(state.mentions.items, [])
})

test('revoked membership clears saved text and both cursors; transient outages preserve them', () => {
  const state = fresh()
  ingestMentions(state, page(), { now })
  state.mentions.announcedCursor = '1'
  ingestMentions(state, page([], { status: 'unavailable', nextCursor: '0' }), { now })
  assert.equal(view(state).status, 'unavailable')
  assert.deepEqual(view(state).items, [])
  assert.equal(state.mentions.cursor, '1')
  assert.equal(state.mentions.announcedCursor, '1')
  assert.equal(state.mentions.items.length, 1)
  ingestMentions(state, page([], { status: 'membership_required', nextCursor: '0' }), { now })
  assert.equal(view(state).status, 'membership_required')
  assert.equal(state.mentions.cursor, '0')
  assert.equal(state.mentions.announcedCursor, '0')
  assert.deepEqual(state.mentions.items, [])
  ingestMentions(state, page([item('2')]), { now })
  assert.equal(unannouncedMentions(state, view(state))[0].id, '2')
})

test('actor, workspace and channel changes reset catchup and announcement scope', () => {
  for (const scope of [
    { actorId: 'user_other' }, { workspaceId: 'TOTHER' }, { channelId: 'COTHER' },
  ]) {
    const state = fresh()
    ingestMentions(state, page(), { now })
    state.mentions.announcedCursor = '1'
    ingestMentions(state, page([item('2')], scope), { now })
    assert.equal(state.mentions.cursor, '0')
    assert.equal(state.mentions.announcedCursor, '0')
    assert.deepEqual(state.mentions.items, [])
    const scopedItem = { ...item('2') }
    if (scope.channelId) scopedItem.permalink = scopedItem.permalink.replaceAll('CTEST', scope.channelId)
    ingestMentions(state, page([scopedItem], scope), { now })
    assert.equal(unannouncedMentions(state, view(state))[0].id, '2')
    prepareMentions(state, appUrl, headers, now + 7 * 86400000)
    assert.deepEqual(state.mentions.items, [])
  }
})

test('one normal community GET carries mention cursor; catchup, retry and old-server compatibility', async () => {
  let clock = now, state = fresh(), calls = 0
  const snapshot = memberSnapshot()
  const request = async url => {
    calls++
    assert.equal(url.searchParams.get('mentions'), '1')
    assert.equal(url.searchParams.get('mentionAfter'), calls === 1 ? '0' : '1')
    const extra = calls === 1 ? { mentions: page([item()], { hasMore: true }) }
      : calls === 2 ? { mentions: page([item('2')], { expiresAt: clock - 1 }) } : {}
    return Response.json({
      version: 1, snapshot, targets: [], cursor: '', latest: '1000.000001', ...extra,
    })
  }
  const sync = () => syncCommunityFeed({ state, appUrl, headers, now: () => clock, request })
  await sync()
  assert.equal(state.communityFeed.nextPollAt, now + 60000)
  state = JSON.parse(JSON.stringify(state))
  clock += 60000
  await sync()
  assert.equal(state.mentions.cursor, '1')
  assert.equal(view(state).status, 'invalid')
  clock = state.communityFeed.nextPollAt
  await sync()
  assert.equal(state.mentions.cursor, '1')
  assert.equal(view(state).status, 'unsupported')
  assert.equal(calls, 3)
})

test('setup-only probes opt out and local source does not ingest community targets', async () => {
  for (const mentions of [true, false]) {
    const state = fresh(), snapshot = memberSnapshot()
    await syncCommunityFeed({
      state, appUrl, headers, mentions, enqueueTargets: false, now: () => now,
      request: async url => {
        assert.equal(url.searchParams.get('mentions'), mentions ? '1' : null)
        return Response.json({
          version: 1, snapshot, cursor: '', latest: '1000.000001', mentions: page(),
          targets: [{ platform: 'github', eventType: 'inspect', profileUrl: 'https://github.com/test' }],
        })
      },
    })
    assert.equal(Object.keys(state.jobs).length, 0)
    assert.equal(state.mentions.items.length, mentions ? 1 : 0)
    assert.equal(state.communityFeed, undefined)
    assert.equal(state.communityMentionFeed.health, 'ok')
  }
})

test('real CLI mentions is terminal safe; status reveals count without private text or binding', () => {
  const home = mkdtempSync(join(tmpdir(), 'indiecorns-mentions-'))
  try {
    const state = fresh(), at = Date.now()
    prepareMentions(state, appUrl, headers, at)
    ingestMentions(state, page([{
      ...item(), text: 'private notification\x1b\x07', createdAt: at - 100,
    }], { observedAt: at - 1, expiresAt: at + 299999 }), { now: at })
    const directory = join(home, '.indiecorns', 'worker')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'state.json'), JSON.stringify(state))
    const run = (args, token) => spawnSync(process.execPath, [cli, 'worker', ...args, '--no-telemetry'], {
      encoding: 'utf8', env: environment(home, token),
    })
    const json = run(['mentions', '--json'])
    assert.equal(json.status, 0, json.stderr)
    assert.equal(JSON.parse(json.stdout).items.length, 1)
    const human = run(['mentions'])
    assert.match(human.stdout, /private notification/)
    assert.doesNotMatch(human.stdout, /\x1b|\x07/)
    const status = run(['status'])
    assert.doesNotMatch(status.stdout, /private notification|"binding"/)
    assert.equal(JSON.parse(status.stdout).mentions.count, 1)
    assert.deepEqual(JSON.parse(run(['mentions', '--json'], 'other-token').stdout).items, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function workerFixture(mode) {
  const home = mkdtempSync(join(tmpdir(), 'indiecorns-mention-stream-'))
  const at = Date.now(), directory = join(home, '.indiecorns', 'worker')
  const events = join(home, 'requests.json'), stub = join(home, 'fetch.mjs')
  mkdirSync(directory, { recursive: true })
  const snapshot = memberSnapshot(at)
  const statePath = join(directory, 'state.json')
  writeFileSync(statePath, JSON.stringify({
    version: 1, jobs: {}, failures: 0, authRevision: credentialRevision(headers),
    discoveryRevision: 'community-observations-v3', nextPollAt: at + 3600000,
    slackNextRefreshAt: at + 3600000, slackHistory: { nextPollAt: at + 3600000 },
  }))
  writeFileSync(join(directory, 'slack-settings.json'), JSON.stringify({ source: mode }))
  writeFileSync(join(directory, 'slack-evidence.json'), JSON.stringify(snapshot))
  const envelope = page([{
    ...item(), createdAt: at - 100, text: 'Worker broadcast\x1b\x07',
  }], { observedAt: at - 1, expiresAt: at + 299999 })
  const response = { version: 1, snapshot, targets: [], cursor: '', latest: '0.000000', mentions: envelope }
  writeFileSync(stub, `
    import fs from 'node:fs'
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/worker-feed') && (!options.method || options.method === 'GET')) {
        fs.writeFileSync(${JSON.stringify(events)}, JSON.stringify({ url: url.href, method: 'GET' }))
        return Response.json(${JSON.stringify(response)})
      }
      throw new Error('Unexpected offline fixture request')
    }
  `)
  return {
    home, events, statePath,
    saved: () => JSON.parse(readFileSync(statePath, 'utf8')),
    run: (format = '--ndjson') => spawnSync(process.execPath, [
      '--import', pathToFileURL(stub).href, cli, 'worker', 'run', '--once', format, '--no-telemetry',
    ], {
      encoding: 'utf8', timeout: 10000,
      env: {
        ...environment(home), INDIECORNS_GITHUB_TOKEN: '', INDIECORNS_PRODUCTHUNT_TOKEN: '',
        INDIECORNS_SLACK_TOKEN: mode === 'community' ? '' : 'local-slack-test',
      },
    }),
    close: () => rmSync(home, { recursive: true, force: true }),
  }
}

test('normal workers surface notices with one feed GET in community and custom local modes', () => {
  for (const mode of ['community', 'local', 'auto']) {
    const fixture = workerFixture(mode)
    try {
      const run = fixture.run()
      assert.equal(run.status, 0, run.stderr + run.stdout)
      const url = new URL(JSON.parse(readFileSync(fixture.events, 'utf8')).url)
      assert.equal(url.searchParams.get('mentions'), '1')
      assert.equal(url.searchParams.get('mentionAfter'), '0')
      assert.equal(url.searchParams.get('mentionsOnly'), mode === 'community' ? null : '1')
      const output = run.stdout.trim().split('\n').map(line => JSON.parse(line))
      const notice = output.find(event => event.type === 'worker.mentions')
      assert.equal(notice.items[0].text, 'Worker broadcast  ')
      assert.match(notice.items[0].permalink, /slack.com\/archives/)
      assert.equal(output.at(-1).mentions.count, 1)
      assert.equal(fixture.saved().mentions.cursor, '1')
      assert.equal(fixture.saved().mentions.announcedCursor, '1')
      assert.equal(fixture.saved().slackSource, mode === 'community' ? 'community_feed' : 'local_slack')
      const restarted = fixture.run()
      assert.equal(restarted.status, 0, restarted.stderr)
      const repeated = restarted.stdout.trim().split('\n').map(line => JSON.parse(line))
      assert.equal(repeated.some(event => event.type === 'worker.mentions'), false)
    } finally {
      fixture.close()
    }
  }
})

test('one-shot JSON and agent output is one object, persists acknowledgement and resumes pending notices', () => {
  for (const format of ['--json', '--agent']) {
    const fixture = workerFixture('community')
    try {
      const run = fixture.run(format)
      assert.equal(run.status, 0, run.stderr)
      const summary = JSON.parse(run.stdout)
      assert.equal(summary.mentions.items[0].text, 'Worker broadcast  ')
      assert.equal(fixture.saved().mentions.announcedCursor, '1')
      const restarted = fixture.run(format)
      assert.equal(restarted.status, 0, restarted.stderr)
      assert.deepEqual(JSON.parse(restarted.stdout).mentions.items, [])
      // Simulate a crash after ingestion but before the notification was printed.
      const pending = fixture.saved()
      pending.mentions.announcedCursor = '0'
      writeFileSync(fixture.statePath, JSON.stringify(pending))
      const resumed = fixture.run(format)
      assert.equal(resumed.status, 0, resumed.stderr)
      assert.equal(JSON.parse(resumed.stdout).mentions.items[0].id, '1')
      assert.equal(fixture.saved().mentions.announcedCursor, '1')
    } finally {
      fixture.close()
    }
  }
})
