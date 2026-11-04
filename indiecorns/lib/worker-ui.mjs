// Plain, append-only output works in terminals, redirected logs and NO_COLOR.
// Machine output is selected by the caller and never passes through this view.
const cli = 'npx --yes indiecorns@latest'
const command = value => value?.replace(/^indiecorns\b/, cli)
const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
export function setupStepText(step) {
  const ok = ['verified', 'preserved', 'created', 'running'].includes(step.status)
  const label = {
    community_auth: 'Indiecorns account', slack_feed: 'Slack community',
    policy: 'Action limits', github: 'GitHub account', service: 'Background worker',
    source_health: 'Discovery sources', background_credential: 'Background authorization',
    community_service: 'Community service',
  }[step.id] ?? 'Setup check'
  let detail = safe(step.status).replaceAll('_', ' ')
  if (step.id === 'slack_feed' && ok) detail = 'connected'
  if (step.id === 'github' && step.actor) detail = `@${safe(step.actor.username)}${ok ? ' connected' : ' needs authorization'}`
  if (step.id === 'policy') detail = `${safe(step.mode)} mode · at most ${step.maxExternalPerDay} external attempt(s) per UTC day${step.status === 'preserved' ? ' · unchanged' : ''}`
  if (step.id === 'service' && step.status === 'running') detail = step.preserved ? 'already running · kept in place' : 'running'
  return `  ${ok ? '✓' : '!'} ${label}: ${detail}`
}

export function setupSummary(result) {
  const ready = result.state === 'ready'
  const lines = ['', ready ? (result.check ? 'Your setup is ready.' : 'You’re all set. Indiecorns is running in the background.') : {
    service_unavailable: 'Setup paused: the community service is temporarily unavailable.',
    account_policy_mismatch: 'Setup paused: this worker belongs to a different account.',
    running_with_action_requirements: 'Discovery is running. GitHub actions still need your authorization.',
    running_with_source_requirements: 'The worker is running, but discovery needs attention.',
    setup_required: 'This computer still needs setup.',
  }[result.state] ?? 'Setup needs your attention.']
  if (ready) {
    lines.push('You can close this terminal. Keep your computer awake, online and signed in.')
    if (result.capabilities?.githubActions) lines.push('GitHub follows and stars follow your saved limits. Product Hunt and other platforms are not enabled.')
    else lines.push('GitHub actions are not enabled in this mode.')
  }
  const needs = (result.steps ?? []).filter(s => !['verified', 'preserved', 'created', 'running', 'planned'].includes(s.status))
  const next = needs.some(s => s.id === 'community_auth') ? 'indiecorns worker setup --wait' : needs.find(s => s.nextCommand)?.nextCommand ?? result.nextCommand
  if (next) lines.push('', ready ? 'Check health whenever you like:' : 'Next step:', `  ${command(next)}`)
  if (result.state === 'service_unavailable') lines.push('Your saved setup is preserved. Retry setup after the service recovers; you do not need to sign in again.')
  if (ready) lines.push('', 'To stop and remove the background service:', `  ${cli} worker uninstall`)
  return lines.join('\n')
}

export function healthText(report) {
  const latest = report.latest
  const sources = latest && ['discoveryHealthy', 'communityHealthy', 'githubPostsHealthy'].every(k => latest[k] === true)
  const recent = latest && report.latestAgeMs >= 0 && report.latestAgeMs <= 90000 && report.latestState === 'recent_sample'
  const issues = report.unhealthySamples || report.progressStalls || report.clockAnomalies || Object.values(report.anomalies ?? {}).some(Boolean)
  const span = report.sampledMs >= report.hours * 3600000
  const healthyWindow = recent && sources && !issues && span && report.coverage === 'continuous_samples' && report.largestGapMs <= 90000
  return ['INDIECORNS · Worker health', '',
    latest ? `Latest recorded sample: ${recent ? 'recent' : 'stale'} · sources ${sources ? 'healthy' : 'not all confirmed healthy'}` : 'No health samples recorded yet.',
    `Last ${report.hours} hours: ${healthyWindow ? 'healthy recorded coverage' : 'healthy coverage not yet proven'}`,
    `Unhealthy samples: ${report.unhealthySamples ?? 0} · progress stalls: ${report.progressStalls ?? 0}`,
    `Coverage: ${safe(report.coverage).replaceAll('_', ' ')} · largest gap: ${Math.ceil((report.largestGapMs ?? 0) / 1000)}s`,
    '', `For a read-only process and account check:`, `  ${cli} worker setup --check`,
    'Use --json for the complete machine-readable report.'].join('\n')
}
