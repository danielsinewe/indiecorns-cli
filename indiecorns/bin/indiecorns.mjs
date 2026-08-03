#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { arch as osArch, homedir, platform as osPlatform } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_APP_URL = "https://app.indiecorns.com"
const DEFAULT_POSTHOG_KEY = "phc_DkrgYsexPgXyGqsCm3nPP4wFT6GSQaxaLZzGx4RpABtV"
const CLI_INSTALL_ACTION_ID = "cli"
const CHROME_EXTENSION_ACTION_ID = "chrome-extension"
const QUICK_START_ACTION_IDS = [
  CLI_INSTALL_ACTION_ID,
  "external-profile-website",
  "discord",
  CHROME_EXTENSION_ACTION_ID,
]
const DEFAULT_EXTENSION_ID = "oldjmlmncilgeagpfgkcjjlkbfbkiggk"
const enabledValues = new Set(["1", "true", "yes", "on"])
const ONBOARDING_ACTIONS = [
  {
    id: CLI_INSTALL_ACTION_ID,
    aliases: ["install", "terminal"],
    title: "Install the CLI",
    credits: 100,
    url: "https://www.npmjs.com/package/indiecorns",
    kind: "command",
    command: "npx --yes indiecorns@latest",
    verification: "cli_session",
    required: true,
  },
  {
    id: "external-profile-website",
    aliases: ["website", "website-profile", "profile-website"],
    title: "Add your website",
    description: "Add the public URL where people can see what you are building.",
    credits: 50,
    url: `${DEFAULT_APP_URL}/dashboard#social-links`,
    kind: "open_url",
    command:
      "npx indiecorns profile set website --profile-url https://your-site.com",
    verification: "profile_link",
    requires: [CLI_INSTALL_ACTION_ID],
  },
  {
    id: "discord",
    aliases: [
      "server",
      "community",
      "slack",
      "slack-workspace",
      "discord",
      "discord-server",
    ],
    title: "Join the Slack community",
    credits: 100,
    url: "https://join.slack.com/t/indiecorns/shared_invite/zt-41zeuvjk7-tykDQ1_u7xx7EnawIyGQfw",
    command: "npx indiecorns join slack",
    verification: "external_platform",
    requires: [CLI_INSTALL_ACTION_ID],
  },
  {
    id: CHROME_EXTENSION_ACTION_ID,
    aliases: [
      "extension",
      "chrome",
      "chrome-extension",
      "browser-extension",
      "extension-install",
    ],
    title: "Try the Chrome extension",
    description:
      "Install it, run one task, and optionally share an honest review.",
    credits: 0,
    url: `https://chromewebstore.google.com/detail/${DEFAULT_EXTENSION_ID}`,
    reviewUrl: `https://chrome.google.com/webstore/detail/${DEFAULT_EXTENSION_ID}/reviews`,
    command: "npx indiecorns extension install",
    verification: "extension_session",
    requires: [CLI_INSTALL_ACTION_ID],
  },
]

const usage = `Indiecorns CLI

Usage:
  indiecorns [command] [options]

Commands:
  wizard                         Connect, add your website, join Slack, and try the extension
  assist <request>               Ask the setup or support assistant for exact next commands
  support-assist <request>       Ask the agent to plan member support targets
  collective                     Show the CLI-first collective command center
  init                           Alias for wizard
  login                          Reconnect this CLI to your Indiecorns account
  signup                         Create an Indiecorns account in your browser
  status                         Show CLI authentication status
  tasks                          Show the next setup step
  follow <task>                  Open an onboarding link
  follow-members [platform]      Open Indiecorns member profiles to follow
  engage-members <action> [platform]
                                 Open member targets for like, reshare, upvote, rate, or comment
  community-queue [platform]     Show a flat queue of community action targets
  community-open [platform]      Open queued community action targets
  community-next [platform]      Show the next community action target
  community-plan [platform]      Print a read-only multi-action community plan
  community-status               Summarize community targets, records, and reporting
  peerlist-launches              Monday Peerlist launch upvote + 5-star rating queue
  indiehackers fill-profile      Prefill the Indie Hackers profile edit form
  join slack                     Open the Indiecorns Slack invite
  record <platform> --target <u> Record an external action event
  events                         Show recorded external action events
  profiles [--platform <name>]   Show known external profiles and follow targets
  profile show [platform]        Show your saved external profiles
  profile set peerlist --username <u>
                                 Save your Peerlist username for Indiecorns
  profile set indiehackers --username <u>
                                 Save your Indie Hackers username for Indiecorns
  profile set website --profile-url <url>
                                 Save your public website URL
  launch set <platform> --url    Save your launch/project URL for support
  launch list [platform]         Show your saved launch/project URLs
  post set <platform> --url      Save your post URL for community engagement
  post list [platform]           Show your saved post URLs
  run                            Run safe tasks and show manual next steps
  complete <slack|all>
                                 Mark an already-finished task as complete
  dashboard                      Open your Indiecorns dashboard
  extension open                 Open the Indiecorns Chrome extension executor
  extension install              Open the Chrome Web Store listing
  extension review               Open the optional Chrome Web Store review page
  agent                          Print a Codex-ready JSON action plan
  plugin install                 Install the Indiecorns Codex plugin locally
  telemetry status               Show CLI telemetry status
  telemetry disable              Disable CLI telemetry
  telemetry enable               Enable CLI telemetry
  help                           Show this help

Options:
  --json                         Print machine-readable JSON where supported
  --agent                        Print agent-safe JSON and never open a browser
  --ndjson                       Stream wizard lifecycle events as NDJSON
  --app-url <url>                Override Indiecorns app URL
  --no-open                      Print auth URL without opening a browser
  --platform <name>              Platform filter: peerlist, x, linkedin, producthunt, all
  --limit <number>               Max member profiles to include
  --timeout <seconds>            Login wait timeout, default 180
  --actor <username>             External platform username performing an action
  --target <username>            External platform username being acted on
  --target-url <url>             External platform target URL being acted on
  --target-type <type>           External target type: profile, post, or project
  --type <event>                 External event type: follow, like, reshare, upvote, rate, comment
  --username <username>          Your external platform username
  --profile-url <url>            Your external platform profile URL
  --url <url>                    Profile, launch, or target URL
  --name <name>                  Launch/project name
  --display-name <name>          External platform display name
  --bio <text>                   Profile bio for supported fill flows
  --website-url <url>            Website URL for supported fill flows
  --twitter-handle <username>    X/Twitter handle for supported fill flows
  --apply                        Apply safe setup assistant profile saves
  --label-before <label>         Observed button/status label before action
  --label-after <label>          Observed button/status label after action
  --no-telemetry                 Disable telemetry for this invocation
`

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
}

const color = (value, code) =>
  process.stdout.isTTY && !process.env.NO_COLOR
    ? `${code}${value}${colors.reset}`
    : value

const ok = (value) => color(value, colors.green)
const warn = (value) => color(value, colors.yellow)
const fail = (value) => color(value, colors.red)
const dim = (value) => color(value, colors.dim)
const bold = (value) => color(value, colors.bold)
const brand = (value) => color(value, colors.magenta)
const cliPretty = () => Boolean(process.stdout.isTTY && !process.env.CI)

const printBrandHeader = (subtitle) => {
  console.log(`${brand("🦄")} ${bold("Indiecorns")} ${subtitle}`)
}

const section = (title) => {
  console.log("")
  console.log(color(title, colors.cyan))
}

const createSpinner = (label) => {
  if (!cliPretty()) {
    console.log(label)
    return {
      update() {},
      stop(finalLabel = label) {
        console.log(finalLabel)
      },
    }
  }

  const frames = ["-", "\\", "|", "/"]
  let frameIndex = 0
  let currentLabel = label
  process.stdout.write(`${frames[frameIndex]} ${currentLabel}`)
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length
    process.stdout.write(`\r${frames[frameIndex]} ${currentLabel}`)
  }, 90)

  return {
    update(nextLabel) {
      currentLabel = nextLabel
    },
    stop(finalLabel = currentLabel) {
      clearInterval(timer)
      process.stdout.write(`\r${" ".repeat(currentLabel.length + 4)}\r`)
      console.log(finalLabel)
    },
  }
}

const withSpinner = async (label, task, successLabel = label) => {
  const spinner = createSpinner(label)
  try {
    const result = await task(spinner)
    spinner.stop(successLabel)
    return result
  } catch (error) {
    spinner.stop(fail(label))
    throw error
  }
}

const parseArgs = (argv) => {
  const args = []
  const flags = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) {
      args.push(arg)
      continue
    }

    const [name, inlineValue] = arg.slice(2).split("=", 2)
    const next = argv[index + 1]
    if (inlineValue !== undefined) {
      flags[name] = inlineValue
    } else if (next && !next.startsWith("--")) {
      flags[name] = next
      index += 1
    } else {
      flags[name] = true
    }
  }

  return { command: args[0], args: args.slice(1), flags }
}

const hasPackage = (path) => existsSync(join(path, "package.json"))

const determineAppRoot = () => {
  const candidates = [
    join(process.cwd(), "indiecorns"),
    process.cwd(),
    resolve(__dirname, ".."),
  ]

  return candidates.find((candidate) => hasPackage(candidate)) ?? process.cwd()
}

const appRoot = determineAppRoot()
const readPackage = () =>
  JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"))
const configDir = join(homedir(), ".indiecorns")
const configPath = join(configDir, "config.json")
const bundledPluginRoot = resolve(
  __dirname,
  "..",
  "..",
  "plugins",
  "indiecorns"
)
const bundledMarketplacePath = resolve(
  __dirname,
  "..",
  "..",
  ".agents",
  "plugins",
  "marketplace.json"
)

const printJson = (value) => {
  console.log(JSON.stringify(value, null, 2))
}

const printNdjson = (value) => {
  console.log(JSON.stringify({ v: 1, ts: new Date().toISOString(), ...value }))
}

const summarizeForAgent = (value, maxLength = 12000) => {
  const text = JSON.stringify(value)
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

const printRows = (rows) => {
  for (const row of rows) {
    const icon =
      row.status === "ok"
        ? ok("OK")
        : row.status === "warn"
          ? warn("WARN")
          : fail("FAIL")
    console.log(`${icon} ${row.label}${row.detail ? ` - ${row.detail}` : ""}`)
  }
}

const getAppUrl = (flags) => {
  const rawUrl = String(
    flags["app-url"] ?? process.env.INDIECORNS_APP_URL ?? DEFAULT_APP_URL
  )
  return rawUrl.replace(/\/+$/, "")
}

const getExtensionId = (flags = {}) =>
  String(
    flags["extension-id"] ??
      process.env.INDIECORNS_CHROME_EXTENSION_ID ??
      DEFAULT_EXTENSION_ID
  ).trim()

const getExtensionUrl = (flags = {}) =>
  `chrome-extension://${getExtensionId(flags)}/side-panel/index.html`

const getExtensionStoreUrl = (flags = {}) =>
  `https://chromewebstore.google.com/detail/${getExtensionId(flags)}`

const getExtensionReviewUrl = (flags = {}) =>
  `https://chrome.google.com/webstore/detail/${getExtensionId(flags)}/reviews`

const readConfig = () => {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"))
  } catch {
    return {}
  }
}

const writeConfig = (value) => {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
}

const normalizeProfileCachePlatform = (platform) =>
  normalizeSetupAssistantPlatform(platform) ??
  String(platform ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")

const readLocalExternalProfiles = (platform = "all") => {
  const requestedPlatform = normalizeProfileCachePlatform(platform)
  const profiles = readConfig().externalProfiles ?? {}
  const rows = Object.entries(profiles)
    .map(([key, value]) => ({
      platform: normalizeProfileCachePlatform(value?.platform ?? key),
      username: value?.username ?? null,
      profileUrl: value?.profileUrl ?? null,
      displayName: value?.displayName ?? null,
      source: value?.source ?? "local_cli",
      confidence: value?.confidence ?? "local",
      updatedAt: value?.updatedAt ?? null,
      local: true,
    }))
    .filter(
      (profile) =>
        profile.platform &&
        (requestedPlatform === "all" || profile.platform === requestedPlatform)
    )

  return rows
}

const upsertLocalExternalProfile = (profile) => {
  const platform = normalizeProfileCachePlatform(profile?.platform)
  if (!platform) return null

  const config = readConfig()
  const existing = config.externalProfiles?.[platform] ?? {}
  const localProfile = {
    ...existing,
    platform,
    username: profile.username ?? existing.username ?? null,
    profileUrl: profile.profileUrl ?? existing.profileUrl ?? null,
    displayName: profile.displayName ?? existing.displayName ?? null,
    source: profile.source ?? existing.source ?? "local_cli",
    confidence: profile.confidence ?? existing.confidence ?? "local",
    updatedAt: new Date().toISOString(),
  }

  writeConfig({
    ...config,
    externalProfiles: {
      ...(config.externalProfiles ?? {}),
      [platform]: localProfile,
    },
  })

  return { ...localProfile, local: true }
}

const readEnvValueFromFile = (path, name) => {
  try {
    const prefix = `${name}=`
    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((item) => item.startsWith(prefix))
    if (!line) return null
    const value = line.slice(prefix.length).trim()
    return value.replace(/^['"]|['"]$/g, "") || null
  } catch {
    return null
  }
}

const ensureOpenAiApiKey = () => {
  if (process.env.OPENAI_API_KEY) return true
  const candidates = [
    join(appRoot, ".env.local"),
    join(appRoot, ".env.development.local"),
    join(appRoot, ".env"),
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env"),
  ]
  for (const candidate of candidates) {
    const value = readEnvValueFromFile(candidate, "OPENAI_API_KEY")
    if (value) {
      process.env.OPENAI_API_KEY = value
      return true
    }
  }
  return false
}

const hasToken = () => Boolean(process.env.INDIECORNS_TOKEN)
const hasBrowserSession = () => {
  const session = readConfig().browserSession
  if (!session?.authenticatedAt) return false
  if (
    session.accessToken &&
    session.tokenExpiresAt &&
    new Date(session.tokenExpiresAt).getTime() <= Date.now()
  ) {
    return false
  }
  return Boolean(session.accessToken || (session.cliSessionId && session.cliSecret))
}

const getCliVersion = () => {
  const candidates = [
    resolve(__dirname, "..", "..", "package.json"),
    join(appRoot, "package.json"),
  ]

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")).version ?? "unknown"
    } catch {
      // Keep looking for the package manifest.
    }
  }

  return "unknown"
}

const isDisabledValue = (value) =>
  enabledValues.has(
    String(value ?? "")
      .trim()
      .toLowerCase()
  )

const telemetryEnvDisabled = () =>
  isDisabledValue(process.env.INDIECORNS_TELEMETRY_DISABLED) ||
  isDisabledValue(process.env.YOUR_CLI_TELEMETRY_DISABLED) ||
  isDisabledValue(process.env.DO_NOT_TRACK)

const getTelemetryKey = () =>
  process.env.INDIECORNS_POSTHOG_KEY ??
  process.env.POSTHOG_KEY ??
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  DEFAULT_POSTHOG_KEY

const getTelemetryHost = () =>
  process.env.INDIECORNS_POSTHOG_HOST ??
  process.env.POSTHOG_HOST ??
  "https://eu.i.posthog.com"

const telemetryDisabledReason = (flags = {}) => {
  const config = readConfig()

  if (flags["no-telemetry"]) {
    return "flag"
  }

  if (telemetryEnvDisabled()) {
    return "environment"
  }

  if (config.telemetry?.enabled === false) {
    return "config"
  }

  if (!getTelemetryKey()) {
    return "missing_key"
  }

  return null
}

const getAnonymousId = () => {
  const config = readConfig()
  const existingId = config.telemetry?.anonymousId
  if (existingId) {
    return existingId
  }

  const anonymousId = randomUUID()
  writeConfig({
    ...config,
    telemetry: {
      ...(config.telemetry ?? {}),
      anonymousId,
      createdAt: new Date().toISOString(),
    },
  })
  return anonymousId
}

const getTelemetryIdentity = ({ createAnonymous = true } = {}) => {
  const config = readConfig()
  const session = config.browserSession

  if (session?.userId) {
    return {
      distinctId: session.userId,
      identified: true,
      anonymousId: config.telemetry?.anonymousId,
      personProperties: {
        email: session.userEmail,
        indiecorns_user_id: session.userId,
        cli_authenticated_at: session.authenticatedAt,
        cli_app_url: session.appUrl,
      },
      eventProperties: {
        identity_mode: "identified",
        indiecorns_user_id: session.userId,
        user_email: session.userEmail,
        cli_authenticated_at: session.authenticatedAt,
        cli_app_url: session.appUrl,
        auth_method: "browser",
      },
    }
  }

  if (hasToken()) {
    return {
      distinctId: "token-authenticated-cli",
      identified: true,
      anonymousId: config.telemetry?.anonymousId,
      personProperties: {
        auth_method: "INDIECORNS_TOKEN",
      },
      eventProperties: {
        identity_mode: "token",
        auth_method: "INDIECORNS_TOKEN",
      },
    }
  }

  return {
    distinctId: createAnonymous ? getAnonymousId() : "anonymous",
    identified: false,
    anonymousId: config.telemetry?.anonymousId,
    personProperties: null,
    eventProperties: {
      identity_mode: "anonymous",
      auth_method: "none",
    },
  }
}

const getRuntimeTelemetryProperties = () => {
  const shell = process.env.SHELL ? basename(process.env.SHELL) : undefined
  const npmExecPath = process.env.npm_execpath
    ? basename(process.env.npm_execpath)
    : undefined

  return {
    cli_version: getCliVersion(),
    platform: osPlatform(),
    arch: osArch(),
    node_version: process.version,
    node_major: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
    ci: Boolean(process.env.CI),
    is_tty: Boolean(process.stdout.isTTY),
    shell,
    npm_execpath: npmExecPath,
    package_manager: process.env.npm_config_user_agent?.split(" ")[0],
    cwd_name: basename(process.cwd()),
    app_root_name: basename(appRoot),
  }
}

const sanitizeTelemetryArg = (value) => {
  const text = String(value ?? "")
  if (/(token|secret|password|key|authorization|bearer)/i.test(text)) {
    return "[redacted]"
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    return "[email]"
  }
  return text
}

const getCommandTelemetryProperties = ({ command, args = [], flags = {} }) => ({
  command,
  subcommand: sanitizeTelemetryArg(args[0]),
  arg_count: args.length,
  args: args.slice(0, 3).map(sanitizeTelemetryArg),
  flag_names: Object.keys(flags).sort(),
  json: Boolean(flags.json),
  agent: Boolean(flags.agent),
  no_open: Boolean(flags["no-open"]),
  app_url: getAppUrl(flags),
})

let posthogClientPromise = null

const getPosthogClient = async () => {
  if (!posthogClientPromise) {
    posthogClientPromise = import("posthog-node")
      .then(({ PostHog }) => {
        const client = new PostHog(getTelemetryKey(), {
          host: getTelemetryHost(),
          flushAt: 1,
          flushInterval: 0,
          disableGeoip: true,
        })
        client.on?.("error", () => {})
        return client
      })
      .catch(() => null)
  }

  return posthogClientPromise
}

const trackCliEvent = async (event, properties = {}, flags = {}) => {
  if (telemetryDisabledReason(flags)) {
    return
  }

  const client = await getPosthogClient()
  if (!client) {
    return
  }

  const identity = getTelemetryIdentity()
  if (identity.identified && identity.personProperties) {
    client.identify({
      distinctId: identity.distinctId,
      properties: identity.personProperties,
    })
  }

  client.capture({
    distinctId: identity.distinctId,
    event,
    properties: {
      ...(!identity.identified ? { $process_person_profile: false } : {}),
      ...getRuntimeTelemetryProperties(),
      ...identity.eventProperties,
      telemetry_anonymous_id: identity.anonymousId,
      ...properties,
    },
  })
}

const shutdownTelemetry = async () => {
  const client = await posthogClientPromise
  if (!client) {
    return
  }

  await Promise.race([
    client.shutdown(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ])
}

const runTelemetry = (flags, subcommand = "status") => {
  const normalized = String(subcommand ?? "status").toLowerCase()
  const config = readConfig()

  if (normalized === "disable" || normalized === "off") {
    writeConfig({
      ...config,
      telemetry: {
        ...(config.telemetry ?? {}),
        enabled: false,
        updatedAt: new Date().toISOString(),
      },
    })
    if (flags.json) {
      printJson({ enabled: false, disabledReason: "config" })
    } else {
      console.log(ok("CLI telemetry disabled."))
    }
    return 0
  }

  if (normalized === "enable" || normalized === "on") {
    writeConfig({
      ...config,
      telemetry: {
        ...(config.telemetry ?? {}),
        enabled: true,
        updatedAt: new Date().toISOString(),
      },
    })
    if (flags.json) {
      printJson({
        enabled: !telemetryDisabledReason(flags),
        disabledReason: telemetryDisabledReason(flags),
      })
    } else {
      console.log(ok("CLI telemetry enabled."))
      const reason = telemetryDisabledReason(flags)
      if (reason) {
        console.log(warn(`Telemetry is still inactive because of: ${reason}`))
      }
    }
    return 0
  }

  const disabledReason = telemetryDisabledReason(flags)
  const identity = getTelemetryIdentity({ createAnonymous: false })
  const output = {
    enabled: !disabledReason,
    disabledReason,
    identityMode: identity.eventProperties.identity_mode,
    distinctId: identity.identified ? identity.distinctId : "anonymous",
    anonymousId: config.telemetry?.anonymousId ? "configured" : "not_created",
    host: getTelemetryHost(),
    hasProjectKey: Boolean(getTelemetryKey()),
    optOutEnvVars: ["INDIECORNS_TELEMETRY_DISABLED=1", "DO_NOT_TRACK=1"],
  }

  if (flags.json) {
    printJson(output)
  } else {
    console.log(color("Indiecorns CLI telemetry", colors.cyan))
    console.log(`${output.enabled ? ok("enabled") : warn("disabled")}`)
    if (output.disabledReason) {
      console.log(`Reason: ${output.disabledReason}`)
    }
    console.log(`Identity mode: ${output.identityMode}`)
    console.log(
      "Telemetry includes account identity when signed in and excludes tokens, secrets, full local paths, and file contents."
    )
    console.log("Disable: indiecorns telemetry disable")
    console.log(
      "Env opt-out: INDIECORNS_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1"
    )
  }

  return 0
}

const applyAgentMode = (flags) => {
  if (!flags.agent) {
    return flags
  }

  flags.json = true
  flags["no-open"] = true
  return flags
}

const isProfileAction = (action) => action.id?.startsWith("external-profile-")

const getProfilePlatform = (action) =>
  isProfileAction(action) ? action.id.replace("external-profile-", "") : null

const COMMUNITY_ACTION_PLATFORMS = ["peerlist", "x", "linkedin", "producthunt"]
const COMMUNITY_ACTION_EVENT_TYPES = [
  "follow",
  "like",
  "reshare",
  "upvote",
  "rate",
  "comment",
]
const COMMUNITY_TARGET_SOURCES = ["profiles", "posts", "projects"]
const MEMBER_FOLLOW_PLATFORMS = ["peerlist", "x", "linkedin", "producthunt"]

const normalizeCommunityPlatform = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (normalized === "twitter") return "x"
  if (normalized === "ph" || normalized === "product-hunt") {
    return "producthunt"
  }
  if (normalized === "members" || normalized === "makers") return "all"
  return normalized || "all"
}

const normalizeCommunityEventType = (value) => {
  const normalized = String(value ?? "follow")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  if (normalized === "repost" || normalized === "share") return "reshare"
  if (normalized === "vote") return "upvote"
  if (normalized === "rating" || normalized === "rated") return "rate"
  return normalized || "follow"
}

const normalizeCommunityTargetSource = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  if (!normalized || normalized === "all") return "all"
  if (normalized === "profile") return "profiles"
  if (normalized === "post") return "posts"
  if (normalized === "project" || normalized === "launch" || normalized === "launches") {
    return "projects"
  }
  return normalized
}

const getMemberFollowPlatforms = (value) => {
  const platform = normalizeCommunityPlatform(value)
  if (platform === "all") return MEMBER_FOLLOW_PLATFORMS
  return MEMBER_FOLLOW_PLATFORMS.includes(platform) ? [platform] : []
}

const getCommunityActionPlatforms = (value) => {
  const platform = normalizeCommunityPlatform(value)
  if (platform === "all") return COMMUNITY_ACTION_PLATFORMS
  return COMMUNITY_ACTION_PLATFORMS.includes(platform) ? [platform] : []
}

const requiresProjectTarget = (eventType) =>
  eventType === "upvote" || eventType === "rate" || eventType === "comment"

const getCommunityActionSetupCommands = ({
  eventType,
  platforms,
  flags,
  targetSource = "all",
}) => {
  const appUrl = getAppUrl(flags)
  const commands = []

  for (const platform of platforms) {
    if (
      targetSource !== "profiles" &&
      targetSource !== "posts" &&
      eventType === "upvote" &&
      platform === "producthunt"
    ) {
      commands.push(
        `npx indiecorns launch set producthunt --url <url> --name <name> --app-url ${appUrl}`
      )
    } else if (
      targetSource !== "profiles" &&
      targetSource !== "posts" &&
      (eventType === "upvote" || eventType === "rate") &&
      platform === "peerlist"
    ) {
      commands.push(
        `npx indiecorns launch set peerlist --url <url> --name <name> --app-url ${appUrl}`
      )
    } else if (
      targetSource !== "profiles" &&
      targetSource !== "projects" &&
      ["like", "reshare", "comment"].includes(eventType) &&
      (platform === "x" || platform === "linkedin")
    ) {
      commands.push(
        `npx indiecorns post set ${platform} --url <url> --title <title> --app-url ${appUrl}`
      )
    }
  }

  return Array.from(new Set(commands))
}

const summarizeCommunityTargetSources = (targets = []) =>
  targets.reduce((summary, target) => {
    const source =
      target.targetSource ??
      (target.targetType === "post"
        ? "posts"
        : target.targetType === "project"
          ? "projects"
          : "profiles")
    summary[source] = (summary[source] ?? 0) + 1
    return summary
  }, {})

const getPlatformProfileUrl = ({ platform, username, profileUrl }) => {
  if (profileUrl) return profileUrl
  if (!username) return null
  if (platform === "peerlist") return `https://peerlist.io/${username}`
  if (platform === "x") return `https://x.com/${username}`
  if (platform === "linkedin") return `https://www.linkedin.com/in/${username}`
  if (platform === "producthunt") {
    return `https://www.producthunt.com/@${username}`
  }
  return null
}

const normalizeCommunityTargetUrl = (value) => {
  const url = safeUrl(value)
  if (!url) return null
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

const getCommunityTargetUrlParts = (value) => {
  const url = safeUrl(value)
  const host = url?.hostname.replace(/^www\./, "").toLowerCase()
  const segments =
    url?.pathname
      .split("/")
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean) ?? []

  return { host, segments }
}

const isCommunityPostUrlForPlatform = (platform, value) => {
  const { host, segments } = getCommunityTargetUrlParts(value)

  if (platform === "x") {
    return (
      (host === "x.com" || host === "twitter.com") &&
      segments.length >= 3 &&
      segments[1] === "status"
    )
  }

  if (platform === "linkedin") {
    return (
      host?.endsWith("linkedin.com") &&
      (segments.includes("posts") ||
        segments.includes("feed") ||
        segments.some((segment) => segment.startsWith("activity-")))
    )
  }

  return false
}

const isCommunityLaunchUrlForPlatform = (platform, value) => {
  const { host, segments } = getCommunityTargetUrlParts(value)

  if (platform === "peerlist") {
    return host === "peerlist.io" && segments.length >= 3
  }

  if (platform === "producthunt") {
    return (
      host === "producthunt.com" &&
      segments.length >= 2 &&
      (segments[0] === "posts" || segments[0] === "products")
    )
  }

  return false
}

const normalizeRecordTargetType = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
  if (!normalized) return null
  if (normalized === "profile") return "profile_engagement"
  if (normalized === "profile_follow") return "profile_follow"
  if (normalized === "profile_engagement") return "profile_engagement"
  if (normalized === "post") return "post"
  if (normalized === "project" || normalized === "launch") return "project"
  return null
}

const inferRecordTargetType = ({ platform, eventType, targetProfileUrl }) => {
  if (eventType === "follow") return "profile_follow"
  if (eventType === "upvote" || eventType === "rate") return "project"
  if (
    ["like", "reshare", "comment"].includes(eventType) &&
    isCommunityPostUrlForPlatform(platform, targetProfileUrl)
  ) {
    return "post"
  }
  if (
    ["upvote", "rate", "comment"].includes(eventType) &&
    isCommunityLaunchUrlForPlatform(platform, targetProfileUrl)
  ) {
    return "project"
  }
  return "profile_engagement"
}

const shellQuote = (value) => {
  const text = String(value ?? "")
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text
  return `'${text.replace(/'/g, "'\\''")}'`
}

const getCommunityActionId = (platform, eventType) =>
  eventType === "follow" ? platform : `${platform}-${eventType}`

const getRecordCommand = (profile, flags, eventType = "follow") => {
  const targetParts = []
  if (profile.username) {
    targetParts.push(`--target ${shellQuote(profile.username)}`)
  }
  if (profile.displayName) {
    targetParts.push(`--display-name ${shellQuote(profile.displayName)}`)
  }
  if (profile.targetType) {
    targetParts.push(`--target-type ${shellQuote(profile.targetType)}`)
  }
  if (eventType === "rate") {
    targetParts.push(`--rating ${shellQuote(profile.rating ?? 5)}`)
  }
  if (eventType !== "follow" || !profile.username) {
    targetParts.push(`--target-url ${shellQuote(profile.profileUrl)}`)
  }
  const typeFlag = eventType === "follow" ? "" : ` --type ${eventType}`
  return `npx indiecorns record ${profile.platform}${typeFlag} ${targetParts.join(" ")} --app-url ${getAppUrl(flags)}`
}

const getActionCommand = (action, flags) => {
  if (action.agentCommand) {
    return action.agentCommand
  }

  if (action.kind === "command") {
    return `${action.command} --app-url ${getAppUrl(flags)}`
  }

  if (isProfileAction(action)) {
    const platform = getProfilePlatform(action)
    const valueFlag =
      platform === "linkedin"
        ? "--profile-url https://www.linkedin.com/in/"
        : platform === "website"
          ? "--profile-url https://your-site.com"
          : "--username <username>"
    return `npx indiecorns profile set ${platform} ${valueFlag} --app-url ${getAppUrl(flags)}`
  }

  if (action.command) {
    return `${action.command} --no-open --app-url ${getAppUrl(flags)}`
  }

  if (action.id === "discord") {
    return `npx indiecorns join slack --no-open --app-url ${getAppUrl(flags)}`
  }

  return `npx indiecorns follow ${action.id} --no-open --app-url ${getAppUrl(flags)}`
}

const getCompleteCommand = (action, flags) => {
  if (action.completeCommand) {
    return action.completeCommand
  }

  if (action.verification === "extension_session") {
    return `npx indiecorns extension open --app-url ${getAppUrl(flags)}`
  }

  if (action.id === "discord") {
    return `npx indiecorns complete slack --app-url ${getAppUrl(flags)}`
  }

  return isProfileAction(action)
    ? getActionCommand(action, flags)
    : `npx indiecorns complete ${action.id} --app-url ${getAppUrl(flags)}`
}

const getRunCommand = (flags) =>
  `npx indiecorns run --app-url ${getAppUrl(flags)}`

const getActionPlatform = (action) => {
  if (action.platform) return action.platform
  if (action.id === "x" || action.id === "external-profile-x") return "x"
  if (action.id === "linkedin" || action.id === "external-profile-linkedin") {
    return "linkedin"
  }
  if (action.id === "discord") return "slack"
  if (action.id === CHROME_EXTENSION_ACTION_ID) return "chrome_web_store"
  if (action.id?.includes("peerlist")) return "peerlist"
  if (action.id?.includes("producthunt")) return "producthunt"
  if (action.id === "external-profile-github") return "github"
  if (action.id === "external-profile-substack") return "substack"
  if (action.id === "external-profile-website") return "website"
  return "indiecorns"
}

const isManualAction = (action) =>
  action.id?.endsWith("-comment") || action.id === CHROME_EXTENSION_ACTION_ID

const getEvidenceRequired = (action) => {
  if (action.evidenceRequired) return action.evidenceRequired
  if (action.verification === "cli_session") return "completed CLI session"
  if (action.verification === "extension_session")
    return "signed-in Chrome extension session"
  if (action.verification === "profile_link")
    return "saved verified profile link"
  if (isManualAction(action)) {
    return "manual completion evidence from the target platform"
  }
  return "observed before/after platform state from browser assist"
}

const getBrowserAssist = (action) => {
  if (action.browserAssist) return action.browserAssist
  const targetUrl = action.targetUrl ?? action.url
  if (
    action.status === "completed" ||
    action.kind === "command" ||
    isProfileAction(action)
  ) {
    return {
      required: false,
      mode: "none",
      instruction: "No browser assist is required for this action.",
      targetUrl: null,
    }
  }
  if (isManualAction(action)) {
    return {
      required: true,
      mode: "manual_record",
      instruction:
        "Open the target page, complete the manual task, then record proof after the result is visible.",
      targetUrl,
    }
  }
  return {
    required: true,
    mode: "safe_click",
    instruction:
      "Use the Chrome extension or a signed-in browser to perform one clear safe action and record proof only after completion is observed.",
    targetUrl,
  }
}

const getAgentCapability = (action, authenticated) => {
  if (
    action.agentCapability &&
    !(authenticated && action.agentCapability === "blocked_auth")
  ) {
    return action.agentCapability
  }
  if (!authenticated && action.id !== CLI_INSTALL_ACTION_ID)
    return "blocked_auth"
  if (action.kind === "command") return "cli_direct"
  if (isProfileAction(action)) return "api_direct"
  if (
    action.status === "needs_login" ||
    action.status === "needs_platform_login"
  ) {
    return "blocked_platform_login"
  }
  if (isManualAction(action)) return "manual_confirmation"
  return "browser_assisted"
}

const getCliAccessToken = () => {
  const environmentToken = String(process.env.INDIECORNS_TOKEN ?? "").trim()
  if (environmentToken) return environmentToken
  const session = readConfig().browserSession
  if (
    session?.tokenExpiresAt &&
    new Date(session.tokenExpiresAt).getTime() <= Date.now()
  ) {
    return null
  }
  return String(session?.accessToken ?? "").trim() || null
}

const usesPublicCliApi = () => Boolean(getCliAccessToken())

const getCliEndpoint = (modernPath, legacyPath) =>
  usesPublicCliApi() ? modernPath : legacyPath

const normalizeCliActionId = (id) =>
  id === "cli_install" ? CLI_INSTALL_ACTION_ID : id

const getCliAuthHeaders = () => {
  const accessToken = getCliAccessToken()
  if (accessToken) {
    return {
      Authorization: `Bearer ${accessToken}`,
      "x-indiecorns-cli-version": getCliVersion(),
    }
  }

  const session = readConfig().browserSession
  if (!session?.cliSessionId || !session?.cliSecret) {
    return null
  }

  return {
    "x-indiecorns-cli-session": session.cliSessionId,
    "x-indiecorns-cli-secret": session.cliSecret,
    "x-indiecorns-cli-version": getCliVersion(),
    "x-indiecorns-node-version": process.version,
    "x-indiecorns-platform": osPlatform(),
    "x-indiecorns-architecture": osArch(),
  }
}

const getAgentPlanFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  try {
    const url = new URL(
      `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/agent-plan", "/api/agent/plan")}`
    )
    url.searchParams.set("source", flags.source ?? "cli_agent")

    const response = await fetch(url, { headers })
    if (!response.ok) {
      return null
    }

    const body = await response.json()
    if (usesPublicCliApi() && Array.isArray(body.plan)) {
      return {
        ...body,
        actions: body.plan.map((item) => ({
          ...item,
          id: normalizeCliActionId(item.key),
          kind: item.action_url ? "open_url" : "command",
          url: item.action_url,
          targetUrl: item.action_url,
          credits: item.points,
          status: item.status === "completed" ? "completed" : "pending",
          blocked: item.status === "blocked",
          requires: item.depends_on ?? [],
          command:
            item.key === CHROME_EXTENSION_ACTION_ID
              ? "npx indiecorns extension install"
              : `npx indiecorns follow ${item.key}`,
          agentCommand:
            item.key === CHROME_EXTENSION_ACTION_ID
              ? "npx indiecorns extension install --agent"
              : `npx indiecorns follow ${item.key} --agent`,
          verification:
            item.verification ??
            (item.key === CHROME_EXTENSION_ACTION_ID
              ? "extension_session"
              : "server_verified"),
          reviewUrl: item.review_url ?? item.reviewUrl,
        })),
      }
    }
    return body
  } catch {
    return null
  }
}

const normalizeAgentPlanForCli = ({ plan, flags, fallback }) => {
  const appUrl = getAppUrl(flags)
  const extensionId = getExtensionId(flags)
  const extensionUrl =
    plan?.desktopAutomation?.extensionUrl ?? getExtensionUrl(flags)
  const authenticated = hasToken() || hasBrowserSession()
  const actions = (plan?.actions ?? fallback.actions).map((action) => {
    const id = normalizeCliActionId(action.id)
    return {
      ...action,
      id,
      ...(authenticated && id === CLI_INSTALL_ACTION_ID
        ? { status: "completed" }
        : {}),
    }
  })
  const completedCount = actions.filter(
    (action) => action.status === "completed"
  ).length
  const openedCount = actions.filter(
    (action) => action.status === "opened"
  ).length
  const pendingCount = actions.filter(
    (action) => action.status === "pending"
  ).length
  const creditsEarned =
    plan?.summary?.creditsEarned ??
    actions
      .filter((action) => action.status === "completed")
      .reduce((total, action) => total + action.credits, 0)
  const creditsAvailable =
    plan?.summary?.creditsAvailable ??
    actions.reduce((total, action) => total + action.credits, 0)
  const remainingCommands = actions
    .filter((action) => action.status !== "completed")
    .map((action) => action.agentCommand ?? action.command)
    .filter(Boolean)
  const pendingCommands = actions
    .filter((action) => action.status === "pending")
    .map((action) => action.agentCommand ?? action.command)
    .filter(Boolean)
  const bootstrapNextAction = !authenticated
    ? {
        id: "login",
        kind: "command",
        title: "Sign in to Indiecorns",
        description: "Connect this terminal to your Indiecorns account.",
        credits: 0,
        platform: "indiecorns",
        status: "pending",
        targetUrl: `${appUrl}/auth?source=cli`,
        agentCommand: `npx indiecorns login --app-url ${appUrl}`,
        completeCommand: "npx indiecorns status --json",
        agentCapability: "blocked_auth",
        browserAssist: {
          required: false,
          mode: "none",
          instruction: "Run the login command to connect this terminal.",
          targetUrl: null,
        },
        verification: "cli_session",
        evidenceRequired: "completed CLI session",
        safeToAutoComplete: false,
        requires: [],
        aliases: ["auth", "signin", "sign-in"],
        lastObservation: {
          observedAt: null,
          count: 0,
        },
      }
    : null
  const serverNextAction = plan?.nextAction
  const preferredNextAction =
    QUICK_START_ACTION_IDS.map((actionId) =>
      actions.find(
        (action) =>
          action.id === actionId && action.status !== "completed"
      )
    ).find(Boolean) ??
    actions.find((action) => action.status !== "completed") ??
    null
  const nextAction =
    authenticated &&
    normalizeCliActionId(serverNextAction?.id) === CLI_INSTALL_ACTION_ID
      ? preferredNextAction
      : serverNextAction ?? bootstrapNextAction
  const fallbackReadiness = {
    cliSession: authenticated,
    pluginRequired: true,
    extensionUseful: actions.some(
      (action) => getBrowserAssist(action).required
    ),
    blockedAuth: !authenticated,
    blockedPlatformLogin: false,
    nextCommand:
      preferredNextAction?.agentCommand ??
      preferredNextAction?.command ??
      `npx indiecorns agent --app-url ${appUrl}`,
  }
  const serverNextCommand = plan?.readiness?.nextCommand
  const serverNextCommandIsCompleted = actions.some(
    (action) =>
      action.status === "completed" &&
      [action.command, action.agentCommand].includes(serverNextCommand)
  )
  const serverNextCommandIsBootstrap =
    /^npx\s+(?:--yes\s+)?indiecorns(?:@latest)?(?:\s+login)?(?:\s+--app-url\s+\S+)?$/.test(
      serverNextCommand ?? ""
    )
  const nextCommand =
    authenticated &&
    (serverNextCommandIsBootstrap || serverNextCommandIsCompleted)
      ? fallbackReadiness.nextCommand
      : serverNextCommand ?? fallbackReadiness.nextCommand

  return {
    app: "indiecorns",
    mode: plan?.mode ?? "agent_first",
    agentReady: true,
    appUrl,
    auth: {
      authenticated,
      method: hasToken() ? "INDIECORNS_TOKEN" : "browser",
      loginUrl: `${appUrl}/auth?source=cli`,
      signupUrl: `${appUrl}/auth?source=cli`,
      loginCommand: `npx indiecorns login --app-url ${appUrl}`,
      signupCommand: `npx indiecorns signup --app-url ${appUrl}`,
      statusCommand: "npx indiecorns status --json",
    },
    plugin: {
      name: "indiecorns",
      installed: existsSync(join(homedir(), "plugins", "indiecorns")),
      skillsInstalled: existsSync(
        join(homedir(), ".agents", "skills", "indiecorns")
      ),
      skillsRoot: join(homedir(), ".agents", "skills"),
      skills: ["indiecorns"],
      autoInstalledBy: "npx indiecorns login",
      installCommand: "npx indiecorns plugin install",
      requiredForAutopilot: true,
    },
    dashboard: {
      url: `${appUrl}/dashboard`,
      command: `npx indiecorns dashboard --no-open --app-url ${appUrl}`,
    },
    onboarding: {
      liveStatusLoaded: Boolean(plan),
      total: plan?.summary?.total ?? actions.length,
      completed: plan?.summary?.completed ?? completedCount,
      opened: plan?.summary?.opened ?? openedCount,
      pending: plan?.summary?.pending ?? pendingCount,
      needsBrowserAssist:
        plan?.summary?.needsBrowserAssist ??
        actions.filter((action) => getBrowserAssist(action).required).length,
      manualRequired:
        plan?.summary?.manualRequired ??
        actions.filter(
          (action) => getBrowserAssist(action).mode === "manual_record"
        ).length,
      creditsEarned,
      creditsAvailable,
      pendingCommands,
      remainingCommands,
      requiredFirstActionId: CLI_INSTALL_ACTION_ID,
    },
    readiness: {
      ...fallbackReadiness,
      ...(plan?.readiness ?? {}),
      cliSession: authenticated,
      blockedAuth: !authenticated,
      nextCommand,
    },
    nextAction,
    desktopAutomation: plan?.desktopAutomation ?? {
      available: actions.some((action) => getBrowserAssist(action).required),
      extensionId,
      extensionUrl,
      openCommand: `npx indiecorns extension open --app-url ${appUrl}`,
      runCommand: `npx indiecorns extension open --run-next --app-url ${appUrl}`,
      nextActionId:
        actions.find(
          (action) =>
            action.status !== "completed" && getBrowserAssist(action).required
        )?.id ?? null,
    },
    actions: actions.map((action) => ({
      id: action.id,
      kind: action.kind,
      title: action.title,
      description: action.description,
      credits: action.credits,
      platform: getActionPlatform(action),
      status: action.status,
      url: action.targetUrl ?? action.url,
      targetUrl: action.targetUrl ?? action.url,
      command: action.agentCommand ?? action.command,
      agentCommand: action.agentCommand ?? action.command,
      completeCommand:
        action.completeCommand ?? getCompleteCommand(action, flags),
      agentCapability: getAgentCapability(action, authenticated),
      browserAssist: getBrowserAssist(action),
      verification: action.verification,
      evidenceRequired: getEvidenceRequired(action),
      safeToAutoComplete:
        getAgentCapability(action, authenticated) === "cli_direct",
      reviewUrl: action.reviewUrl ?? action.reviewHref,
      required: action.required,
      requires: action.requires ?? [],
      targetProgress: action.targetProgress,
      lastObservation: action.lastObservation ?? {
        observedAt: action.lastObservationAt ?? null,
        count: action.observationCount ?? 0,
      },
      aliases: action.aliases,
    })),
    nextCommands: Array.from(
      new Set([
        ...(plan?.nextCommands ?? [
          "npx indiecorns login --no-open",
          "npx indiecorns tasks --agent",
        "npx indiecorns run --agent",
        "npx indiecorns extension open --run-next",
        "npx indiecorns dashboard --no-open",
      ]),
      "npx indiecorns follow-members all --agent",
      "npx indiecorns community-queue --agent",
      "npx indiecorns community-open --limit 5",
      "npx indiecorns community-next --agent",
      "npx indiecorns community-plan --agent",
        "npx indiecorns community-status --agent",
        "npx indiecorns peerlist-launches --agent",
        "npx indiecorns engage-members like x --agent",
        "npx indiecorns engage-members reshare linkedin --agent",
        "npx indiecorns engage-members comment x --agent",
        "npx indiecorns post set x --url <url> --title <title>",
        "npx indiecorns post list all --agent",
        "npx indiecorns launch set producthunt --url <url> --name <name>",
        "npx indiecorns launch list all --agent",
        "npx indiecorns upvote-members peerlist --agent",
        "npx indiecorns rate peerlist --agent",
        "npx indiecorns upvote-members producthunt --agent",
      ])
    ),
  }
}

const getAgentPlan = async (flags) => {
  const appUrl = getAppUrl(flags)
  const appPlan = await getAgentPlanFromApp(flags)
  const appActions = (await getOnboardingActionsFromApp(flags))?.actions
  const fallbackActions = appActions?.length ? appActions : ONBOARDING_ACTIONS
  const authenticated = hasToken() || hasBrowserSession()
  const fallbackTaskOutputs = fallbackActions.map((action) => {
    const output = toTaskOutput(action, flags)
    return authenticated && output.id === CLI_INSTALL_ACTION_ID
      ? { ...output, status: "completed" }
      : output
  })

  await trackCliEvent(
    appPlan ? "agent_plan_loaded" : "agent_plan_fallback",
    {
      source: flags.source ?? "cli_agent",
      app_url: appUrl,
      live_status_loaded: Boolean(appPlan),
      total_actions: appPlan?.summary?.total ?? fallbackTaskOutputs.length,
      completed_actions:
        appPlan?.summary?.completed ??
        fallbackTaskOutputs.filter((action) => action.status === "completed")
          .length,
    },
    flags
  )

  return normalizeAgentPlanForCli({
    plan: appPlan,
    flags,
    fallback: { actions: fallbackTaskOutputs },
  })
}

const openUrl = (url) => {
  const platform = process.platform
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open"
  const args = platform === "win32" ? ["/c", "start", "", url] : [url]

  return (
    spawnSync(command, args, {
      stdio: "ignore",
    }).status === 0
  )
}

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))

const urlLike = (value) =>
  /^https?:\/\//i.test(String(value ?? "")) ||
  /^[a-z0-9.-]+\.[a-z]{2,}/i.test(String(value ?? ""))

const withProtocol = (value) =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`

const safeUrl = (value) => {
  try {
    return new URL(withProtocol(String(value ?? "").trim()))
  } catch {
    return null
  }
}

const IMAGE_PROFILE_URL_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
])
const IMAGE_PROFILE_URL_HOSTS = new Set([
  "avatars.githubusercontent.com",
  "gravatar.com",
  "secure.gravatar.com",
])

const isImageProfileUrl = (value) => {
  const url = safeUrl(value)
  if (!url) {
    return false
  }

  const pathname = url.pathname.toLowerCase()
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase()
  if (IMAGE_PROFILE_URL_HOSTS.has(hostname)) {
    return true
  }

  if (pathname.includes("/avatar") || pathname.includes("/avatars/")) {
    return true
  }

  return [...IMAGE_PROFILE_URL_EXTENSIONS].some((extension) =>
    pathname.endsWith(extension)
  )
}

const SETUP_ASSISTANT_PROFILE_PLATFORMS = [
  "peerlist",
  "x",
  "linkedin",
  "github",
  "indiehackers",
  "producthunt",
  "substack",
  "website",
]

const SETUP_ASSISTANT_PLATFORM_ALIASES = {
  twitter: "x",
  xcom: "x",
  ph: "producthunt",
  producthunt: "producthunt",
  producthuntcom: "producthunt",
  ih: "indiehackers",
  indiehacker: "indiehackers",
  indiehackers: "indiehackers",
  indiehackerscom: "indiehackers",
  link: "website",
  site: "website",
  homepage: "website",
}

const normalizeSetupAssistantPlatform = (value) => {
  const platform = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
  const normalized = SETUP_ASSISTANT_PLATFORM_ALIASES[platform] ?? platform
  return SETUP_ASSISTANT_PROFILE_PLATFORMS.includes(normalized)
    ? normalized
    : null
}

const inferSetupAssistantPlatform = (value) => {
  const url = safeUrl(value)
  if (!url) return null
  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  if (host === "peerlist.io") return "peerlist"
  if (host === "x.com" || host === "twitter.com") return "x"
  if (host.endsWith("linkedin.com")) return "linkedin"
  if (host === "github.com") return "github"
  if (host === "indiehackers.com") return "indiehackers"
  if (host === "producthunt.com") return "producthunt"
  if (host.endsWith(".substack.com")) return "substack"
  return urlLike(value) ? "website" : null
}

const profileUrlForSetupAssistant = ({ platform, username, profileUrl }) => {
  if (profileUrl) return withProtocol(profileUrl)
  if (!username) return null
  if (platform === "peerlist") return `https://peerlist.io/${username}`
  if (platform === "x") return `https://x.com/${username}`
  if (platform === "linkedin") return `https://www.linkedin.com/in/${username}`
  if (platform === "github") return `https://github.com/${username}`
  if (platform === "indiehackers") {
    return `https://www.indiehackers.com/${username}`
  }
  if (platform === "producthunt") {
    return `https://www.producthunt.com/@${username}`
  }
  if (platform === "substack") return `https://${username}.substack.com`
  if (platform === "website") return withProtocol(username)
  return null
}

const setupAssistantCommandForProfile = (
  { platform, username, profileUrl },
  flags
) => {
  const appUrl = getAppUrl(flags)
  if (profileUrl || platform === "website" || platform === "linkedin") {
    const value =
      profileUrl ??
      profileUrlForSetupAssistant({ platform, username, profileUrl })
    return `npx indiecorns profile set ${platform} --profile-url ${shellQuote(value)} --app-url ${shellQuote(appUrl)}`
  }

  return `npx indiecorns profile set ${platform} --username ${shellQuote(username)} --app-url ${shellQuote(appUrl)}`
}

const normalizeSetupAssistantProfileInput = ({
  platform: platformInput,
  value,
  flags = {},
}) => {
  const rawValue = String(value ?? "").trim()
  if (!rawValue) {
    return {
      ok: false,
      reason: "missing_input",
      message: "Missing profile value.",
    }
  }

  const platform =
    normalizeSetupAssistantPlatform(platformInput) ??
    inferSetupAssistantPlatform(rawValue)
  if (!platform) {
    return {
      ok: false,
      reason: "unknown_platform",
      message: "Tell me which platform this profile belongs to.",
    }
  }

  if (platform === "website" && isImageProfileUrl(rawValue)) {
    return {
      ok: false,
      platform,
      reason: "image_url",
      message: "Use your website URL, not an image URL.",
    }
  }

  const isUrl = urlLike(rawValue)
  const url = isUrl ? safeUrl(rawValue) : null
  const username =
    platform === "website" && url
      ? url.hostname.replace(/^www\./, "").toLowerCase()
      : isUrl
        ? profileUsernameFromUrl(platform, rawValue)
        : rawValue.replace(/^@/, "").trim()
  const profileUrl = isUrl
    ? withProtocol(rawValue)
    : platform === "website"
      ? withProtocol(rawValue)
      : null

  if (!username && !profileUrl) {
    return {
      ok: false,
      platform,
      reason: "unusable_input",
      message: "Could not read a username or profile URL from that value.",
    }
  }

  const normalized = {
    ok: true,
    platform,
    username,
    profileUrl,
  }

  return {
    ...normalized,
    command: setupAssistantCommandForProfile(normalized, flags),
    message:
      platform === "website"
        ? `Website profile ready for ${username}.`
        : `${platform} profile ready for @${username}.`,
  }
}

const profileUsernameFromUrl = (platform, value) => {
  const url = safeUrl(value)
  if (!url) {
    return null
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
  const first = segments[0]?.replace(/^@/, "")
  const second = segments[1]?.replace(/^@/, "")

  if (platform === "linkedin") {
    if (host.endsWith("linkedin.com") && first === "in" && second) {
      return second.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
    }
    return null
  }
  if (platform === "x") {
    if ((host === "x.com" || host === "twitter.com") && first) {
      return first.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
    }
    return null
  }
  if (platform === "peerlist") {
    if (host === "peerlist.io" && first) {
      return first.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
    }
    return null
  }
  if (platform === "github") {
    if (host === "github.com" && first) {
      return first.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
    }
    return null
  }
  if (platform === "indiehackers") {
    if (host === "indiehackers.com" && first) {
      return first.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
    }
    return null
  }
  if (platform === "substack") {
    if (host.endsWith(".substack.com")) {
      return host.replace(/\.substack\.com$/, "") || null
    }
    return null
  }
  if (first) {
    return first.toLowerCase().replace(/[^a-z0-9._-]/g, "") || null
  }

  return null
}

const profileUrlNeedsBrowserResolution = (platform, value) => {
  const url = safeUrl(value)
  if (!url) {
    return false
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (platform === "linkedin") {
    return host.endsWith("linkedin.com") && segments[0] === "in" && !segments[1]
  }
  if (platform === "x") {
    return (host === "x.com" || host === "twitter.com") && !segments[0]
  }
  if (platform === "peerlist") {
    return host === "peerlist.io" && !segments[0]
  }
  if (platform === "github") {
    return host === "github.com" && !segments[0]
  }
  return false
}

const isResolvedPlatformProfileUrl = (platform, value) =>
  Boolean(profileUsernameFromUrl(platform, value)) &&
  !profileUrlNeedsBrowserResolution(platform, value)

const readBrowserUrlForApp = (appName) => {
  if (process.platform !== "darwin") {
    return null
  }

  const isSafari = appName === "Safari"
  const script = isSafari
    ? `tell application "${appName}"\nif not running then return ""\nif (count of windows) is 0 then return ""\nreturn URL of current tab of front window\nend tell`
    : `tell application "${appName}"\nif not running then return ""\nif (count of windows) is 0 then return ""\nreturn URL of active tab of front window\nend tell`

  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  const url = result.stdout?.trim()
  return urlLike(url) ? url : null
}

const readActiveBrowserUrl = (matches = null) => {
  let fallbackUrl = null

  for (const appName of [
    "Google Chrome",
    "Brave Browser",
    "Microsoft Edge",
    "Arc",
    "Safari",
  ]) {
    const url = readBrowserUrlForApp(appName)
    if (url) {
      fallbackUrl ??= url
      if (!matches || matches(url)) {
        return url
      }
    }
  }

  return matches ? null : fallbackUrl
}

const resolveRedirectUrl = async (value) => {
  const url = safeUrl(value)
  if (!url) {
    return null
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(3500),
    })
    return response.url && urlLike(response.url) ? response.url : null
  } catch {
    return null
  }
}

const resolveProfileInput = async ({
  flags,
  platform,
  username,
  profileUrl,
}) => {
  const candidate = profileUrl ?? (urlLike(username) ? username : null)
  let resolvedProfileUrl = candidate ? withProtocol(candidate) : profileUrl
  let resolvedUsername = username && !urlLike(username) ? username : null
  const resolution = {
    input: candidate ?? username ?? null,
    method: "direct",
    openedBrowser: false,
    finalUrl: resolvedProfileUrl ?? null,
  }

  if (candidate) {
    const redirectUrl = await resolveRedirectUrl(candidate)
    if (redirectUrl) {
      resolvedProfileUrl = redirectUrl
      resolution.method = "http_redirect"
      resolution.finalUrl = redirectUrl
    }

    if (
      profileUrlNeedsBrowserResolution(platform, resolvedProfileUrl) &&
      flags.open !== false &&
      !flags["no-open"] &&
      !flags.json &&
      !flags.agent
    ) {
      openUrl(resolvedProfileUrl)
      resolution.openedBrowser = true
      const resolveDelayMs = Number.parseInt(
        flags["resolve-delay"] ?? "5000",
        10
      )
      const deadline =
        Date.now() + (Number.isFinite(resolveDelayMs) ? resolveDelayMs : 5000)
      while (Date.now() < deadline) {
        const browserUrl = readActiveBrowserUrl(
          (url) =>
            isResolvedPlatformProfileUrl(platform, url) ||
            profileUrlNeedsBrowserResolution(platform, url)
        )
        if (browserUrl && isResolvedPlatformProfileUrl(platform, browserUrl)) {
          resolvedProfileUrl = browserUrl
          resolution.method = "browser_redirect"
          resolution.finalUrl = browserUrl
          break
        }
        await sleep(500)
      }
    }

    resolvedUsername = profileUsernameFromUrl(platform, resolvedProfileUrl)
  }

  return {
    username: resolvedUsername,
    profileUrl: resolvedProfileUrl,
    resolution,
  }
}

const createCliSession = async (appUrl) => {
  const metadata = {
    cliVersion: getCliVersion(),
    nodeVersion: process.version,
    platform: osPlatform(),
    architecture: osArch(),
  }
  const modernResponse = await fetch(`${appUrl}/api/public/cli/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  })

  if (modernResponse.ok) {
    const session = await modernResponse.json()
    if (session.code && session.verification_url) {
      return {
        ...session,
        authMode: "device_code",
        id: session.code,
      }
    }
  }

  const legacyResponse = await fetch(`${appUrl}/api/cli/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  })
  if (!legacyResponse.ok) {
    throw new Error("Unable to create a CLI auth session.")
  }
  return { ...(await legacyResponse.json()), authMode: "legacy" }
}

const pollCliSession = async ({
  appUrl,
  id,
  secret,
  code,
  pollUrl,
  exchangeUrl,
  authMode,
}) => {
  if (authMode === "device_code" || code || pollUrl) {
    const deviceCode = code ?? id
    const pollEndpoint =
      pollUrl ?? `${appUrl}/api/public/cli/session/${encodeURIComponent(deviceCode)}`
    const response = await fetch(pollEndpoint)
    if (response.status === 404) return { status: "not_found" }
    if (!response.ok) return { status: "error" }
    const session = await response.json()
    if (session.status !== "completed") return session

    const exchangeEndpoint =
      exchangeUrl ??
      `${appUrl}/api/public/cli/session/${encodeURIComponent(deviceCode)}/exchange`
    const exchange = await fetch(exchangeEndpoint, { method: "POST" })
    if (exchange.status === 410) {
      return { status: "expired", ...(await exchange.json()) }
    }
    if (!exchange.ok) return { status: "error" }
    const token = await exchange.json()
    return {
      status: "completed",
      completedAt: session.completed_at,
      token: token.token,
      tokenExpiresAt: token.token_expires_at,
      userId: token.user_id,
    }
  }

  const url = new URL(`${appUrl}/api/cli/sessions`)
  url.searchParams.set("id", id)
  url.searchParams.set("secret", secret)
  const response = await fetch(url)

  if (!response.ok) {
    return { status: "error" }
  }

  return response.json()
}

const getOnboardingActionsFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  let response
  try {
    response = await fetch(
      `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/tasks", "/api/onboarding/actions")}`,
      { headers }
    )
  } catch {
    return null
  }

  if (!response.ok) {
    return null
  }

  const body = await response.json()
  if (usesPublicCliApi() && Array.isArray(body.tasks)) {
    return {
      ...body,
      actions: body.tasks.map((task) => ({
        ...task,
        id: normalizeCliActionId(task.key),
        url: task.action_url,
        credits: task.points,
        requires: task.depends_on ?? [],
      })),
    }
  }
  return body
}

const saveOnboardingActionToApp = async ({
  flags,
  action,
  status = "opened",
  source = "cli",
}) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }
  // The modern API completes tasks from verifiable profile/event/session data.
  // It intentionally has no generic "mark complete" endpoint.
  if (usesPublicCliApi()) {
    return { saved: false, verificationRequired: true }
  }

  const response = await fetch(`${getAppUrl(flags)}/api/onboarding/actions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      actionId: action.id,
      status,
      source,
    }),
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const getExternalActionEventsFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const url = new URL(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/events", "/api/onboarding/events")}`
  )
  if (flags.action) {
    url.searchParams.set("actionId", flags.action)
  }
  const platform = normalizeCommunityPlatform(flags.platform)
  if (platform && platform !== "all") {
    url.searchParams.set("platform", platform)
  }
  const eventType = normalizeCommunityEventType(
    flags.type ?? flags["event-type"] ?? flags.actionType ?? "all"
  )
  if (eventType && eventType !== "all") {
    url.searchParams.set("eventType", eventType)
  }
  if (flags.status) {
    url.searchParams.set("status", flags.status)
  }
  if (flags.limit) {
    url.searchParams.set("limit", flags.limit)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    return null
  }

  const body = await response.json()
  if (usesPublicCliApi() && Array.isArray(body.events)) {
    return {
      ...body,
      events: body.events.map((event) => ({
        ...event,
        platform: event.target_platform,
        event_type: event.action_type,
        target_profile_url: event.target_url,
        observed_label_before: event.before_label,
        observed_label_after: event.after_label,
        evidence_url: event.proof_url,
        updated_at: event.verified_at ?? event.occurred_at,
        created_at: event.occurred_at,
      })),
    }
  }
  return body
}

const summarizeExternalActionEvents = (events) => {
  const byPlatform = {}
  const byEventType = {}
  const byActionGroup = {
    follow: 0,
    engagement: 0,
  }
  const byTargetType = {}
  const byTargetSource = {}
  let lastRecordedAt = null

  for (const event of events) {
    const platform = event.platform ?? "unknown"
    const eventType = event.event_type ?? "unknown"
    const actionGroup = eventType === "follow" ? "follow" : "engagement"
    const targetType =
      event.metadata?.targetType ??
      (eventType === "follow"
        ? "profile_follow"
        : eventType === "upvote"
          ? "project"
          : "profile_engagement")
    const targetSource =
      event.target_source ??
      (targetType === "post"
        ? "posts"
        : targetType === "project"
          ? "projects"
          : "profiles")

    byPlatform[platform] = (byPlatform[platform] ?? 0) + 1
    byEventType[eventType] = (byEventType[eventType] ?? 0) + 1
    byActionGroup[actionGroup] = (byActionGroup[actionGroup] ?? 0) + 1
    byTargetType[targetType] = (byTargetType[targetType] ?? 0) + 1
    byTargetSource[targetSource] = (byTargetSource[targetSource] ?? 0) + 1

    const recordedAt = event.updated_at ?? event.created_at
    if (recordedAt && (!lastRecordedAt || recordedAt > lastRecordedAt)) {
      lastRecordedAt = recordedAt
    }
  }

  return {
    total: events.length,
    byPlatform,
    byEventType,
    byActionGroup,
    byTargetType,
    byTargetSource,
    lastRecordedAt,
  }
}

const getCommunityReportingInfo = (flags) => {
  const appUrl = getAppUrl(flags)
  return {
    dashboard: {
      activityUrl: `${appUrl}/dashboard/activity`,
      usersUrl: `${appUrl}/dashboard/users`,
      command: `npx indiecorns dashboard --no-open --app-url ${appUrl}`,
    },
    reportingViews: [
      "public.indiecorns_community_activity_events",
      "public.indiecorns_community_activity_daily",
      "public.indiecorns_community_member_metrics",
    ],
    note:
      "Recorded external action events feed the activity dashboard, member metrics, and Data Studio-ready public reporting views.",
  }
}

const getExternalProfilesFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const url = new URL(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/external-profiles", "/api/users/external-profiles")}`
  )
  if (flags.platform && flags.platform !== "all") {
    url.searchParams.set("platform", flags.platform)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const getIndieHackersAutofillPlanFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const response = await fetch(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/indiehackers-autofill", "/api/users/indiehackers/autofill")}`,
    { headers }
  )

  if (!response.ok) {
    return null
  }

  return response.json()
}

const getCommunityActionTargetsFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const url = new URL(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/community-targets", "/api/community/action-targets")}`
  )
  if (flags.platform && flags.platform !== "all") {
    url.searchParams.set("platform", flags.platform)
  }
  if (flags.type || flags["event-type"]) {
    url.searchParams.set("eventType", flags.type ?? flags["event-type"])
  }
  const targetSource = normalizeCommunityTargetSource(
    flags["target-source"] ?? flags.targetSource ?? "all"
  )
  if (targetSource !== "all") {
    url.searchParams.set(
      "targetSource",
      targetSource
    )
  }
  if (flags.limit) {
    url.searchParams.set("limit", flags.limit)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const saveExternalProfileToApp = async ({ flags, platform }) => {
  const normalizedPlatform = normalizeProfileCachePlatform(platform)
  const rawUsername = flags.username ?? flags.user ?? flags.handle
  const rawProfileUrl = flags["profile-url"] ?? flags.url
  const resolved = await resolveProfileInput({
    flags,
    platform: normalizedPlatform,
    username: rawUsername,
    profileUrl: rawProfileUrl,
  })
  const username = resolved.username ?? rawUsername
  const profileUrl =
    resolved.profileUrl ??
    rawProfileUrl ??
    profileUrlForSetupAssistant({
      platform: normalizedPlatform,
      username,
      profileUrl: rawProfileUrl,
    })
  const normalizedUsername =
    username ??
    (profileUrl ? profileUsernameFromUrl(normalizedPlatform, profileUrl) : null)
  const localUsername =
    normalizedUsername ??
    (normalizedPlatform === "website" && profileUrl
      ? safeUrl(profileUrl)?.hostname.replace(/^www\./, "").toLowerCase()
      : null)
  if (
    normalizedPlatform === "website" &&
    profileUrl &&
    isImageProfileUrl(profileUrl)
  ) {
    return {
      saved: false,
      message:
        "Use your website URL, not an image URL. If the URL contains ?, wrap it in quotes.",
      resolution: resolved.resolution,
    }
  }

  if (!localUsername && !profileUrl) {
    return {
      saved: false,
      message:
        normalizedPlatform === "website"
          ? "Add your website URL. Example: indiecorns profile set website --profile-url https://your-site.com"
          : "Missing --username or --profile-url.",
      resolution: resolved.resolution,
    }
  }

  if (
    profileUrl &&
    profileUrlNeedsBrowserResolution(normalizedPlatform, profileUrl) &&
    !localUsername
  ) {
    return {
      saved: false,
      message:
        normalizedPlatform === "linkedin"
          ? resolved.resolution.openedBrowser
            ? "Could not resolve the final LinkedIn profile URL. Make sure a desktop browser is signed in to LinkedIn and that https://www.linkedin.com/in/ forwards to your profile."
            : "Could not resolve the final LinkedIn profile URL. Run without --json or --no-open on desktop so https://www.linkedin.com/in/ can forward to your profile."
          : "Could not resolve the final profile URL. Run without --no-open on desktop, then retry after the browser reaches your profile.",
      resolution: resolved.resolution,
    }
  }

  const localProfile = upsertLocalExternalProfile({
    platform: normalizedPlatform,
    username: localUsername,
    profileUrl,
    displayName: flags["display-name"],
    source: "local_cli",
    confidence: "local",
  })
  const headers = getCliAuthHeaders()
  if (!headers) {
    return {
      saved: false,
      localSaved: Boolean(localProfile),
      profile: localProfile,
      message: "Cached profile locally. Run indiecorns login to sync it to Indiecorns.",
      resolution: resolved.resolution,
    }
  }

  const response = await fetch(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/external-profiles", "/api/users/external-profiles")}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        usesPublicCliApi()
          ? {
              platform: normalizedPlatform,
              url: profileUrl,
              username: localUsername,
            }
          : {
              platform: normalizedPlatform,
              username: localUsername,
              profileUrl,
              displayName: flags["display-name"],
              source:
                flags.source ??
                (resolved.resolution.method === "browser_redirect"
                  ? "cli_browser_resolved"
                  : "cli"),
              confidence: flags.confidence ?? "user_verified",
            }
      ),
    }
  )

  if (!response.ok) {
    let message = `Unable to save ${normalizedPlatform} profile.`
    try {
      const body = await response.json()
      if (typeof body?.message === "string" && body.message.trim()) {
        message = body.message.trim()
      }
    } catch {
      // Keep the generic message when the app returns a non-JSON error.
    }
    return {
      saved: false,
      localSaved: Boolean(localProfile),
      profile: localProfile,
      message,
      resolution: resolved.resolution,
    }
  }

  const body = await response.json()
  if (body?.profile) {
    upsertLocalExternalProfile({
      ...body.profile,
      source: "app_synced",
      confidence: body.profile.confidence ?? "user_verified",
    })
  }
  return {
    ...body,
    saved: body.saved ?? body.ok ?? false,
    profile: body.profile ?? localProfile,
    resolution: resolved.resolution,
  }
}

const saveCommunityLaunchToApp = async ({ flags, platform }) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const launchUrl = flags["launch-url"] ?? flags.url ?? flags["target-url"]
  if (!launchUrl) {
    return {
      saved: false,
      message: "Missing --url.",
    }
  }
  const normalizedLaunchUrl = normalizeCommunityTargetUrl(launchUrl)
  if (
    !normalizedLaunchUrl ||
    !isCommunityLaunchUrlForPlatform(platform, normalizedLaunchUrl)
  ) {
    return {
      saved: false,
      message: `Pass a valid ${platform} launch URL.`,
    }
  }

  const response = await fetch(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/launches", "/api/community/launches")}`,
    {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      usesPublicCliApi()
        ? {
            platform,
            url: normalizedLaunchUrl,
            title:
              flags.name ??
              flags["display-name"] ??
              safeUrl(normalizedLaunchUrl)?.pathname.split("/").filter(Boolean).at(-1) ??
              `${platform} launch`,
            tagline: flags.description,
            launched_at: flags["launched-at"],
            status: flags.status,
          }
        : {
            platform,
            launchUrl: normalizedLaunchUrl,
            name: flags.name ?? flags["display-name"],
            description: flags.description,
            imageUrl: flags["image-url"],
            launchedAt: flags["launched-at"],
            status: flags.status,
          }
    ),
  })

  if (!response.ok) {
    let message = `Unable to save ${platform} launch.`
    try {
      const body = await response.json()
      if (typeof body?.message === "string" && body.message.trim()) {
        message = body.message.trim()
      }
    } catch {
      // Keep the generic message when the app returns a non-JSON error.
    }
    return {
      saved: false,
      message,
    }
  }

  return response.json()
}

const getCommunityLaunchesFromApp = async ({ flags, platform }) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const url = new URL(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/launches", "/api/community/launches")}`
  )
  if (platform && platform !== "all") {
    url.searchParams.set("platform", platform)
  }
  if (flags.status) {
    url.searchParams.set("status", flags.status)
  }
  if (flags.limit) {
    url.searchParams.set("limit", flags.limit)
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    let message = "Unable to load launches."
    try {
      const body = await response.json()
      if (typeof body?.message === "string" && body.message.trim()) {
        message = body.message.trim()
      }
    } catch {
      // Keep the generic message when the app returns a non-JSON error.
    }
    return { launches: [], message }
  }

  return response.json()
}

const saveCommunityPostToApp = async ({ flags, platform }) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const postUrl = flags["post-url"] ?? flags.url ?? flags["target-url"]
  if (!postUrl) {
    return {
      saved: false,
      message: "Missing --url.",
    }
  }
  const normalizedPostUrl = normalizeCommunityTargetUrl(postUrl)
  if (!normalizedPostUrl || !isCommunityPostUrlForPlatform(platform, normalizedPostUrl)) {
    return {
      saved: false,
      message: `Pass a valid ${platform} post URL.`,
    }
  }

  const response = await fetch(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/posts", "/api/community/posts")}`,
    {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      usesPublicCliApi()
        ? {
            platform,
            url: normalizedPostUrl,
            title: flags.title ?? flags.name ?? flags["display-name"],
            status: flags.status,
          }
        : {
            platform,
            postUrl: normalizedPostUrl,
            title: flags.title ?? flags.name ?? flags["display-name"],
            authorUsername: flags.author ?? flags["author-username"],
            status: flags.status,
          }
    ),
  })

  if (!response.ok) {
    let message =
      response.status === 404
        ? `The ${platform} post API is not available at ${getAppUrl(flags)} yet. Deploy the current app before saving shared posts there.`
        : `Unable to save ${platform} post.`
    try {
      const body = await response.json()
      if (typeof body?.message === "string" && body.message.trim()) {
        message = body.message.trim()
      }
    } catch {
      // Keep the generic message when the app returns a non-JSON error.
    }
    return {
      saved: false,
      message,
    }
  }

  return response.json()
}

const getCommunityPostsFromApp = async ({ flags, platform }) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const platforms = platform === "all" ? ["x", "linkedin"] : [platform]
  const posts = []
  for (const item of platforms) {
    const url = new URL(
      `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/posts", "/api/community/posts")}`
    )
    url.searchParams.set("platform", item)
    if (flags.status) {
      url.searchParams.set("status", flags.status)
    }
    if (flags.limit) {
      url.searchParams.set("limit", flags.limit)
    }

    const response = await fetch(url, { headers })
    if (!response.ok) {
      let message = `Unable to load ${item} posts.`
      try {
        const body = await response.json()
        if (typeof body?.message === "string" && body.message.trim()) {
          message = body.message.trim()
        }
      } catch {
        // Keep the generic message when the app returns a non-JSON error.
      }
      return { posts, message }
    }
    const body = await response.json()
    posts.push(...(body.posts ?? []))
  }

  return { posts }
}

const saveExternalActionEventToApp = async ({
  flags,
  actionId,
  platform,
  eventType = "follow",
  status = "followed",
}) => {
  const targetUsername = flags.target ?? flags["target-username"]
  const explicitTargetProfileUrl =
    flags["target-url"] ?? flags.url ?? flags["post-url"] ?? flags["launch-url"]
  const targetProfileUrl =
    explicitTargetProfileUrl ??
    getPlatformProfileUrl({
      platform,
      username: targetUsername,
    })
  const rawTargetType = flags["target-type"] ?? flags.targetType
  const targetType =
    normalizeRecordTargetType(rawTargetType) ??
    inferRecordTargetType({ platform, eventType, targetProfileUrl })
  const queueKey = flags["queue-key"] ?? flags.queueKey ?? null
  const ratingValue = Number.parseInt(flags.rating ?? flags.stars ?? "5", 10)
  const rating =
    eventType === "rate" && Number.isFinite(ratingValue)
      ? Math.min(Math.max(ratingValue, 1), 5)
      : null

  if (!targetProfileUrl) {
    return {
      saved: false,
      message: "Missing --target-url or --target.",
    }
  }

  if (rawTargetType && !normalizeRecordTargetType(rawTargetType)) {
    return {
      saved: false,
      message: "Unknown --target-type. Use profile, post, or project.",
    }
  }

  if (
    !explicitTargetProfileUrl &&
    (targetType === "post" || targetType === "project")
  ) {
    return {
      saved: false,
      message:
        "Recording post and project actions requires an explicit --target-url.",
    }
  }

  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const response = await fetch(
    `${getAppUrl(flags)}${getCliEndpoint("/api/public/cli/events", "/api/onboarding/events")}`,
    {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      usesPublicCliApi()
        ? {
            target_platform: platform,
            target_type: targetType,
            action_type: eventType,
            target_url: targetProfileUrl,
            target_username: targetUsername,
            before_label: flags["label-before"],
            after_label: flags["label-after"],
            verification_note: flags.note,
            proof_url: flags["evidence-url"],
            proof_kind: flags["proof-kind"],
            idempotency_key: queueKey
              ? `cli:${queueKey}`
              : `cli:${platform}:${eventType}:${randomUUID()}`,
          }
        : {
            actionId,
            platform,
            eventType,
            status: flags.status ?? status,
            actorUsername: flags.actor ?? flags["actor-username"],
            targetUsername,
            targetDisplayName: flags["display-name"],
            targetProfileUrl,
            source: flags.source ?? "agent",
            observedLabelBefore: flags["label-before"],
            observedLabelAfter: flags["label-after"],
            evidenceUrl: flags["evidence-url"],
            metadata: {
              recordedBy: "indiecorns-cli",
              targetType,
              ...(rating
                ? { rating, peerlistRating: { rating, maxRating: 5 } }
                : {}),
              ...(queueKey ? { queueKey } : {}),
            },
          }
    ),
  })

  if (!response.ok) {
    return null
  }

  const body = await response.json()
  return usesPublicCliApi()
    ? { ...body, saved: body.saved ?? body.ok ?? false }
    : body
}

const saveCompletedSession = ({ appUrl, session, id, secret }) => {
  const config = readConfig()
  const authenticatedAt = session.completedAt ?? new Date().toISOString()
  const modernSession = Boolean(session.token)
  writeConfig({
    ...config,
    pendingCliSession: undefined,
    browserSession: {
      authenticatedAt,
      appUrl,
      userEmail: session.userEmail,
      userId: session.userId,
      cliVersion: session.cliVersion ?? getCliVersion(),
      nodeVersion: session.nodeVersion,
      platform: session.platform,
      architecture: session.architecture,
      ...(modernSession
        ? {
            authMode: "device_code",
            accessToken: session.token,
            tokenExpiresAt: session.tokenExpiresAt,
          }
        : { authMode: "legacy", cliSessionId: id, cliSecret: secret }),
    },
  })
}

const saveCliInstallAction = async (appUrl) =>
  saveOnboardingActionToApp({
    flags: { "app-url": appUrl },
    action: ONBOARDING_ACTIONS.find(
      (action) => action.id === CLI_INSTALL_ACTION_ID
    ),
    status: "completed",
    source: "cli",
  })

const markCliInstalled = async (appUrl, { serverAlreadyRecorded = false } = {}) => {
  const [savedAction, pluginInstall] = await Promise.all([
    serverAlreadyRecorded
      ? Promise.resolve({ saved: true, source: "device_code_exchange" })
      : saveCliInstallAction(appUrl),
    Promise.resolve(installPluginBundle()),
  ])

  return { savedAction, pluginInstall }
}

const waitForAppCliSession = async ({ appUrl, id, secret, session: pending, timeoutSeconds }) => {
  const deadline = Date.now() + timeoutSeconds * 1000

  while (Date.now() < deadline) {
    const session = await pollCliSession({ appUrl, id, secret, ...pending })

    if (session.status === "completed") {
      saveCompletedSession({ appUrl, session, id, secret })
      const installResult = await markCliInstalled(appUrl, {
        serverAlreadyRecorded: Boolean(session.token),
      })
      return { ...session, ...installResult }
    }

    if (session.status === "expired" || session.status === "not_found") {
      return session
    }

    await sleep(2000)
  }

  return { status: "timeout" }
}

const runBrowserAuth = async (flags, mode = "login") => {
  const route = mode === "signup" ? "sign-up" : "sign-in"
  const appUrl = getAppUrl(flags)
  const timeoutSeconds = Number.parseInt(flags.timeout ?? "180", 10)
  const safeTimeoutSeconds =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 180
  let authUrl = new URL(`${appUrl}/${route}`)
  const action =
    mode === "signup"
      ? "Create your Indiecorns account"
      : "Sign in to Indiecorns"
  authUrl.searchParams.set("source", "cli")

  const cliSession = flags.json
    ? await createCliSession(appUrl)
    : await withSpinner(
        "Preparing your Indiecorns sign-in link...",
        () => createCliSession(appUrl),
        ok("Sign-in link is ready.")
      )
  if (cliSession.authMode === "device_code") {
    authUrl = new URL(cliSession.verification_url)
  } else {
    authUrl.searchParams.set("cli_session", cliSession.id)
    authUrl.searchParams.set("cli_secret", cliSession.secret)
  }
  writeConfig({
    ...readConfig(),
    pendingCliSession: {
      appUrl,
      id: cliSession.id,
      secret: cliSession.secret,
      code: cliSession.code,
      pollUrl: cliSession.poll_url,
      exchangeUrl: cliSession.exchange_url,
      authMode: cliSession.authMode,
      createdAt: new Date().toISOString(),
    },
  })

  if (flags.json) {
    printJson({
      status: "browser_auth_required",
      mode,
      url: authUrl.toString(),
      code: cliSession.code ?? undefined,
      expiresAt: cliSession.expires_at ?? undefined,
      message: `Open the ${mode} URL to continue with Indiecorns.`,
    })
    return 0
  }

  printBrandHeader(
    mode === "signup"
      ? "will help you create your account."
      : "will guide the browser sign-in."
  )
  section(action)
  console.log(
    "I will open Indiecorns, wait here, connect this terminal, and install the local agent plugin and skills for you."
  )
  console.log(dim(`Secure browser URL: ${authUrl.toString()}`))

  if (flags.open === false || flags["no-open"]) {
    console.log(`Open this URL when you are ready: ${authUrl.toString()}`)
    console.log(
      "After signing in, come back here and run: npx indiecorns status"
    )
    return 0
  }

  const browserOpened = await withSpinner(
    "Opening Indiecorns in your browser...",
    () => Promise.resolve(openUrl(authUrl.toString())),
    ok("Browser opened. I am watching for the handoff.")
  )

  if (browserOpened) {
    console.log(dim(`Waiting up to ${safeTimeoutSeconds} seconds.`))

    const session = await withSpinner(
      "Waiting for you to finish sign-in...",
      () =>
        waitForAppCliSession({
          appUrl,
          id: cliSession.id,
          secret: cliSession.secret,
          session: cliSession,
          timeoutSeconds: safeTimeoutSeconds,
        }),
      ok("Indiecorns and this terminal are connected.")
    )

    if (session.status === "completed") {
      section("Ready")
      console.log(ok("Authenticated."))
      if (session.userEmail) {
        console.log(`User: ${session.userEmail}`)
      }
      if (session.pluginInstall?.installed) {
        console.log(
          ok("Agent plugin and skills installed for local coding agents.")
        )
      } else if (session.pluginInstall?.error) {
        console.log(
          warn(`Plugin install skipped: ${session.pluginInstall.error}`)
        )
      }
      console.log("")
      return runWizard(flags)
    }

    section("Still waiting")
    console.log(warn("The browser sign-in has not finished yet."))
    console.log("Finish auth in the browser, then run: npx indiecorns status")
    return 1
  }

  console.log(
    warn("I could not open a browser automatically. Copy the URL above.")
  )
  return 0
}

const runAuthStatus = async (flags) => {
  if (hasToken()) {
    const pluginInstall = installPluginBundle()
    const result = {
      authenticated: true,
      method: "INDIECORNS_TOKEN",
      pluginInstall,
      message: "Using INDIECORNS_TOKEN from the environment.",
    }

    if (flags.json) {
      printJson(result)
      return 0
    }

    printBrandHeader("is connected with an environment token.")
    section("Auth")
    console.log(ok("Authenticated with INDIECORNS_TOKEN."))
    if (pluginInstall.installed) {
      console.log(
        ok("Agent plugin and skills installed for local coding agents.")
      )
    }
    return 0
  }

  const config = readConfig()
  if (
    config.pendingCliSession?.id &&
    (config.pendingCliSession?.secret ||
      config.pendingCliSession?.authMode === "device_code")
  ) {
    const session = await pollCliSession(config.pendingCliSession)
    if (session.status === "completed") {
      saveCompletedSession({
        appUrl: config.pendingCliSession.appUrl,
        session,
        id: config.pendingCliSession.id,
        secret: config.pendingCliSession.secret,
      })
      const installResult = await markCliInstalled(config.pendingCliSession.appUrl, {
        serverAlreadyRecorded: Boolean(session.token),
      })

      const result = {
        authenticated: true,
        method: "browser",
        appUrl: config.pendingCliSession.appUrl,
        userEmail: session.userEmail,
        authenticatedAt: session.completedAt,
        pluginInstall: installResult.pluginInstall,
        message: "Browser sign-in completed for this machine.",
      }

      if (flags.json) {
        printJson(result)
        return 0
      }

      printBrandHeader("is connected on this machine.")
      section("Auth")
      console.log(ok("Browser sign-in completed for this machine."))
      if (session.userEmail) {
        console.log(`User: ${session.userEmail}`)
      }
      if (installResult.pluginInstall.installed) {
        console.log(
          ok("Agent plugin and skills installed for local coding agents.")
        )
      }
      return 0
    }

    if (session.status !== "expired" && session.status !== "not_found") {
      const result = {
        authenticated: false,
        method: "browser",
        status: "pending",
        message: "Browser sign-in is still pending.",
      }

      if (flags.json) {
        printJson(result)
        return 0
      }

      printBrandHeader("is waiting for browser sign-in.")
      section("Auth")
      console.log(warn("Browser sign-in is still pending."))
      console.log("Finish the browser step, then run: indiecorns status")
      return 0
    }
  }

  if (hasBrowserSession()) {
    const pluginInstall = installPluginBundle()
    const result = {
      authenticated: true,
      method: "browser",
      appUrl: config.browserSession.appUrl,
      authenticatedAt: config.browserSession.authenticatedAt,
      pluginInstall,
      message: "Browser sign-in completed for this machine.",
    }

    if (flags.json) {
      printJson(result)
      return 0
    }

    printBrandHeader("is connected on this machine.")
    section("Auth")
    console.log(ok("Browser sign-in completed for this machine."))
    console.log(`App: ${config.browserSession.appUrl}`)
    if (pluginInstall.installed) {
      console.log(
        ok("Agent plugin and skills installed for local coding agents.")
      )
    }
    return 0
  }

  const result = {
    authenticated: false,
    method: "browser",
    message: "Run `indiecorns login` to open Indiecorns in your browser.",
  }

  if (flags.json) {
    printJson(result)
    return 0
  }

  printBrandHeader("is ready to pair this terminal.")
  section("Auth")
  console.log(warn("No local CLI session is connected yet."))
  console.log("Run: indiecorns login")
  console.log(
    dim(
      "I will open the browser, wait for sign-in, and wire up the agent plugin."
    )
  )
  return 0
}

const findAction = (input) => {
  const normalized = String(input ?? "").toLowerCase()
  return ONBOARDING_ACTIONS.find(
    (action) => action.id === normalized || action.aliases?.includes(normalized)
  )
}

const findAgentPlanAction = async (flags, input) => {
  const normalized = String(input ?? "").toLowerCase()
  const plan = await getAgentPlan(flags)
  return plan.actions.find(
    (action) =>
      action.id === normalized ||
      action.aliases?.includes(normalized) ||
      action.platform === normalized
  )
}

const normalizeActionUrl = (action) =>
  action.targetUrl ?? action.url ?? action.href

const toTaskOutput = (action, flags) => {
  const baseAction = findAction(action.id) ?? action
  const mergedAction = {
    ...baseAction,
    ...action,
    kind: action.kind ?? baseAction.kind,
    command: action.command ?? baseAction.command,
    verification: action.verification ?? baseAction.verification,
    aliases: action.aliases ?? baseAction.aliases,
  }

  return {
    id: mergedAction.id,
    kind: mergedAction.kind ?? "open_url",
    title: mergedAction.title,
    description: mergedAction.description,
    credits: mergedAction.credits,
    status: mergedAction.status ?? "pending",
    url: normalizeActionUrl(mergedAction),
    command: getActionCommand(mergedAction, flags),
    completeCommand: getCompleteCommand(mergedAction, flags),
    verification: mergedAction.verification ?? "external_platform",
    reviewUrl: mergedAction.reviewUrl ?? mergedAction.reviewHref,
    aliases: mergedAction.aliases,
    required: Boolean(mergedAction.required),
    requires: mergedAction.requires ?? [],
  }
}

const runTasks = async (flags) => {
  const agentPlan = await getAgentPlan(flags)
  const taskOutputs = agentPlan.actions.map((action) => ({
    ...action,
    command: action.agentCommand ?? action.command,
    url: action.targetUrl ?? action.url,
  }))
  const completedTasks = taskOutputs.filter(
    (action) => action.status === "completed"
  )
  const pendingTasks = taskOutputs.filter(
    (action) => action.status !== "completed"
  )
  const cliInstalled = completedTasks.some(
    (action) => action.id === CLI_INSTALL_ACTION_ID
  )
  const creditsEarned = completedTasks.reduce(
    (total, action) => total + action.credits,
    0
  )
  const creditsAvailable = taskOutputs.reduce(
    (total, action) => total + action.credits,
    0
  )

  if (flags.json) {
    printJson({
      authenticated: Boolean(getCliAuthHeaders()),
      mode: "agent_first",
      automationCommand: getRunCommand(flags),
      readiness: agentPlan.readiness,
      summary: {
        total: taskOutputs.length,
        completed: completedTasks.length,
        pending: pendingTasks.length,
        needsBrowserAssist: agentPlan.onboarding.needsBrowserAssist ?? 0,
        manualRequired: agentPlan.onboarding.manualRequired ?? 0,
        creditsEarned,
        creditsAvailable,
        requiredFirstActionId: CLI_INSTALL_ACTION_ID,
        readyForAutopilot: cliInstalled,
      },
      desktopAutomation: agentPlan.desktopAutomation,
      tasks: taskOutputs,
      pendingCommands: pendingTasks.map((action) => action.command),
      browserAssist: pendingTasks
        .filter((action) => action.browserAssist?.required)
        .map((action) => ({
          actionId: action.id,
          platform: action.platform,
          mode: action.browserAssist.mode,
          targetUrl: action.browserAssist.targetUrl,
          evidenceRequired: action.evidenceRequired,
        })),
      commands: taskOutputs.map((action) => action.command),
    })
    return 0
  }

  const quickStartTasks = QUICK_START_ACTION_IDS.map((actionId) =>
    taskOutputs.find((action) => action.id === actionId)
  ).filter(Boolean)
  const pendingQuickStart = quickStartTasks.filter(
    (action) => action.status !== "completed"
  )
  const completedQuickStart = quickStartTasks.length - pendingQuickStart.length

  printBrandHeader("found your next step.")
  section("Quick start")
  console.log(
    `${completedQuickStart}/${quickStartTasks.length} complete · connect, add your website, join Slack, try the extension`
  )

  if (pendingQuickStart.length > 0) {
    section("Do this next")
    for (const action of pendingQuickStart) {
      if (!cliInstalled && action.id !== CLI_INSTALL_ACTION_ID) {
        continue
      }
      console.log(`${ok(action.command.replace(/^npx /, ""))}`)
      console.log(`  ${action.title}`)
      break
    }
    if (!cliInstalled) {
      console.log("")
      console.log(dim("Sign in once. The CLI will show the next step."))
    }
  } else {
    console.log(ok("Your Indiecorns setup is complete."))
    console.log(dim("Run indiecorns community-next to support one maker."))
  }

  const optionalPendingCount = pendingTasks.filter(
    (action) => !QUICK_START_ACTION_IDS.includes(action.id)
  ).length
  if (optionalPendingCount > 0) {
    console.log("")
    console.log(
      dim(`${optionalPendingCount} optional community actions are available after setup.`)
    )
  }

  console.log("")
  console.log(`Run ${ok("indiecorns tasks --json")} for the full agent plan.`)
  return 0
}

const runFollow = async (flags, target) => {
  const action =
    findAction(target) ?? (await findAgentPlanAction(flags, target))

  if (!action) {
    console.error(fail("Unknown follow task."))
    console.error("Try: indiecorns join slack")
    console.error("Or:  indiecorns profile set peerlist --username <username>")
    return 1
  }

  if (action.kind === "command") {
    console.error(fail("This task is a command, not a follow task."))
    console.error(`Run: ${action.command}`)
    return 1
  }

  if (isProfileAction(action)) {
    console.error(fail("This task saves a profile, not a follow."))
    console.error(
      `Run: ${getActionCommand(action, flags).replace(/^npx /, "")}`
    )
    return 1
  }

  if (flags.json) {
    const result = await saveOnboardingActionToApp({ flags, action })
    printJson({
      id: action.id,
      kind: "open_url",
      title: action.title,
      credits: action.credits,
      url: normalizeActionUrl(action),
      command: getActionCommand(action, flags),
      aliases: action.aliases,
      saved: Boolean(result?.saved),
      status: result?.action?.status ?? "opened",
      verified: false,
      verification: action.verification,
    })
    return 0
  }

  printBrandHeader("is opening this task for you.")
  section(action.title)
  console.log(`Reward: +${action.credits} credits`)
  console.log(dim(normalizeActionUrl(action)))
  const savedAction = await withSpinner(
    "Saving this action to your Indiecorns account...",
    () => saveOnboardingActionToApp({ flags, action }),
    ok("Task state saved.")
  )
  if (savedAction?.saved) {
    console.log(ok("Saved this action to your Indiecorns account."))
  }

  if (flags.open === false || flags["no-open"]) {
    console.log(
      `If the browser does not open, copy this URL: ${normalizeActionUrl(action)}`
    )
    console.log(
      action.id === "discord"
        ? "After joining Slack, run: indiecorns complete slack"
        : "Complete the action, then return to Indiecorns."
    )
    return 0
  }

  if (openUrl(normalizeActionUrl(action))) {
    console.log(ok("Opened your browser."))
    console.log(
      action.id === "discord"
        ? "After joining Slack, run: indiecorns complete slack"
        : "Complete the action, then return to Indiecorns."
    )
    return 0
  }

  console.log(
    warn("I could not open a browser automatically. Copy the URL above.")
  )
  return 0
}

const runAllOnboarding = async (flags) => {
  if (!getCliAuthHeaders()) {
    const output = {
      authenticated: false,
      requiredFirstActionId: CLI_INSTALL_ACTION_ID,
      requiredCommand: `npx indiecorns login --app-url ${getAppUrl(flags)}`,
      pluginInstallCommand: "npx indiecorns plugin install",
      note: "Install and authenticate the CLI first. Login automatically installs the Indiecorns agent plugin for Codex, Claude, Cursor, and other agent hosts.",
    }

    if (flags.json) {
      printJson(output)
      return 1
    }

    printBrandHeader("needs one sign-in before autopilot can run.")
    section("Required First")
    console.log(warn("Install and authenticate the CLI first."))
    console.log(`  ${ok(output.requiredCommand)}`)
    console.log(
      "Login will also install the local Indiecorns agent plugin automatically."
    )
    return 1
  }

  const agentPlan = await getAgentPlan(flags)
  const results = []

  for (const action of agentPlan.actions) {
    if (action.status === "completed") {
      results.push({
        id: action.id,
        title: action.title,
        status: "completed",
        saved: true,
        skipped: true,
        url: action.url,
        verification: action.verification,
      })
      continue
    }

    if (!action.safeToAutoComplete) {
      results.push({
        id: action.id,
        title: action.title,
        status:
          action.agentCapability === "manual_confirmation"
            ? "manual_required"
            : action.browserAssist?.required
              ? "browser_assist_required"
              : "manual_required",
        saved: false,
        skipped: true,
        url: action.targetUrl ?? action.url,
        verification: action.verification,
        agentCapability: action.agentCapability,
        browserAssist: action.browserAssist,
        evidenceRequired: action.evidenceRequired,
        nextCommand: action.agentCommand ?? action.command,
        desktopCommand: action.browserAssist?.required
          ? `npx indiecorns extension open --run-next --app-url ${getAppUrl(flags)}`
          : undefined,
      })

      await trackCliEvent(
        action.browserAssist?.required
          ? "agent_browser_assist_required"
          : "agent_manual_required",
        {
          action_id: action.id,
          platform: action.platform,
          capability: action.agentCapability,
          proof_type: action.evidenceRequired,
        },
        flags
      )
      continue
    }

    const savedAction = await saveOnboardingActionToApp({
      flags,
      action: {
        id: action.id,
        title: action.title,
        credits: action.credits,
        href: action.targetUrl ?? action.url,
        kind: action.kind,
      },
      status: action.kind === "command" ? "completed" : "opened",
      source: "cli_agent",
    })

    if (action.kind !== "command" && !flags["no-open"] && !flags.agent) {
      openUrl(action.targetUrl ?? action.url)
      await sleep(400)
    }

    results.push({
      id: action.id,
      title: action.title,
      status: savedAction?.action?.status ?? "opened",
      saved: Boolean(savedAction?.saved),
      skipped: false,
      url: action.targetUrl ?? action.url,
      verification: action.verification,
      verified: false,
      nextCommand: action.agentCommand ?? action.command,
    })
  }

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    ran: results.length,
    results,
    mode: "agent_first",
    readiness: agentPlan.readiness,
    desktopAutomation: agentPlan.desktopAutomation,
    note: "Agent mode completes only CLI/API-safe actions. Browser-assisted and manual actions require observed proof before completion.",
  }

  if (flags.json) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  printBrandHeader("is walking your onboarding queue.")
  section("Autopilot")
  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
  }

  for (const result of results) {
    const label = result.saved ? ok(result.status) : warn("not saved")
    console.log(`${label} ${result.title}`)
    console.log(`  ${result.url}`)
  }

  console.log("")
  console.log("After the external follows are actually done, run:")
  console.log(`  ${ok(output.completeAllCommand)}`)
  return output.authenticated ? 0 : 1
}

const runComplete = async (flags, target) => {
  const selectedActions =
    target === "all"
      ? ONBOARDING_ACTIONS.filter(
          (action) =>
            !isProfileAction(action) &&
            action.verification !== "extension_session"
        )
      : [findAction(target)].filter(Boolean)

  if (selectedActions.length === 0) {
    console.error(fail("Unknown task to complete."))
    console.error("Try: indiecorns complete slack")
    console.error("Or:  indiecorns profile set peerlist --username <username>")
    console.error("Or:  indiecorns complete all")
    return 1
  }

  if (selectedActions.some((action) => isProfileAction(action))) {
    const action = selectedActions.find((item) => isProfileAction(item))
    console.error(fail("Profile tasks need a saved profile link."))
    console.error(
      `Run: ${getActionCommand(action, flags).replace(/^npx /, "")}`
    )
    return 1
  }

  if (
    selectedActions.some(
      (action) => action.verification === "extension_session"
    )
  ) {
    console.error(fail("The Chrome extension must verify this task itself."))
    console.error("Run: indiecorns extension install")
    console.error("Then open the extension and sign in once.")
    return 1
  }

  const results = []
  for (const action of selectedActions) {
    const savedAction = await saveOnboardingActionToApp({
      flags,
      action,
      status: "completed",
      source: "agent",
    })
    results.push({
      id: action.id,
      title: action.title,
      saved: Boolean(savedAction?.saved),
      status: savedAction?.action?.status ?? "completed",
      verifiedBy: "agent_or_user_confirmation",
    })
  }

  if (flags.json) {
    printJson({
      authenticated: Boolean(getCliAuthHeaders()),
      results,
    })
    return results.every((result) => result.saved) ? 0 : 1
  }

  console.log(color("Indiecorns completed tasks", colors.cyan))
  for (const result of results) {
    console.log(
      `${result.saved ? ok("completed") : warn("not saved")} ${result.title}`
    )
  }
  return results.every((result) => result.saved) ? 0 : 1
}

const runRecord = async (flags, target) => {
  const platform = normalizeCommunityPlatform(
    target ?? flags.platform ?? "peerlist"
  )
  const eventType = normalizeCommunityEventType(
    flags.type ?? flags["event-type"] ?? flags.action ?? "follow"
  )

  if (!COMMUNITY_ACTION_PLATFORMS.includes(platform)) {
    console.error(fail("Unknown external action to record."))
    console.error("Try: indiecorns record peerlist --target <username>")
    console.error("Or:  indiecorns record x --type like --target-url <url>")
    console.error(
      "Or:  indiecorns record producthunt --type upvote --target-url <url>"
    )
    return 1
  }

  if (!COMMUNITY_ACTION_EVENT_TYPES.includes(eventType)) {
    console.error(fail("Unknown external event type."))
    console.error(
      "Try: --type follow, --type like, --type reshare, --type upvote, or --type comment"
    )
    return 1
  }

  const savedEvent = await saveExternalActionEventToApp({
    flags,
    actionId: getCommunityActionId(platform, eventType),
    platform,
    eventType,
    status: eventType === "follow" ? "followed" : "completed",
  })

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    saved: Boolean(savedEvent?.saved),
    event: savedEvent?.event,
    message: savedEvent?.message,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.saved ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  if (!output.saved) {
    console.log(warn(output.message ?? "Event was not saved."))
    return 1
  }

  const targetLabel =
    output.event?.target_username ??
    output.event?.target_display_name ??
    output.event?.target_profile_url
  console.log(
    ok(
      `Recorded ${output.event?.actor_username ?? "user"} ${eventType}s ${targetLabel} on ${platform}.`
    )
  )
  return 0
}

const runEvents = async (flags) => {
  const events = await getExternalActionEventsFromApp(flags)
  const limitedEvents = flags.limit
    ? (events?.events ?? []).slice(0, Number.parseInt(flags.limit, 10) || 50)
    : (events?.events ?? [])
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    filters: {
      platform: normalizeCommunityPlatform(flags.platform),
      eventType: normalizeCommunityEventType(
        flags.type ?? flags["event-type"] ?? flags.actionType ?? "all"
      ),
      status: flags.status ?? null,
      limit: flags.limit ? Number.parseInt(flags.limit, 10) || null : null,
    },
    summary: summarizeExternalActionEvents(limitedEvents),
    reporting: getCommunityReportingInfo(flags),
    events: limitedEvents,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  console.log(color("Indiecorns external action events", colors.cyan))
  console.log(
    dim(
      `${output.summary.total} events, ${output.summary.byActionGroup.follow} follows, ${output.summary.byActionGroup.engagement} engagements`
    )
  )
  for (const event of output.events) {
    const actor = event.actor_username ?? "user"
    const target =
      event.target_username ??
      event.target_display_name ??
      event.target_profile_url
    const targetType =
      event.metadata?.targetType ??
      (event.event_type === "follow" ? "profile_follow" : "profile_engagement")
    console.log(
      `${ok(event.status)} ${actor} ${event.event_type}s ${target} on ${event.platform} ${dim(targetType)}`
    )
  }
  return 0
}

const runProfiles = async (flags) => {
  const platform = flags.platform ?? "all"
  const result = await getExternalProfilesFromApp({ ...flags, platform })
  const localProfiles = readLocalExternalProfiles(platform)
  const profileMap = new Map(
    localProfiles.map((profile) => [profile.platform, profile])
  )
  for (const profile of result?.profiles ?? []) {
    profileMap.set(profile.platform, { ...profile, local: false })
  }
  const profiles = Array.from(profileMap.values())
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    appProfilesLoaded: Boolean(result),
    platform: result?.platform ?? platform,
    profiles,
    localProfiles,
    suggestedFollows: result?.suggestedFollows ?? [],
  }

  if (flags.json) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  const platformLabel = output.platform === "all" ? "external" : output.platform
  console.log(color(`Indiecorns ${platformLabel} profiles`, colors.cyan))
  if (output.profiles.length === 0) {
    console.log(
      warn(`No ${platformLabel} profile is known for your account yet.`)
    )
    console.log("Run: indiecorns profile set peerlist --username <username>")
  } else {
    for (const profile of output.profiles) {
      const sourceLabel = profile.local ? dim(" local") : ""
      console.log(
        `${ok(profile.platform)} @${profile.username} ${profile.profileUrl}${sourceLabel}`
      )
    }
  }

  if (output.suggestedFollows.length > 0) {
    console.log("")
    console.log(color("Indiecorns users to follow", colors.cyan))
    for (const profile of output.suggestedFollows) {
      console.log(
        `${profile.platform} @${profile.username} ${profile.profileUrl}`
      )
    }
  }

  return 0
}

const sanitizeSetupAssistantOutput = (assistantOutput, flags) => {
  const actions = []
  const blocked = Array.isArray(assistantOutput?.blocked)
    ? [...assistantOutput.blocked]
    : []

  for (const action of assistantOutput?.actions ?? []) {
    if (action?.kind !== "profile_save") continue
    const normalized = normalizeSetupAssistantProfileInput({
      platform: action.platform,
      value: action.profileUrl ?? action.username,
      flags,
    })

    if (!normalized.ok) {
      blocked.push({
        input: action.profileUrl ?? action.username ?? null,
        reason: normalized.reason,
        message: normalized.message,
      })
      continue
    }

    actions.push({
      kind: "profile_save",
      platform: normalized.platform,
      username: normalized.username,
      profileUrl: normalized.profileUrl,
      command: normalized.command,
      reason: action.reason ?? normalized.message,
    })
  }

  return {
    message:
      assistantOutput?.message ??
      (actions.length
        ? "Profile setup commands are ready."
        : "No safe profile setup command was found."),
    actions,
    blocked,
  }
}

const buildSetupAssistant = async (flags) => {
  const [{ Agent, run, setTracingDisabled, tool }, { z }] = await Promise.all([
    import("@openai/agents"),
    import("zod"),
  ])
  setTracingDisabled(!flags.trace && !flags.tracing)

  const setupAssistantOutputSchema = z.object({
    message: z.string(),
    actions: z
      .array(
        z.object({
          kind: z.enum(["profile_save"]),
          platform: z.enum(SETUP_ASSISTANT_PROFILE_PLATFORMS),
          username: z.string().nullable(),
          profileUrl: z.string().nullable(),
          command: z.string(),
          reason: z.string(),
        })
      )
      .max(8),
    blocked: z
      .array(
        z.object({
          input: z.string().nullable(),
          reason: z.string(),
          message: z.string(),
        })
      )
      .max(8),
  })

  const normalizeProfileTool = tool({
    name: "normalize_profile_input",
    description:
      "Normalize one Indiecorns profile value into a safe profile-save command. Call this for every user-provided handle or URL before returning it.",
    parameters: z.object({
      platform: z
        .enum(SETUP_ASSISTANT_PROFILE_PLATFORMS)
        .optional()
        .describe("Platform if the user named one."),
      value: z.string().describe("The raw handle, domain, or profile URL."),
    }),
    execute: async ({ platform, value }) =>
      normalizeSetupAssistantProfileInput({ platform, value, flags }),
  })

  return {
    agent: new Agent({
      name: "Indiecorns setup assistant",
      instructions: [
        "You help a user finish Indiecorns setup from messy natural-language input.",
        "Only return profile_save actions for Peerlist, X, LinkedIn, GitHub, Substack, or website profile setup.",
        "Always call normalize_profile_input for each handle, domain, or URL before returning it.",
        "Never claim a follow, upvote, join, post, or browser action was completed.",
        "If the user provides an avatar/image URL, block it and ask for the real website URL.",
        "Keep messages short. Prefer exact CLI commands over explanation.",
      ].join("\n"),
      tools: [normalizeProfileTool],
      outputType: setupAssistantOutputSchema,
    }),
    run,
  }
}

const runSetupAssistant = async (flags, promptParts) => {
  const request = promptParts.join(" ").trim()
  const agentPlan = await getAgentPlan({
    ...flags,
    source: "cli_setup_assistant",
  })
  const profileActions = agentPlan.actions
    .filter((action) => action.verification === "profile_link")
    .map((action) => ({
      id: action.id,
      title: action.title,
      status: action.status,
      platform: action.platform,
      command: action.agentCommand,
    }))

  if (!ensureOpenAiApiKey()) {
    const output = {
      ok: false,
      applied: false,
      message:
        "OPENAI_API_KEY is required for the setup assistant. Deterministic setup still works with: npx indiecorns tasks --agent",
      actions: [],
      blocked: [],
      profileActions,
    }
    if (flags.json || flags.agent) printJson(output)
    else console.log(warn(output.message))
    return 1
  }

  const { agent, run } = await buildSetupAssistant(flags)
  let result
  try {
    result = await run(
      agent,
      [
        request
          ? `User request: ${request}`
          : "User did not provide details. Suggest the next missing profile setup command from the current plan.",
        `App URL: ${getAppUrl(flags)}`,
        `Authenticated CLI: ${Boolean(getCliAuthHeaders())}`,
        `Current profile setup actions: ${JSON.stringify(profileActions)}`,
        "Return only safe profile setup actions that can be represented by npx indiecorns profile set.",
      ].join("\n"),
      { maxTurns: 6 }
    )
  } catch (error) {
    const output = {
      ok: false,
      applied: false,
      message:
        error instanceof Error
          ? `Setup assistant failed: ${error.message}`
          : "Setup assistant failed.",
      actions: [],
      blocked: [],
      profileActions,
    }
    if (flags.json || flags.agent) printJson(output)
    else console.log(warn(output.message))
    return 1
  }

  const planned = sanitizeSetupAssistantOutput(result.finalOutput, flags)
  const applied = []

  if (flags.apply) {
    for (const action of planned.actions) {
      const saved = await saveExternalProfileToApp({
        flags: {
          ...flags,
          username: action.username,
          "profile-url": action.profileUrl,
          source: "cli_setup_assistant",
        },
        platform: action.platform,
      })
      applied.push({
        platform: action.platform,
        saved: Boolean(saved?.saved),
        profile: saved?.profile ?? null,
        message: saved?.message ?? null,
      })
    }
  }

  const output = {
    ok: true,
    applied: Boolean(flags.apply),
    message: planned.message,
    actions: planned.actions,
    blocked: planned.blocked,
    results: applied,
    profileActions,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return flags.apply ? (applied.every((item) => item.saved) ? 0 : 1) : 0
  }

  console.log(color("Indiecorns setup assistant", colors.cyan))
  if (planned.message) console.log(planned.message)
  for (const action of planned.actions) {
    console.log(`  ${ok(action.command)}`)
  }
  for (const item of planned.blocked) {
    console.log(`  ${warn(item.message)}`)
  }
  if (flags.apply) {
    for (const item of applied) {
      console.log(
        `  ${
          item.saved
            ? ok(`Saved ${item.platform}.`)
            : warn(item.message ?? `Could not save ${item.platform}.`)
        }`
      )
    }
  } else if (planned.actions.length > 0) {
    console.log("")
    console.log(dim("Run again with --apply to save these profile links."))
  }

  return flags.apply ? (applied.every((item) => item.saved) ? 0 : 1) : 0
}

const ASSISTANT_SUPPORT_KEYWORDS = [
  "community",
  "engage",
  "everyone",
  "find",
  "follow",
  "linkedin",
  "member",
  "members",
  "peerlist",
  "producthunt",
  "profiles",
  "support",
  "targets",
  "upvote",
]

const isCommunitySupportRequest = (promptParts) => {
  const request = promptParts.join(" ").toLowerCase()
  if (!request.trim()) return false
  return ASSISTANT_SUPPORT_KEYWORDS.some((keyword) =>
    request.includes(keyword)
  )
}

const collectCommunityActionTargets = async (
  flags,
  eventTypeInput,
  platformInput
) => {
  const eventType = normalizeCommunityEventType(eventTypeInput)
  const platforms =
    eventType === "follow"
      ? getMemberFollowPlatforms(platformInput ?? flags.platform ?? "all")
      : getCommunityActionPlatforms(platformInput ?? flags.platform ?? "all")
  const targetSourceFilter = normalizeCommunityTargetSource(
    flags["target-source"] ?? flags.targetSource ?? "all"
  )
  const setupCommands = getCommunityActionSetupCommands({
    eventType,
    platforms,
    flags,
    targetSource: targetSourceFilter,
  })

  if (platforms.length === 0) {
    return {
      ok: false,
      message: "Unknown community action platform.",
      hints: [
        "Try: indiecorns follow-members peerlist",
        "Or:  indiecorns engage-members like x",
        "Or:  indiecorns engage-members upvote producthunt",
        "Or:  indiecorns peerlist-launches --agent",
      ],
    }
  }

  if (!COMMUNITY_ACTION_EVENT_TYPES.includes(eventType)) {
    return {
      ok: false,
      message: "Unknown community action.",
      hints: ["Try: follow, like, reshare, upvote, rate, or comment"],
    }
  }
  if (
    targetSourceFilter !== "all" &&
    !COMMUNITY_TARGET_SOURCES.includes(targetSourceFilter)
  ) {
    return {
      ok: false,
      message: "Unknown community target source.",
      hints: ["Try: profiles, posts, or projects"],
    }
  }

  const limit = Number.parseInt(flags.limit ?? "", 10)
  const maxTargets = Number.isFinite(limit) && limit > 0 ? limit : null
  const targets = []

  for (const platform of platforms) {
    const targetResult = await getCommunityActionTargetsFromApp({
      ...flags,
      platform,
      type: eventType,
      "target-source": targetSourceFilter,
    })

    let apiTargetsAdded = 0
    const targetResultSource = targetResult?.targetSource ?? null
    for (const target of targetResult?.targets ?? []) {
      if (
        targetSourceFilter !== "all" &&
        targetResultSource &&
        targetResultSource !== targetSourceFilter
      ) {
        continue
      }
      const profileUrl = getPlatformProfileUrl({
        platform: target.platform,
        username: target.username,
        profileUrl: target.profileUrl,
      })
      if (!profileUrl) continue
      const actionTarget = {
        ...target,
        ...(eventType === "rate" ? { rating: 5 } : {}),
        profileUrl,
      }
      targets.push({
        ...actionTarget,
        profileUrl,
        eventType,
        targetSource: targetResult?.targetSource ?? null,
        recordCommand: getRecordCommand(
          actionTarget,
          flags,
          eventType
        ),
      })
      apiTargetsAdded += 1
    }

    if (
      apiTargetsAdded > 0 ||
      requiresProjectTarget(eventType) ||
      (targetSourceFilter !== "all" && targetSourceFilter !== "profiles")
    ) {
      continue
    }

    const completedTargetKeys = new Set()
    const events =
      eventType === "follow"
        ? null
        : await getExternalActionEventsFromApp({
            ...flags,
            platform,
            type: eventType,
          })
    for (const event of events?.events ?? []) {
      if (event.event_type !== eventType || event.platform !== platform) {
        continue
      }
      if (event.target_profile_url) {
        completedTargetKeys.add(
          `${platform}:${event.target_profile_url.toLowerCase().replace(/\/$/, "")}`
        )
      }
      if (event.target_username) {
        completedTargetKeys.add(
          `${platform}:@${event.target_username.toLowerCase()}`
        )
      }
    }

    const result = await getExternalProfilesFromApp({ ...flags, platform })
    for (const profile of result?.suggestedFollows ?? []) {
      const profileUrl = getPlatformProfileUrl({
        platform: profile.platform,
        username: profile.username,
        profileUrl: profile.profileUrl,
      })
      if (!profileUrl) continue
      const targetKeys = [
        `${profile.platform}:${profileUrl.toLowerCase().replace(/\/$/, "")}`,
        profile.username
          ? `${profile.platform}:@${profile.username.toLowerCase()}`
          : null,
      ].filter(Boolean)
      if (targetKeys.some((key) => completedTargetKeys.has(key))) {
        continue
      }
      const actionTarget = {
        ...profile,
        targetType:
          eventType === "follow" ? "profile_follow" : "profile_engagement",
        targetSource: "profiles",
        profileUrl,
        eventType,
        ...(eventType === "rate" ? { rating: 5 } : {}),
      }
      targets.push({
        ...actionTarget,
        recordCommand: getRecordCommand(actionTarget, flags, eventType),
      })
    }
  }

  const seen = new Set()
  const uniqueTargets = targets
    .filter((profile) => {
      const key = `${profile.platform}:${profile.profileUrl.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, maxTargets ?? undefined)

  return {
    ok: true,
    authenticated: Boolean(getCliAuthHeaders()),
    eventType,
    platforms,
    targetSource: targetSourceFilter,
    count: uniqueTargets.length,
    targets: uniqueTargets,
    targetSources: summarizeCommunityTargetSources(uniqueTargets),
    setupCommands,
    afterProofCommands: uniqueTargets
      .map((target) => target.recordCommand)
      .filter(Boolean),
    reporting: getCommunityReportingInfo(flags),
    reminder:
      "Open targets and record each action only after it is visible on the external platform.",
  }
}

const runCommunityActionTargets = async (
  flags,
  eventTypeInput,
  platformInput
) => {
  const output = await collectCommunityActionTargets(
    flags,
    eventTypeInput,
    platformInput
  )

  if (!output.ok) {
    console.error(fail(output.message))
    for (const hint of output.hints) {
      console.error(hint)
    }
    return 1
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  if (output.targets.length === 0) {
    console.log(warn("No Indiecorns member targets are available."))
    for (const command of output.setupCommands ?? []) {
      console.log(dim(`Setup: ${command}`))
    }
    return 0
  }

  console.log(
    color(`Indiecorns member targets to ${output.eventType}`, colors.cyan)
  )
  for (const profile of output.targets) {
    const label =
      profile.username ?? profile.displayName ?? profile.targetType ?? "target"
    console.log(`${ok(profile.platform)} ${label} ${profile.profileUrl}`)
    console.log(`  after ${output.eventType}: ${dim(profile.recordCommand)}`)
    if (!flags["no-open"]) {
      openUrl(profile.profileUrl)
    }
  }

  if (!flags["no-open"]) {
    console.log("")
    console.log(
      `Record each ${output.eventType} only after it is visible on the platform.`
    )
  }

  return 0
}

const COMMUNITY_PLAN_ACTIONS = [
  { eventType: "follow", platform: "all" },
  { eventType: "like", platform: "x" },
  { eventType: "reshare", platform: "x" },
  { eventType: "like", platform: "linkedin" },
  { eventType: "reshare", platform: "linkedin" },
  { eventType: "comment", platform: "linkedin" },
  { eventType: "comment", platform: "x" },
  { eventType: "upvote", platform: "peerlist" },
  { eventType: "rate", platform: "peerlist" },
  { eventType: "upvote", platform: "producthunt" },
]

const getCommunitySupportSnapshot = async (flags, options = {}) => {
  const limit = Number.parseInt(options.limit ?? flags.limit ?? "", 10)
  const perActionLimit = Number.isFinite(limit) && limit > 0 ? limit : 3
  const platformFilter = normalizeCommunityPlatform(
    options.platform ?? flags.platform ?? "all"
  )
  const eventTypeFilter = normalizeCommunityEventType(
    options.eventType ?? flags.type ?? flags.action ?? "all"
  )
  const targetSourceFilter = normalizeCommunityTargetSource(
    options.targetSource ??
      flags["target-source"] ??
      flags.targetSource ??
      "all"
  )
  const actions = []

  for (const item of COMMUNITY_PLAN_ACTIONS) {
    if (eventTypeFilter !== "all" && item.eventType !== eventTypeFilter) {
      continue
    }
    if (
      platformFilter !== "all" &&
      item.platform !== "all" &&
      item.platform !== platformFilter
    ) {
      continue
    }

    const actionPlatform =
      item.platform === "all" && platformFilter !== "all"
        ? platformFilter
        : item.platform
    const output = await collectCommunityActionTargets(
      {
        ...flags,
        limit: String(perActionLimit),
        "no-open": true,
        "target-source": targetSourceFilter,
      },
      item.eventType,
      actionPlatform
    )

    actions.push(
      output.ok
        ? {
            eventType: output.eventType,
            platforms: output.platforms,
            count: output.count,
            targetSource: output.targetSource,
            targets: output.targets,
            targetSources: output.targetSources,
            setupCommands: output.setupCommands,
          }
        : {
            eventType: item.eventType,
            platform: actionPlatform,
            count: 0,
            targets: [],
            targetSources: {},
            setupCommands: getCommunityActionSetupCommands({
              eventType: item.eventType,
              platforms: [actionPlatform],
              flags,
              targetSource: targetSourceFilter,
            }),
            error: output.message,
          }
    )
  }

  const profilePlatforms =
    platformFilter === "all"
      ? COMMUNITY_ACTION_PLATFORMS
      : getCommunityActionPlatforms(platformFilter)
  const profileInventory = []
  for (const platform of profilePlatforms) {
    const result = await getExternalProfilesFromApp({ ...flags, platform })
    profileInventory.push({
      platform,
      profiles: result?.profiles ?? [],
      suggestedFollows: result?.suggestedFollows ?? [],
    })
  }

  const gaps = []
  for (const action of actions) {
    if (action.count > 0) continue
    for (const command of action.setupCommands ?? []) {
      gaps.push({
        eventType: action.eventType,
        platform: action.platform ?? action.platforms?.join(", ") ?? "all",
        command,
      })
    }
  }

  return {
    authenticated: Boolean(getCliAuthHeaders()),
    readOnly: true,
    platform: platformFilter,
    eventType: eventTypeFilter,
    targetSource: targetSourceFilter,
    count: actions.reduce((total, action) => total + action.count, 0),
    actions,
    profileInventory,
    gaps,
    reminder:
      "Open targets and record each action only after it is visible on the external platform.",
  }
}

const buildCommunitySupportAssistant = async (flags) => {
  const [{ Agent, run, setTracingDisabled, tool }, { z }] = await Promise.all([
    import("@openai/agents"),
    import("zod"),
  ])
  setTracingDisabled(!flags.trace && !flags.tracing)

  const communitySupportOutputSchema = z.object({
    message: z.string(),
    priorities: z
      .array(
        z.object({
          eventType: z.enum(COMMUNITY_ACTION_EVENT_TYPES),
          platform: z.enum(COMMUNITY_ACTION_PLATFORMS),
          targetLabel: z.string(),
          targetUrl: z.string(),
          recordCommand: z.string(),
          reason: z.string(),
        })
      )
      .max(12),
    gaps: z
      .array(
        z.object({
          platform: z.string(),
          eventType: z.string(),
          command: z.string(),
          reason: z.string(),
        })
      )
      .max(12),
    nextCommands: z.array(z.string()).max(8),
  })

  const getCommunitySupportPlanTool = tool({
    name: "get_community_support_plan",
    description:
      "Return the deterministic Indiecorns community support plan, known profile inventory, setup gaps, target URLs, and record commands.",
    parameters: z.object({
      platform: z
        .enum(["all", ...COMMUNITY_ACTION_PLATFORMS])
        .optional()
        .describe("Optional platform filter."),
      eventType: z
        .enum(["all", ...COMMUNITY_ACTION_EVENT_TYPES])
        .optional()
        .describe("Optional action filter."),
      limit: z.number().int().positive().max(10).optional(),
    }),
    execute: async ({ platform, eventType, limit }) =>
      getCommunitySupportSnapshot(flags, { platform, eventType, limit }),
  })

  return {
    agent: new Agent({
      name: "Indiecorns community support assistant",
      instructions: [
        "You help a user find Indiecorns member profiles and community support targets.",
        "Always call get_community_support_plan before returning a plan.",
        "Use only targets, URLs, and record commands returned by the tool.",
        "Never invent profile URLs or claim an external follow, like, reshare, comment, or upvote was completed.",
        "Prefer Peerlist, X, LinkedIn, and Product Hunt targets already returned by Indiecorns.",
        "Keep the response short and operational.",
      ].join("\n"),
      tools: [getCommunitySupportPlanTool],
      outputType: communitySupportOutputSchema,
    }),
    run,
  }
}

const sanitizeCommunitySupportOutput = (assistantOutput, snapshot, flags) => {
  const targetsByCommand = new Map()
  const allowedNextCommands = new Set()
  for (const action of snapshot.actions ?? []) {
    for (const target of action.targets ?? []) {
      if (!target.recordCommand) continue
      targetsByCommand.set(target.recordCommand, {
        eventType: action.eventType,
        platform: target.platform,
        targetLabel:
          target.displayName ?? target.username ?? target.targetType ?? "target",
        targetUrl: target.profileUrl,
        recordCommand: target.recordCommand,
      })
    }
  }

  const priorities = []
  for (const priority of assistantOutput?.priorities ?? []) {
    const target = targetsByCommand.get(priority?.recordCommand)
    if (!target) continue
    priorities.push({
      ...target,
      reason: priority.reason ?? "Suggested by the support assistant.",
    })
  }

  const fallbackTargets = []
  for (const action of snapshot.actions ?? []) {
    for (const target of action.targets ?? []) {
      fallbackTargets.push({
        eventType: action.eventType,
        platform: target.platform,
        targetLabel:
          target.displayName ?? target.username ?? target.targetType ?? "target",
        targetUrl: target.profileUrl,
        recordCommand: target.recordCommand,
        reason: "Available from the Indiecorns community plan.",
      })
    }
  }

  const setupCommands = new Set(snapshot.gaps.map((gap) => gap.command))
  for (const command of setupCommands) allowedNextCommands.add(command)
  const communityPlanCommand = `npx indiecorns community-plan --agent --app-url ${getAppUrl(flags)}`
  const postListCommand = `npx indiecorns post list all --agent --app-url ${getAppUrl(flags)}`
  const launchListCommand = `npx indiecorns launch list all --agent --app-url ${getAppUrl(flags)}`
  allowedNextCommands.add(communityPlanCommand)
  allowedNextCommands.add(postListCommand)
  allowedNextCommands.add(launchListCommand)
  const gaps = []
  for (const gap of assistantOutput?.gaps ?? []) {
    if (!setupCommands.has(gap?.command)) continue
    gaps.push({
      platform: gap.platform,
      eventType: gap.eventType,
      command: gap.command,
      reason: gap.reason ?? "More saved member data is needed.",
    })
  }

  return {
    message:
      assistantOutput?.message ??
      (snapshot.count > 0
        ? "Community support targets are ready."
        : "No community support targets are available yet."),
    priorities: priorities.length ? priorities : fallbackTargets.slice(0, 12),
    gaps: gaps.length
      ? gaps
      : snapshot.gaps.map((gap) => ({
          ...gap,
          reason: "Add more member posts, launches, or profiles.",
        })),
    afterProofCommands: Array.from(
      new Set(
        (priorities.length ? priorities : fallbackTargets)
          .map((target) => target.recordCommand)
          .filter(Boolean)
      )
    ).slice(0, 12),
    nextCommands: Array.from(
      new Set([
        ...(assistantOutput?.nextCommands ?? []).filter((command) =>
          allowedNextCommands.has(command)
        ),
        communityPlanCommand,
        postListCommand,
        launchListCommand,
      ])
    ).slice(0, 8),
  }
}

const getAfterProofCommandsFromSnapshot = (snapshot, limit = 12) =>
  Array.from(
    new Set(
      (snapshot.actions ?? [])
        .flatMap((action) => action.targets ?? [])
        .map((target) => target.recordCommand)
        .filter(Boolean)
    )
  ).slice(0, limit)

const getCommunityActionTargetLabel = (target) =>
  target?.displayName ?? target?.username ?? target?.targetType ?? "target"

const getCommunityQueueTargetsFromSnapshot = (snapshot, limit = 25) => {
  const maxTargets = Math.max(1, limit)
  const actionQueues = (snapshot.actions ?? [])
    .map((action) => ({
      action,
      targets: (action.targets ?? [])
        .filter((target) => target?.profileUrl)
        .map((target) => ({
          eventType: action.eventType,
          platform: target.platform,
          targetType: target.targetType,
          targetSource: target.targetSource,
          targetLabel: getCommunityActionTargetLabel(target),
          targetUrl: target.profileUrl,
          username: target.username,
          displayName: target.displayName,
          recordCommand: target.recordCommand,
        })),
    }))
    .filter((queue) => queue.targets.length > 0)

  const targets = []
  let offset = 0
  while (targets.length < maxTargets) {
    let addedInRound = false
    for (const queue of actionQueues) {
      const target = queue.targets[offset]
      if (!target) continue
      targets.push(target)
      addedInRound = true
      if (targets.length >= maxTargets) break
    }
    if (!addedInRound) break
    offset += 1
  }

  return targets.map((target, index) => {
    const normalizedUrl = String(target.targetUrl ?? "")
      .toLowerCase()
      .replace(/\/$/, "")
    const queueKey = [
      target.eventType,
      target.platform,
      target.targetSource ?? "unknown",
      target.targetType ?? "unknown",
      normalizedUrl,
    ].join(":")
    return {
      ...target,
      queuePosition: index + 1,
      queueKey,
      recordCommand: `${target.recordCommand} --queue-key ${shellQuote(queueKey)}`,
    }
  })
}

const summarizeCommunityQueueTargets = (targets = []) =>
  targets.reduce(
    (summary, target) => {
      summary.byEventType[target.eventType] =
        (summary.byEventType[target.eventType] ?? 0) + 1
      summary.byPlatform[target.platform] =
        (summary.byPlatform[target.platform] ?? 0) + 1
      const source = target.targetSource ?? "unknown"
      summary.byTargetSource[source] = (summary.byTargetSource[source] ?? 0) + 1
      return summary
    },
    {
      byEventType: {},
      byPlatform: {},
      byTargetSource: {},
    }
  )

const runCommunitySupportAssistant = async (flags, promptParts) => {
  const request = promptParts.join(" ").trim()
  const snapshot = await getCommunitySupportSnapshot(flags)

  if (!ensureOpenAiApiKey()) {
    const output = {
      ok: false,
      message:
        "OPENAI_API_KEY is required for the support assistant. Deterministic support planning still works with: npx indiecorns community-plan --agent",
      supportPlan: snapshot,
      priorities: [],
      gaps: snapshot.gaps,
      afterProofCommands: getAfterProofCommandsFromSnapshot(snapshot),
      nextCommands: [
        `npx indiecorns community-plan --agent --app-url ${getAppUrl(flags)}`,
        `npx indiecorns post list all --agent --app-url ${getAppUrl(flags)}`,
        `npx indiecorns launch list all --agent --app-url ${getAppUrl(flags)}`,
      ],
      reporting: getCommunityReportingInfo(flags),
    }
    if (flags.json || flags.agent) printJson(output)
    else console.log(warn(output.message))
    return 1
  }

  const { agent, run } = await buildCommunitySupportAssistant(flags)
  let result
  try {
    result = await run(
      agent,
      [
        request
          ? `User request: ${request}`
          : "User wants a daily Indiecorns community support plan.",
        `App URL: ${getAppUrl(flags)}`,
        `Authenticated CLI: ${Boolean(getCliAuthHeaders())}`,
        `Current deterministic snapshot: ${summarizeForAgent(snapshot)}`,
        "Return priorities only from get_community_support_plan tool results.",
      ].join("\n"),
      { maxTurns: 5 }
    )
  } catch (error) {
    const output = {
      ok: false,
      message:
        error instanceof Error
          ? `Support assistant failed: ${error.message}`
          : "Support assistant failed.",
      supportPlan: snapshot,
      priorities: [],
      gaps: snapshot.gaps,
      afterProofCommands: getAfterProofCommandsFromSnapshot(snapshot),
      nextCommands: [
        `npx indiecorns community-plan --agent --app-url ${getAppUrl(flags)}`,
        `npx indiecorns post list all --agent --app-url ${getAppUrl(flags)}`,
        `npx indiecorns launch list all --agent --app-url ${getAppUrl(flags)}`,
      ],
      reporting: getCommunityReportingInfo(flags),
    }
    if (flags.json || flags.agent) printJson(output)
    else console.log(warn(output.message))
    return 1
  }

  const planned = sanitizeCommunitySupportOutput(
    result.finalOutput,
    snapshot,
    flags
  )
  const output = {
    ok: true,
    authenticated: snapshot.authenticated,
    readOnly: true,
    message: planned.message,
    priorities: planned.priorities,
    gaps: planned.gaps,
    afterProofCommands: planned.afterProofCommands,
    nextCommands: planned.nextCommands,
    reporting: getCommunityReportingInfo(flags),
    supportPlan: snapshot,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return snapshot.authenticated ? 0 : 1
  }

  if (!snapshot.authenticated) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  console.log(color("Indiecorns support assistant", colors.cyan))
  if (planned.message) console.log(planned.message)
  for (const item of planned.priorities) {
    console.log(`  ${ok(item.eventType)} ${item.targetLabel}: ${item.targetUrl}`)
    console.log(`    record after proof: ${dim(item.recordCommand)}`)
  }
  if (planned.gaps.length > 0) {
    console.log("")
    console.log(color("Needs more data", colors.cyan))
    for (const gap of planned.gaps) {
      console.log(`  ${dim(gap.command)}`)
    }
  }
  console.log("")
  console.log(dim(snapshot.reminder))
  return 0
}

const runCommunityQueue = async (flags, args = [], options = {}) => {
  const shouldOpenTargets = Boolean(options.openTargets)
  const limit = Number.parseInt(flags.limit ?? "", 10)
  const targetLimit = Number.isFinite(limit) && limit > 0 ? limit : 25
  const afterKey = flags["after-key"] ?? flags.after ?? flags.cursor ?? null
  const snapshotLimit = afterKey ? Math.max(targetLimit * 5, 100) : targetLimit
  const platform = normalizeCommunityPlatform(
    args[0] ?? flags.platform ?? "all"
  )
  const eventType = normalizeCommunityEventType(
    flags.type ?? flags.action ?? "all"
  )
  const targetSource = normalizeCommunityTargetSource(
    flags["target-source"] ?? flags.targetSource ?? "all"
  )
  const snapshot = await getCommunitySupportSnapshot(flags, {
    platform,
    eventType,
    targetSource,
    limit: snapshotLimit,
  })
  const fullQueue = getCommunityQueueTargetsFromSnapshot(snapshot, snapshotLimit)
  const afterIndex = afterKey
    ? fullQueue.findIndex((target) => target.queueKey === afterKey)
    : -1
  const skippedCount = afterIndex >= 0 ? afterIndex + 1 : 0
  const targets = fullQueue.slice(skippedCount, skippedCount + targetLimit)
  const nextCursor = targets.at(-1)?.queueKey ?? null
  const output = {
    authenticated: snapshot.authenticated,
    readOnly: true,
    platform: snapshot.platform,
    eventType: snapshot.eventType,
    targetSource: snapshot.targetSource,
    count: targets.length,
    availableCount: fullQueue.length,
    skippedCount,
    afterKey,
    afterKeyFound: afterKey ? afterIndex >= 0 : null,
    nextCursor,
    targets,
    summary: summarizeCommunityQueueTargets(targets),
    actions: (snapshot.actions ?? []).map((action) => ({
      eventType: action.eventType,
      platforms: action.platforms ?? [action.platform].filter(Boolean),
      targetCount: action.count,
      targetSources:
        action.targetSources ?? summarizeCommunityTargetSources(action.targets),
    })),
    gaps: snapshot.gaps,
    setupCommands: Array.from(
      new Set(snapshot.gaps.map((gap) => gap.command))
    ),
    afterProofCommands: targets
      .map((target) => target.recordCommand)
      .filter(Boolean),
    nextCommands: [
      `npx indiecorns community-next --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns community-status --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns events --agent --app-url ${getAppUrl(flags)}`,
    ],
    reporting: getCommunityReportingInfo(flags),
    opensTargets: shouldOpenTargets && !flags["no-open"],
    reminder: snapshot.reminder,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  if (targets.length === 0) {
    console.log(warn("No community action targets are available."))
    for (const command of output.setupCommands) {
      console.log(dim(`Setup: ${command}`))
    }
    return 0
  }

  console.log(color("Indiecorns community action queue", colors.cyan))
  for (const target of targets) {
    console.log(`${ok(target.eventType)} ${target.platform} ${target.targetLabel}`)
    console.log(`  ${target.targetUrl}`)
    console.log(`  record after proof: ${dim(target.recordCommand)}`)
    if (shouldOpenTargets && !flags["no-open"]) {
      openUrl(target.targetUrl)
    }
  }
  console.log("")
  console.log(dim(output.reminder))
  return 0
}

const runCommunityNext = async (flags, args = []) => {
  const limit = Number.parseInt(flags.limit ?? "", 10)
  const targetLimit = Number.isFinite(limit) && limit > 0 ? limit : 1
  const platform = normalizeCommunityPlatform(
    args[0] ?? flags.platform ?? "all"
  )
  const eventType = normalizeCommunityEventType(
    flags.type ?? flags.action ?? "all"
  )
  const targetSource = normalizeCommunityTargetSource(
    flags["target-source"] ?? flags.targetSource ?? "all"
  )
  const snapshot = await getCommunitySupportSnapshot(flags, {
    platform,
    eventType,
    targetSource,
    limit: targetLimit,
  })
  const targets = getCommunityQueueTargetsFromSnapshot(snapshot, targetLimit)
  const output = {
    authenticated: snapshot.authenticated,
    readOnly: true,
    platform: snapshot.platform,
    eventType: snapshot.eventType,
    targetSource: snapshot.targetSource,
    count: targets.length,
    target: targets[0] ?? null,
    targets,
    gaps: snapshot.gaps,
    setupCommands: Array.from(
      new Set(snapshot.gaps.map((gap) => gap.command))
    ),
    afterProofCommands: targets
      .map((target) => target.recordCommand)
      .filter(Boolean),
    nextCommands: [
      `npx indiecorns community-next --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns community-status --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns events --agent --app-url ${getAppUrl(flags)}`,
    ],
    reporting: getCommunityReportingInfo(flags),
    reminder: snapshot.reminder,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  if (targets.length === 0) {
    console.log(warn("No community action target is available."))
    for (const command of output.setupCommands) {
      console.log(dim(`Setup: ${command}`))
    }
    return 0
  }

  console.log(color("Next Indiecorns community action", colors.cyan))
  for (const target of targets) {
    console.log(`${ok(target.eventType)} ${target.platform} ${target.targetLabel}`)
    console.log(`  ${target.targetUrl}`)
    console.log(`  record after proof: ${dim(target.recordCommand)}`)
    if (!flags["no-open"]) {
      openUrl(target.targetUrl)
    }
  }
  console.log("")
  console.log(dim(output.reminder))
  return 0
}

const isMonday = (date = new Date()) => date.getDay() === 1

const getNextMondayIsoDate = (date = new Date()) => {
  const next = new Date(date)
  const day = next.getDay()
  const daysUntilMonday = ((8 - day) % 7) || 7
  next.setDate(next.getDate() + daysUntilMonday)
  return next.toISOString().slice(0, 10)
}

const runPeerlistLaunches = async (flags) => {
  const force = Boolean(flags.force || flags["run-now"])
  const today = new Date()
  const due = isMonday(today) || force
  const limit = Number.parseInt(flags.limit ?? "", 10)
  const targetLimit = Number.isFinite(limit) && limit > 0 ? limit : null

  if (!due) {
    const output = {
      authenticated: Boolean(getCliAuthHeaders()),
      readOnly: true,
      due: false,
      platform: "peerlist",
      targetSource: "projects",
      count: 0,
      targets: [],
      afterProofCommands: [],
      nextCommands: [
        `npx indiecorns peerlist-launches --agent --app-url ${getAppUrl(flags)}`,
      ],
      nextRunDate: getNextMondayIsoDate(today),
      reminder:
        "Peerlist launch checks run on Mondays. Use --force only for manual catch-up.",
    }

    if (flags.json || flags.agent) {
      printJson(output)
      return output.authenticated ? 0 : 1
    }

    if (!output.authenticated) {
      console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
      return 1
    }

    console.log(warn(`Peerlist launch check is not due until ${output.nextRunDate}.`))
    console.log(dim(output.reminder))
    return 0
  }

  const actionResults = await Promise.all([
    collectCommunityActionTargets(
      {
        ...flags,
        ...(targetLimit ? { limit: String(targetLimit) } : {}),
        "no-open": true,
        "target-source": "projects",
      },
      "upvote",
      "peerlist"
    ),
    collectCommunityActionTargets(
      {
        ...flags,
        ...(targetLimit ? { limit: String(targetLimit) } : {}),
        "no-open": true,
        "target-source": "projects",
      },
      "rate",
      "peerlist"
    ),
  ])

  const errors = actionResults.filter((result) => !result.ok)
  if (errors.length > 0) {
    const output = {
      authenticated: Boolean(getCliAuthHeaders()),
      readOnly: true,
      due: true,
      ok: false,
      message: errors.map((error) => error.message).join(" "),
      targets: [],
      afterProofCommands: [],
    }
    if (flags.json || flags.agent) printJson(output)
    else console.log(warn(output.message))
    return 1
  }

  const actions = actionResults.map((result) => ({
    eventType: result.eventType,
    platforms: result.platforms,
    count: result.count,
    targetSource: result.targetSource,
    targets: result.targets,
    targetSources: result.targetSources,
    setupCommands: result.setupCommands,
  }))
  const targets = getCommunityQueueTargetsFromSnapshot(
    { actions },
    targetLimit ? targetLimit * 2 : Number.POSITIVE_INFINITY
  )
  const uniqueLaunches = Array.from(
    new Map(
      targets.map((target) => [
        String(target.targetUrl).toLowerCase().replace(/\/$/, ""),
        {
          targetLabel: target.targetLabel,
          targetUrl: target.targetUrl,
          username: target.username,
          displayName: target.displayName,
        },
      ])
    ).values()
  )
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    readOnly: true,
    due: true,
    platform: "peerlist",
    targetSource: "projects",
    rating: 5,
    count: targets.length,
    launchCount: uniqueLaunches.length,
    targets,
    launches: uniqueLaunches,
    summary: summarizeCommunityQueueTargets(targets),
    actions: actions.map((action) => ({
      eventType: action.eventType,
      platforms: action.platforms,
      targetCount: action.count,
      targetSources:
        action.targetSources ?? summarizeCommunityTargetSources(action.targets),
    })),
    setupCommands: Array.from(
      new Set(actions.flatMap((action) => action.setupCommands ?? []))
    ),
    afterProofCommands: targets
      .map((target) => target.recordCommand)
      .filter(Boolean),
    nextCommands: [
      `npx indiecorns peerlist-launches --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns community-queue peerlist --type upvote --target-source projects --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns community-queue peerlist --type rate --target-source projects --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns events --agent --platform peerlist --app-url ${getAppUrl(flags)}`,
    ],
    reporting: getCommunityReportingInfo(flags),
    reminder:
      "Open each Peerlist launch, upvote it, submit a genuine 5-star rating, then run each record command only after both actions are visibly complete.",
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  if (uniqueLaunches.length === 0) {
    console.log(warn("No new Peerlist launches are available."))
    for (const command of output.setupCommands) {
      console.log(dim(`Setup: ${command}`))
    }
    return 0
  }

  console.log(color("Monday Peerlist launch support", colors.cyan))
  for (const launch of uniqueLaunches) {
    console.log(`${ok("launch")} ${launch.targetLabel}`)
    console.log(`  ${launch.targetUrl}`)
    if (!flags["no-open"]) {
      openUrl(launch.targetUrl)
    }
  }
  console.log("")
  for (const target of targets) {
    console.log(
      `  after ${target.eventType}${target.eventType === "rate" ? " 5-star" : ""}: ${dim(target.recordCommand)}`
    )
  }
  console.log("")
  console.log(dim(output.reminder))
  return 0
}

const runCommunityActionPlan = async (flags, args = []) => {
  const limit = Number.parseInt(flags.limit ?? "", 10)
  const perActionLimit = Number.isFinite(limit) && limit > 0 ? limit : 3
  const platformFilter = normalizeCommunityPlatform(
    args[0] ?? flags.platform ?? "all"
  )
  const actionFilter = normalizeCommunityEventType(
    flags.type ?? flags.action ?? "all"
  )
  const targetSourceFilter = normalizeCommunityTargetSource(
    flags["target-source"] ?? flags.targetSource ?? "all"
  )
  const actions = []

  for (const item of COMMUNITY_PLAN_ACTIONS) {
    if (actionFilter !== "all" && item.eventType !== actionFilter) {
      continue
    }
    if (
      platformFilter !== "all" &&
      item.platform !== "all" &&
      item.platform !== platformFilter
    ) {
      continue
    }

    const actionPlatform =
      item.platform === "all" && platformFilter !== "all"
        ? platformFilter
        : item.platform
    const output = await collectCommunityActionTargets(
      {
        ...flags,
        limit: String(perActionLimit),
        "no-open": true,
        "target-source": targetSourceFilter,
      },
      item.eventType,
      actionPlatform
    )
    if (!output.ok) {
      actions.push({
        eventType: item.eventType,
        platform: actionPlatform,
        count: 0,
        targets: [],
        targetSources: {},
        setupCommands: getCommunityActionSetupCommands({
          eventType: item.eventType,
          platforms: [actionPlatform],
          flags,
          targetSource: targetSourceFilter,
        }),
        error: output.message,
      })
      continue
    }

    actions.push({
      eventType: output.eventType,
      platforms: output.platforms,
      count: output.count,
      targetSource: output.targetSource,
      targets: output.targets,
      targetSources: output.targetSources,
      setupCommands: output.setupCommands,
    })
  }

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    readOnly: true,
    platform: platformFilter,
    eventType: actionFilter,
    targetSource: targetSourceFilter,
    count: actions.reduce((total, action) => total + action.count, 0),
    actions,
    setupCommands: Array.from(
      new Set(actions.flatMap((action) => action.setupCommands ?? []))
    ),
    afterProofCommands: getAfterProofCommandsFromSnapshot({ actions }),
    nextCommands: [
      `npx indiecorns events --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns post list all --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns launch list all --agent --app-url ${getAppUrl(flags)}`,
    ],
    reporting: getCommunityReportingInfo(flags),
    reminder:
      "Open targets and record each action only after it is visible on the external platform.",
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  console.log(color("Indiecorns community action plan", colors.cyan))
  for (const action of actions) {
    console.log("")
    console.log(
      `${ok(action.eventType)} ${action.platforms?.join(", ") ?? action.platform} (${action.count})`
    )
    for (const target of action.targets.slice(0, perActionLimit)) {
      const label =
        target.displayName ?? target.username ?? target.targetType ?? "target"
      console.log(`  ${label}: ${target.profileUrl}`)
      console.log(`    after ${action.eventType}: ${dim(target.recordCommand)}`)
    }
    if (action.count === 0) {
      for (const command of action.setupCommands ?? []) {
        console.log(`  ${dim(`setup: ${command}`)}`)
      }
    }
  }
  console.log("")
  console.log(dim(output.reminder))
  return 0
}

const runCommunityStatus = async (flags) => {
  const snapshot = await getCommunitySupportSnapshot(flags)
  const [eventsResult, postsResult, launchesResult] = await Promise.all([
    getExternalActionEventsFromApp({
      ...flags,
      limit: flags["event-limit"] ?? "100",
    }),
    getCommunityPostsFromApp({ flags, platform: "all" }),
    getCommunityLaunchesFromApp({ flags, platform: "all" }),
  ])
  const events = eventsResult?.events ?? []
  const posts = postsResult?.posts ?? []
  const launches = launchesResult?.launches ?? []
  const actions = snapshot.actions ?? []
  const actionSummary = actions.map((action) => ({
    eventType: action.eventType,
    platforms: action.platforms ?? [action.platform].filter(Boolean),
    targetCount: action.count,
    setupCommandCount: action.setupCommands?.length ?? 0,
    targetSources:
      action.targetSources ?? summarizeCommunityTargetSources(action.targets),
  }))
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    readOnly: true,
    summary: {
      pendingTargetCount: snapshot.count,
      recordedEventCount: events.length,
      savedPostCount: posts.length,
      savedLaunchCount: launches.length,
      setupGapCount: snapshot.gaps.length,
      afterProofCommandCount: getAfterProofCommandsFromSnapshot(snapshot).length,
    },
    actions: actionSummary,
    recorded: summarizeExternalActionEvents(events),
    savedTargets: {
      posts: posts.map((post) => ({
        platform: post.platform,
        url: post.post_url,
        title: post.title,
        status: post.status,
      })),
      launches: launches.map((launch) => ({
        platform: String(launch.source ?? "").replace(/_launch$/, ""),
        url: launch.launch_url,
        name: launch.name,
        status: launch.status,
      })),
    },
    gaps: snapshot.gaps,
    setupCommands: Array.from(
      new Set(actions.flatMap((action) => action.setupCommands ?? []))
    ),
    afterProofCommands: getAfterProofCommandsFromSnapshot(snapshot),
    nextCommands: [
      `npx indiecorns community-plan --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns events --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns post list all --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns launch list all --agent --app-url ${getAppUrl(flags)}`,
    ],
    reporting: getCommunityReportingInfo(flags),
    reminder: snapshot.reminder,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  console.log(color("Indiecorns community status", colors.cyan))
  console.log(`${ok("pending targets")} ${output.summary.pendingTargetCount}`)
  console.log(`${ok("recorded events")} ${output.summary.recordedEventCount}`)
  console.log(`${ok("saved posts")} ${output.summary.savedPostCount}`)
  console.log(`${ok("saved launches")} ${output.summary.savedLaunchCount}`)
  if (output.gaps.length > 0) {
    console.log("")
    console.log(color("Setup gaps", colors.cyan))
    for (const gap of output.gaps) {
      console.log(`  ${dim(gap.command)}`)
    }
  }
  console.log("")
  console.log(dim(`Dashboard: ${output.reporting.dashboard.activityUrl}`))
  console.log(dim(output.reminder))
  return 0
}

const runFollowMembers = async (flags, platformInput) =>
  runCommunityActionTargets(flags, "follow", platformInput)

const runEngageMembers = async (flags, eventTypeInput, platformInput) =>
  runCommunityActionTargets(flags, eventTypeInput, platformInput)

const fieldsFromExistingProfiles = (profiles = []) => {
  const fields = {}

  for (const profile of profiles) {
    if (!profile?.platform) continue
    const platform = normalizeProfileCachePlatform(profile.platform)
    const username = profile.username ? String(profile.username) : ""
    const profileUrl = profile.profileUrl ? String(profile.profileUrl) : ""

    if (platform === "indiehackers") {
      if (username) fields.username = username
      if (profileUrl) fields.profileUrl = profileUrl
    }
    if (platform === "website" && profileUrl) fields.websiteUrl = profileUrl
    if (platform === "x" && username) fields.twitterHandle = username
    if (platform === "github" && profileUrl) fields.githubUrl = profileUrl
    if (platform === "linkedin" && profileUrl) fields.linkedinUrl = profileUrl
    if (platform === "producthunt" && profileUrl) {
      fields.productHuntUrl = profileUrl
    }
    if (platform === "peerlist" && profileUrl) fields.peerlistUrl = profileUrl
    if (!fields.displayName && profile.displayName) {
      fields.displayName = String(profile.displayName)
    }
  }

  return fields
}

const getExistingProfilesForFill = async (flags) => {
  const localProfiles = readLocalExternalProfiles("all")
  const result = await getExternalProfilesFromApp({ ...flags, platform: "all" })
  const profileMap = new Map(
    localProfiles.map((profile) => [profile.platform, profile])
  )
  for (const profile of result?.profiles ?? []) {
    profileMap.set(profile.platform, { ...profile, local: false })
  }

  return {
    appProfilesLoaded: Boolean(result),
    localProfiles,
    profiles: Array.from(profileMap.values()),
  }
}

const applyIndieHackersFillOverrides = (plan, flags) => {
  const fields = {
    username: "danielsinewe",
    displayName: "Daniel Sinewe",
    bio:
      "Building Indiecorns, a global indie hacker collective for shipping and supporting projects together.",
    websiteUrl: "https://indiecorns.com",
    ...(plan?.fields ?? {}),
  }

  if (flags.username) fields.username = String(flags.username)
  if (flags["display-name"] || flags.name) {
    fields.displayName = String(flags["display-name"] ?? flags.name)
  }
  if (flags.bio) fields.bio = String(flags.bio)
  if (flags["website-url"] || flags.url) {
    fields.websiteUrl = String(flags["website-url"] ?? flags.url)
  }
  if (flags["twitter-handle"] || flags.x) {
    fields.twitterHandle = String(flags["twitter-handle"] ?? flags.x).replace(
      /^@/,
      ""
    )
  }

  return {
    ...(plan ?? {}),
    fields,
  }
}

const runIndieHackers = async (flags, args = []) => {
  const subcommand = args[0] ?? "fill-profile"
  if (
    subcommand !== "fill-profile" &&
    subcommand !== "fill" &&
    subcommand !== "autofill"
  ) {
    console.error(fail(`Unknown Indie Hackers command: ${subcommand}`))
    console.error("Try: indiecorns indiehackers fill-profile --agent")
    return 1
  }

  const appPlan = await getIndieHackersAutofillPlanFromApp(flags)
  const existingProfiles = await getExistingProfilesForFill(flags)
  const existingProfileFields = fieldsFromExistingProfiles(
    existingProfiles.profiles
  )
  const plan = applyIndieHackersFillOverrides(
    {
      ...(appPlan ?? {}),
      fields: {
        ...existingProfileFields,
        ...(appPlan?.fields ?? {}),
      },
    },
    flags
  )
  const targetUrl =
    flags["target-url"] ??
    plan.targetUrl ??
    "https://www.indiehackers.com/danielsinewe/editing"
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    appPlanLoaded: Boolean(appPlan),
    appProfilesLoaded: existingProfiles.appProfilesLoaded,
    localProfileCount: existingProfiles.localProfiles.length,
    localProfilesUsed: existingProfiles.localProfiles.length > 0,
    readOnly: true,
    targetUrl,
    profileUrl:
      plan.profileUrl ??
      `https://www.indiehackers.com/${plan.fields?.username ?? "danielsinewe"}`,
    fields: plan.fields ?? {},
    browserAutomation: {
      command: `npx indiecorns extension open --app-url ${getAppUrl(flags)}`,
      actionId: "indiehackers-profile-fill",
      saveRequiresExplicitReview: true,
    },
    nextCommands: [
      `npx indiecorns indiehackers fill-profile --open --app-url ${getAppUrl(flags)}`,
      `npx indiecorns profile set indiehackers --username ${shellQuote(plan.fields?.username ?? "danielsinewe")} --app-url ${getAppUrl(flags)}`,
    ],
    reminder:
      "Fill the Indie Hackers form in a signed-in browser, review it, then save manually.",
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated || output.localProfilesUsed ? 0 : 1
  }

  if (!output.authenticated && !output.localProfilesUsed) {
    console.log(warn("No authenticated CLI session found. Run: indiecorns login"))
    return 1
  }

  if (flags.open || !flags["no-open"]) {
    openUrl(targetUrl)
  }

  console.log(color("Indie Hackers profile fill plan", colors.cyan))
  for (const [key, value] of Object.entries(output.fields)) {
    if (value) {
      console.log(`${ok(key)} ${value}`)
    }
  }
  console.log("")
  console.log(dim(output.reminder))
  return 0
}

const runProfile = async (flags, args) => {
  const subcommand = args[0] ?? "show"
  if (
    subcommand === "show" ||
    subcommand === "list" ||
    subcommand === "discover"
  ) {
    return runProfiles({
      ...flags,
      platform: args[1] ?? flags.platform ?? "all",
    })
  }

  if (subcommand !== "set" && subcommand !== "add") {
    console.error(fail(`Unknown profile command: ${subcommand}`))
    console.error("Try: indiecorns profile set peerlist --username <username>")
    console.error(
      "Or:  indiecorns profile set website --profile-url https://your-site.com"
    )
    return 1
  }

  const platform = args[1] ?? flags.platform ?? "peerlist"
  const username = flags.username ?? args[2]
  const savedProfile = await saveExternalProfileToApp({
    flags: {
      ...flags,
      username,
    },
    platform,
  })

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    saved: Boolean(savedProfile?.saved),
    localSaved: Boolean(savedProfile?.localSaved),
    profile: savedProfile?.profile,
    message: savedProfile?.message,
    resolution: savedProfile?.resolution,
  }

  if (flags.json) {
    printJson(output)
    return output.saved || output.localSaved ? 0 : 1
  }

  if (!output.authenticated && !output.localSaved) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  if (!output.saved && !output.localSaved) {
    console.log(warn(output.message ?? "Profile was not saved."))
    return 1
  }

  if (platform === "website") {
    console.log(
      ok(
        `${output.saved ? "Saved" : "Cached"} website ${output.profile?.username}.`
      )
    )
    console.log("Next: indiecorns join slack")
  } else {
    console.log(
      ok(
        `${output.saved ? "Saved" : "Cached"} ${platform} username @${output.profile?.username}.`
      )
    )
  }
  if (!output.saved && output.message) {
    console.log(dim(output.message))
  }
  if (output.profile?.profileUrl) {
    console.log(dim(output.profile.profileUrl))
  }
  if (output.resolution?.method && output.resolution.method !== "direct") {
    console.log(dim(`Resolved via ${output.resolution.method}.`))
  }
  return 0
}

const runLaunch = async (flags, args) => {
  const subcommand = args[0] ?? "set"
  if (subcommand === "list" || subcommand === "show") {
    const platform = normalizeCommunityPlatform(
      args[1] ?? flags.platform ?? "all"
    )
    if (
      platform !== "all" &&
      platform !== "producthunt" &&
      platform !== "peerlist"
    ) {
      console.error(fail(`Unknown launch platform: ${platform}`))
      console.error("Try: indiecorns launch list producthunt")
      console.error("Or:  indiecorns launch list all")
      return 1
    }

    const result = await getCommunityLaunchesFromApp({ flags, platform })
    const output = {
      authenticated: Boolean(getCliAuthHeaders()),
      platform,
      launches: result?.launches ?? [],
      count: result?.launches?.length ?? 0,
      message: result?.message,
      nextCommand:
        platform === "all"
          ? `npx indiecorns community-plan --type upvote --agent --app-url ${getAppUrl(flags)}`
          : `npx indiecorns upvote-members ${platform} --agent --app-url ${getAppUrl(flags)}`,
    }

    if (flags.json || flags.agent) {
      printJson(output)
      return output.authenticated && !output.message ? 0 : 1
    }

    if (!output.authenticated) {
      console.log(
        warn("No authenticated CLI session found. Run: indiecorns login")
      )
      return 1
    }
    if (output.message) {
      console.log(warn(output.message))
      return 1
    }
    if (output.launches.length === 0) {
      console.log(warn("No saved community launches."))
      console.log(
        dim("Setup: indiecorns launch set producthunt --url <url> --name <name>")
      )
      return 0
    }

    console.log(color("Saved community launches", colors.cyan))
    for (const launch of output.launches) {
      console.log(`${ok(launch.source?.replace(/_launch$/, "") ?? platform)} ${launch.name}`)
      console.log(`  ${dim(launch.launch_url)}`)
    }
    console.log(dim(`Next: ${output.nextCommand}`))
    return 0
  }

  if (subcommand !== "set" && subcommand !== "add") {
    console.error(fail(`Unknown launch command: ${subcommand}`))
    console.error(
      "Try: indiecorns launch set producthunt --url https://www.producthunt.com/..."
    )
    return 1
  }

  const platform = normalizeCommunityPlatform(
    args[1] ?? flags.platform ?? "producthunt"
  )
  if (platform !== "producthunt" && platform !== "peerlist") {
    console.error(fail(`Unknown launch platform: ${platform}`))
    console.error("Try: indiecorns launch set producthunt --url <url>")
    console.error("Or:  indiecorns launch set peerlist --url <url>")
    return 1
  }

  const savedLaunch = await saveCommunityLaunchToApp({ flags, platform })
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    saved: Boolean(savedLaunch?.saved),
    launch: savedLaunch?.launch,
    message: savedLaunch?.message,
    nextCommand: `npx indiecorns upvote-members ${platform} --agent --app-url ${getAppUrl(flags)}`,
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.saved ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  if (!output.saved) {
    console.log(warn(output.message ?? "Launch was not saved."))
    return 1
  }

  console.log(ok(`Saved ${platform} launch ${output.launch?.name}.`))
  if (output.launch?.launch_url) {
    console.log(dim(output.launch.launch_url))
  }
  console.log(dim(`Next: ${output.nextCommand}`))
  return 0
}

const runPost = async (flags, args) => {
  const subcommand = args[0] ?? "set"
  if (subcommand === "list" || subcommand === "show") {
    const platform = normalizeCommunityPlatform(args[1] ?? flags.platform ?? "all")
    if (platform !== "all" && platform !== "x" && platform !== "linkedin") {
      console.error(fail(`Unknown post platform: ${platform}`))
      console.error("Try: indiecorns post list x")
      console.error("Or:  indiecorns post list all")
      return 1
    }

    const result = await getCommunityPostsFromApp({ flags, platform })
    const output = {
      authenticated: Boolean(getCliAuthHeaders()),
      platform,
      posts: result?.posts ?? [],
      count: result?.posts?.length ?? 0,
      message: result?.message,
      nextCommands:
        platform === "all"
          ? [
              `npx indiecorns community-plan --type like --agent --app-url ${getAppUrl(flags)}`,
              `npx indiecorns community-plan --type reshare --agent --app-url ${getAppUrl(flags)}`,
              `npx indiecorns community-plan --type comment --agent --app-url ${getAppUrl(flags)}`,
            ]
          : [
              `npx indiecorns engage-members like ${platform} --agent --app-url ${getAppUrl(flags)}`,
              `npx indiecorns engage-members reshare ${platform} --agent --app-url ${getAppUrl(flags)}`,
              `npx indiecorns engage-members comment ${platform} --agent --app-url ${getAppUrl(flags)}`,
            ],
    }

    if (flags.json || flags.agent) {
      printJson(output)
      return output.authenticated && !output.message ? 0 : 1
    }

    if (!output.authenticated) {
      console.log(
        warn("No authenticated CLI session found. Run: indiecorns login")
      )
      return 1
    }
    if (output.message) {
      console.log(warn(output.message))
      return 1
    }
    if (output.posts.length === 0) {
      console.log(warn("No saved community posts."))
      console.log(dim("Setup: indiecorns post set x --url <url> --title <title>"))
      return 0
    }

    console.log(color("Saved community posts", colors.cyan))
    for (const post of output.posts) {
      console.log(`${ok(post.platform)} ${post.title ?? post.author_username ?? "post"}`)
      console.log(`  ${dim(post.post_url)}`)
    }
    console.log(dim(`Next: ${output.nextCommands[0]}`))
    return 0
  }

  if (subcommand !== "set" && subcommand !== "add") {
    console.error(fail(`Unknown post command: ${subcommand}`))
    console.error(
      "Try: indiecorns post set x --url https://x.com/.../status/..."
    )
    return 1
  }

  const platform = normalizeCommunityPlatform(args[1] ?? flags.platform ?? "x")
  if (platform !== "x" && platform !== "linkedin") {
    console.error(fail(`Unknown post platform: ${platform}`))
    console.error("Try: indiecorns post set x --url <url>")
    console.error("Or:  indiecorns post set linkedin --url <url>")
    return 1
  }

  const savedPost = await saveCommunityPostToApp({ flags, platform })
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    saved: Boolean(savedPost?.saved),
    post: savedPost?.post,
    message: savedPost?.message,
    nextCommands: [
      `npx indiecorns engage-members like ${platform} --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns engage-members reshare ${platform} --agent --app-url ${getAppUrl(flags)}`,
      `npx indiecorns engage-members comment ${platform} --agent --app-url ${getAppUrl(flags)}`,
    ],
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.saved ? 0 : 1
  }

  if (!output.authenticated) {
    console.log(
      warn("No authenticated CLI session found. Run: indiecorns login")
    )
    return 1
  }

  if (!output.saved) {
    console.log(warn(output.message ?? "Post was not saved."))
    return 1
  }

  console.log(ok(`Saved ${platform} post ${output.post?.title}.`))
  if (output.post?.post_url) {
    console.log(dim(output.post.post_url))
  }
  console.log(dim(`Next: ${output.nextCommands[0]}`))
  return 0
}

const runDashboard = (flags) => {
  const dashboardUrl = `${getAppUrl(flags)}/dashboard`

  if (flags.json) {
    printJson({
      kind: "open_url",
      url: dashboardUrl,
      command: `npx indiecorns dashboard --no-open --app-url ${getAppUrl(flags)}`,
    })
    return 0
  }

  printBrandHeader("is opening your dashboard.")
  section("Dashboard")
  console.log(dim(dashboardUrl))

  if (flags.open === false || flags["no-open"]) {
    console.log(`If the browser does not open, copy this URL: ${dashboardUrl}`)
    return 0
  }

  if (openUrl(dashboardUrl)) {
    console.log(ok("Opened your browser."))
    return 0
  }

  console.log(
    warn("I could not open a browser automatically. Copy the URL above.")
  )
  return 0
}

const runExtensionOpen = async (flags) => {
  const agentPlan = await getAgentPlan(flags)
  const extensionUrl =
    agentPlan.desktopAutomation?.extensionUrl ?? getExtensionUrl(flags)
  const output = {
    kind: "open_extension",
    authenticated: Boolean(getCliAuthHeaders()),
    extensionId: getExtensionId(flags),
    extensionUrl,
    runNext: Boolean(flags["run-next"]),
    nextAction:
      agentPlan.actions.find(
        (action) => action.id === agentPlan.desktopAutomation?.nextActionId
      ) ??
      agentPlan.nextAction ??
      null,
    note: "The Indiecorns Chrome extension runs safe browser-assisted tasks and records proof after observed completion.",
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return output.authenticated ? 0 : 1
  }

  printBrandHeader("is opening the desktop automation extension.")
  section("Chrome extension")
  console.log(dim(extensionUrl))
  if (output.nextAction) {
    console.log(`${bold("Next:")} ${output.nextAction.title}`)
  }
  if (flags["run-next"]) {
    console.log("Use the extension button: Run next task")
  }

  if (flags.open === false || flags["no-open"]) {
    console.log(`Open this extension URL: ${extensionUrl}`)
    return 0
  }

  if (openUrl(extensionUrl)) {
    console.log(ok("Opened the Indiecorns extension."))
    return 0
  }

  console.log(warn("I could not open the extension automatically."))
  console.log(`Open this extension URL: ${extensionUrl}`)
  return 0
}

const runExtensionStore = (flags, destination) => {
  const review = destination === "review"
  const url = review
    ? getExtensionReviewUrl(flags)
    : getExtensionStoreUrl(flags)
  const output = {
    kind: "open_url",
    action: review ? "review_extension" : "install_extension",
    extensionId: getExtensionId(flags),
    url,
    optional: review,
    note: review
      ? "Reviews are optional and should reflect the user's honest experience."
      : "Open the installed extension and sign in once to verify installation.",
  }

  if (flags.json || flags.agent) {
    printJson(output)
    return 0
  }

  printBrandHeader(
    review
      ? "is opening the optional review page."
      : "is opening the Chrome extension listing."
  )
  section("Chrome extension")
  console.log(dim(url))

  if (flags.open === false || flags["no-open"]) {
    console.log(`Open this URL: ${url}`)
    return 0
  }

  if (openUrl(url)) {
    console.log(
      ok(review ? "Opened the review page." : "Opened the Chrome Web Store.")
    )
    return 0
  }

  console.log(warn("I could not open a browser automatically."))
  console.log(`Open this URL: ${url}`)
  return 0
}

const readJsonFile = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return fallback
  }
}

const getHomePluginInstallPaths = () => ({
  pluginRoot: join(homedir(), "plugins", "indiecorns"),
  marketplacePath: join(homedir(), ".agents", "plugins", "marketplace.json"),
  skillsRoot: join(homedir(), ".agents", "skills"),
})

const getMarketplaceEntry = () => {
  const bundledMarketplace = readJsonFile(bundledMarketplacePath, null)
  return (
    bundledMarketplace?.plugins?.find(
      (plugin) => plugin.name === "indiecorns"
    ) ?? {
      name: "indiecorns",
      source: {
        source: "local",
        path: "./plugins/indiecorns",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    }
  )
}

const installPluginMarketplaceEntry = (marketplacePath) => {
  const existingMarketplace = readJsonFile(marketplacePath, {
    name: "indiecorns",
    interface: {
      displayName: "indiecorns",
    },
    plugins: [],
  })
  const entry = getMarketplaceEntry()
  const plugins = Array.isArray(existingMarketplace.plugins)
    ? existingMarketplace.plugins
    : []
  const nextPlugins = [
    ...plugins.filter((plugin) => plugin.name !== "indiecorns"),
    entry,
  ]
  const nextMarketplace = {
    name: existingMarketplace.name ?? "indiecorns-local",
    interface: existingMarketplace.interface ?? {
      displayName: "Indiecorns Local",
    },
    ...existingMarketplace,
    plugins: nextPlugins,
  }

  mkdirSync(dirname(marketplacePath), { recursive: true })
  writeFileSync(
    marketplacePath,
    `${JSON.stringify(nextMarketplace, null, 2)}\n`
  )
}

const installBundledSkills = (skillsRoot) => {
  const bundledSkillsRoot = join(bundledPluginRoot, "skills")

  if (!existsSync(bundledSkillsRoot)) {
    return {
      installed: false,
      error: "The Indiecorns skill bundle is missing from this package.",
      skillsRoot,
      skills: [],
    }
  }

  const skillNames = ["indiecorns"]
  const installedSkills = []
  mkdirSync(skillsRoot, { recursive: true })

  for (const skillName of skillNames) {
    const source = join(bundledSkillsRoot, skillName)
    const target = join(skillsRoot, skillName)

    if (!existsSync(source)) {
      return {
        installed: false,
        error: `The bundled ${skillName} skill is missing from this package.`,
        skillsRoot,
        skills: installedSkills,
      }
    }

    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true })
    installedSkills.push({
      name: skillName,
      path: target,
    })
  }

  return {
    installed: true,
    skillsRoot,
    skills: installedSkills,
  }
}

const installPluginBundle = () => {
  if (!existsSync(bundledPluginRoot)) {
    return {
      installed: false,
      error: "The Indiecorns plugin bundle is missing from this package.",
    }
  }

  const { pluginRoot, marketplacePath, skillsRoot } =
    getHomePluginInstallPaths()
  rmSync(pluginRoot, { recursive: true, force: true })
  mkdirSync(dirname(pluginRoot), { recursive: true })
  cpSync(bundledPluginRoot, pluginRoot, { recursive: true })
  installPluginMarketplaceEntry(marketplacePath)
  const skillInstall = installBundledSkills(skillsRoot)

  return {
    installed: true,
    pluginInstalled: true,
    skillsInstalled: skillInstall.installed,
    pluginRoot,
    marketplacePath,
    skillsRoot: skillInstall.skillsRoot,
    skills: skillInstall.skills,
    skillInstall,
    nextStep: "Restart Codex so it reloads the local plugin marketplace.",
  }
}

const runPluginInstall = (flags) => {
  const result = installPluginBundle()

  if (!result.installed) {
    if (flags.json) {
      printJson(result)
      return 1
    }

    console.error(fail(result.error))
    return 1
  }

  if (flags.json) {
    printJson(result)
    return 0
  }

  printBrandHeader("installed the local agent plugin.")
  section("Plugin")
  console.log(`${ok("Plugin:")} ${result.pluginRoot}`)
  console.log(`${ok("Marketplace:")} ${result.marketplacePath}`)
  if (result.skillsInstalled) {
    console.log(`${ok("Skills:")} ${result.skillsRoot}`)
  } else if (result.skillInstall?.error) {
    console.log(warn(`Skills skipped: ${result.skillInstall.error}`))
  }
  console.log("Restart Codex so it reloads the local plugin marketplace.")
  return 0
}

const getSetupReport = () => {
  const pkg = readPackage()
  const npmVersion = spawnSync("npm", ["--version"], { encoding: "utf8" })
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "0",
    10
  )
  const rows = [
    {
      status: nodeMajor >= 20 ? "ok" : "warn",
      label: `Node ${process.versions.node}`,
      detail:
        nodeMajor >= 20
          ? "compatible with Next.js 16"
          : "Node 20+ is recommended",
    },
    {
      status: npmVersion.status === 0 ? "ok" : "fail",
      label: "npm available",
      detail:
        npmVersion.status === 0
          ? npmVersion.stdout.trim()
          : "npm command failed",
    },
    {
      status: existsSync(join(appRoot, "node_modules")) ? "ok" : "warn",
      label: "dependencies installed",
      detail: "expected at indiecorns/node_modules",
    },
    {
      status: existsSync(join(appRoot, "app", "layout.tsx")) ? "ok" : "fail",
      label: "Next app layout exists",
      detail: "app/layout.tsx",
    },
    {
      status: pkg.scripts?.dev ? "ok" : "fail",
      label: "dev script configured",
      detail: pkg.scripts?.dev ?? "missing",
    },
  ]

  return { appRoot, packageName: pkg.name, rows }
}

const getWizardReport = async (flags) => {
  const appUrl = getAppUrl(flags)
  const setup = getSetupReport()
  const agentPlan = await getAgentPlan(flags)
  const config = readConfig()
  const pluginInstallPaths = getHomePluginInstallPaths()
  const pluginInstalled = existsSync(pluginInstallPaths.pluginRoot)
  const skillRoot = join(pluginInstallPaths.skillsRoot, "indiecorns")
  const skillsInstalled = existsSync(skillRoot)
  const authenticated = hasToken() || hasBrowserSession()
  const taskSummary = agentPlan.onboarding

  return {
    app: "indiecorns",
    mode: "cli_first_collective",
    appUrl,
    authenticated,
    authMethod: hasToken() ? "INDIECORNS_TOKEN" : "browser",
    userEmail: config.browserSession?.userEmail,
    setup,
    plugin: {
      installed: pluginInstalled,
      skillsInstalled,
      pluginRoot: pluginInstallPaths.pluginRoot,
      marketplacePath: pluginInstallPaths.marketplacePath,
      skillsRoot: pluginInstallPaths.skillsRoot,
      skills: skillsInstalled ? [{ name: "indiecorns", path: skillRoot }] : [],
      installCommand: "npx indiecorns plugin install",
    },
    onboarding: taskSummary,
    commands: {
      login: `npx indiecorns login --app-url ${appUrl}`,
      tasks: `npx indiecorns tasks --app-url ${appUrl}`,
      run: `npx indiecorns run --app-url ${appUrl}`,
      agent: `npx indiecorns agent --app-url ${appUrl}`,
      dashboard: `npx indiecorns dashboard --app-url ${appUrl}`,
      followMembers: `npx indiecorns follow-members all --agent --app-url ${appUrl}`,
      communityQueue: `npx indiecorns community-queue --agent --app-url ${appUrl}`,
      communityOpen: `npx indiecorns community-open --limit 5 --app-url ${appUrl}`,
      communityPlan: `npx indiecorns community-plan --agent --app-url ${appUrl}`,
      communityNext: `npx indiecorns community-next --agent --app-url ${appUrl}`,
      communityStatus: `npx indiecorns community-status --agent --app-url ${appUrl}`,
      likeXMembers: `npx indiecorns engage-members like x --agent --app-url ${appUrl}`,
      reshareXMembers: `npx indiecorns engage-members reshare x --agent --app-url ${appUrl}`,
      likeLinkedInMembers: `npx indiecorns engage-members like linkedin --agent --app-url ${appUrl}`,
      reshareLinkedInMembers: `npx indiecorns engage-members reshare linkedin --agent --app-url ${appUrl}`,
      commentLinkedInMembers: `npx indiecorns engage-members comment linkedin --agent --app-url ${appUrl}`,
      commentXMembers: `npx indiecorns engage-members comment x --agent --app-url ${appUrl}`,
      listCommunityPosts: `npx indiecorns post list all --agent --app-url ${appUrl}`,
      listCommunityLaunches: `npx indiecorns launch list all --agent --app-url ${appUrl}`,
      peerlistLaunches: `npx indiecorns peerlist-launches --agent --app-url ${appUrl}`,
      upvotePeerlistMembers: `npx indiecorns upvote-members peerlist --agent --app-url ${appUrl}`,
      ratePeerlistLaunches: `npx indiecorns rate peerlist --agent --app-url ${appUrl}`,
      upvoteProductHuntMembers: `npx indiecorns upvote-members producthunt --agent --app-url ${appUrl}`,
      pluginInstall: "npx indiecorns plugin install",
    },
    agentPlan,
  }
}

const emitWizardNdjson = async (flags) => {
  printNdjson({
    type: "wizard.started",
    app: "indiecorns",
    mode: "cli_first_collective",
  })

  const report = await getWizardReport(flags)

  printNdjson({
    type: "wizard.step",
    step: "setup",
    status: report.setup.rows.some((row) => row.status === "fail")
      ? "failed"
      : "ok",
    rows: report.setup.rows,
  })
  printNdjson({
    type: "wizard.step",
    step: "auth",
    status: report.authenticated ? "ok" : "action_required",
    authenticated: report.authenticated,
    command: report.commands.login,
  })
  printNdjson({
    type: "wizard.step",
    step: "plugin",
    status: report.plugin.installed ? "ok" : "action_available",
    installed: report.plugin.installed,
    command: report.commands.pluginInstall,
  })
  printNdjson({
    type: "wizard.step",
    step: "onboarding",
    status: report.onboarding.pending === 0 ? "ok" : "action_available",
    summary: report.onboarding,
  })
  printNdjson({
    type: "wizard.completed",
    nextCommands: Object.values(report.commands),
  })

  return 0
}

const runWizard = async (flags) => {
  if (flags.ndjson) {
    return emitWizardNdjson(flags)
  }

  if (flags.json || flags.agent) {
    const report = await getWizardReport(flags)
    printJson(report)
    return report.setup.rows.some((row) => row.status === "fail") ? 1 : 0
  }

  if (
    !hasToken() &&
    !hasBrowserSession() &&
    process.stdout.isTTY &&
    !flags["no-open"]
  ) {
    return runBrowserAuth(flags, "login")
  }

  const report = await withSpinner(
    "Checking your Indiecorns setup...",
    () => getWizardReport(flags),
    ok("Setup check complete.")
  )
  const quickStartActions = QUICK_START_ACTION_IDS.map((actionId) =>
    report.agentPlan.actions.find((action) => action.id === actionId)
  ).filter(Boolean)
  const nextQuickStartAction = quickStartActions.find(
    (action) => action.status !== "completed"
  )
  const completedQuickStart = quickStartActions.filter(
    (action) => action.status === "completed"
  ).length

  printBrandHeader(`setup v${getCliVersion()}`)
  section("Your setup")
  console.log(
    `${report.authenticated ? ok("Connected") : warn("Not connected")} ${
      report.authenticated
        ? `as ${report.userEmail ?? report.authMethod}`
        : "to Indiecorns"
    }`
  )
  console.log(
    `${report.plugin.installed ? ok("Plugin installed") : warn("Plugin missing")} ${
      report.plugin.installed
        ? "for this coding agent"
        : "so agents can read Indiecorns tasks"
    }`
  )
  console.log(
    `${ok("Quick start")} ${completedQuickStart}/${quickStartActions.length} complete`
  )

  const setupIssues = report.setup.rows.filter((row) => row.status !== "ok")

  if (setupIssues.length > 0) {
    section("Needs attention")
    printRows(setupIssues)
  }

  if (!report.authenticated) {
    section("Connect")
    console.log(`  ${ok("npx indiecorns login --no-open")}`)
    console.log("  Open the secure link on a machine with a browser.")
    return 0
  }

  if (!report.plugin.installed || !report.plugin.skillsInstalled) {
    section("Next step")
    console.log(`  ${ok(report.commands.pluginInstall)}`)
    console.log(
      "  Install the local plugin and skill so agents can use Indiecorns."
    )
    return 0
  }

  section("Next step")
  if (nextQuickStartAction) {
    console.log(`  ${ok(nextQuickStartAction.agentCommand)}`)
    console.log(`  ${nextQuickStartAction.title}`)
  } else {
    console.log(`  ${ok(report.commands.dashboard)}`)
    console.log("  Setup complete. Optional community actions are in the dashboard.")
  }
  return 0
}

const runOnboarding = async (flags) => runWizard(flags)

const main = async () => {
  const { command, args, flags: parsedFlags } = parseArgs(process.argv.slice(2))
  const flags = applyAgentMode(parsedFlags)

  switch (command) {
    case "wizard":
    case "collective":
    case "init":
    case "setup":
      if (["ai", "assist", "agent"].includes(args[0])) {
        const promptParts = args.slice(1)
        if (isCommunitySupportRequest(promptParts)) {
          return runCommunitySupportAssistant(flags, promptParts)
        }
        return runSetupAssistant(flags, promptParts)
      }
      return runWizard(flags)
    case "assist":
    case "assistant":
      if (isCommunitySupportRequest(args)) {
        return runCommunitySupportAssistant(flags, args)
      }
      return runSetupAssistant(flags, args)
    case "support-assist":
    case "support-assistant":
    case "community-assist":
    case "community-assistant":
      return runCommunitySupportAssistant(flags, args)
    case "setup-assist":
    case "setup-assistant":
      return runSetupAssistant(flags, args)
    case "auth": {
      const subcommand = args[0] ?? "login"
      if (subcommand === "login") {
        return runBrowserAuth(flags, "login")
      }
      if (subcommand === "signup" || subcommand === "sign-up") {
        return runBrowserAuth(flags, "signup")
      }
      if (subcommand === "status") {
        return runAuthStatus(flags)
      }
      console.error(fail(`Unknown auth command: ${subcommand}`))
      console.error("Try: indiecorns auth login")
      return 1
    }
    case "login":
    case "signin":
    case "sign-in":
      return runBrowserAuth(flags, "login")
    case "signup":
    case "sign-up":
      return runBrowserAuth(flags, "signup")
    case "status":
      return runAuthStatus(flags)
    case "tasks":
    case "task":
    case "onboarding":
      return runTasks(flags)
    case "follow":
      if (
        args[0] === "members" ||
        args[0] === "member" ||
        args[0] === "makers" ||
        args[0] === "maker"
      ) {
        return runFollowMembers(flags, args[1] ?? flags.platform ?? "all")
      }
      return runFollow(flags, args[0])
    case "follow-members":
    case "follow-member":
    case "follow-makers":
    case "follow-maker":
      return runFollowMembers(flags, args[0] ?? flags.platform ?? "all")
    case "community-plan":
    case "community-action-plan":
    case "action-plan":
    case "support-members":
    case "support-makers":
      return runCommunityActionPlan(flags, args)
    case "community-queue":
    case "action-queue":
    case "support-queue":
      return runCommunityQueue(flags, args)
    case "community-open":
    case "open-community":
    case "open-queue":
    case "support-open":
      return runCommunityQueue(flags, args, { openTargets: true })
    case "community-next":
    case "next-community-action":
    case "next-action":
    case "support-next":
      return runCommunityNext(flags, args)
    case "community-status":
    case "support-status":
    case "activity-status":
      return runCommunityStatus(flags)
    case "peerlist-launches":
    case "peerlist-launch":
    case "weekly-peerlist-launches":
    case "monday-peerlist":
    case "monday-launches":
      return runPeerlistLaunches(flags)
    case "engage-members":
    case "engage-member":
    case "engage-makers":
    case "engage-maker":
    case "action-targets":
    case "community-actions":
      return runEngageMembers(
        flags,
        args[0] ?? flags.type ?? flags.action ?? "like",
        args[1] ?? flags.platform ?? "all"
      )
    case "like-members":
    case "like-member":
    case "like-makers":
    case "like-maker":
      return runEngageMembers(flags, "like", args[0] ?? flags.platform ?? "all")
    case "reshare-members":
    case "reshare-member":
    case "reshare-makers":
    case "reshare-maker":
    case "repost-members":
    case "repost-member":
    case "repost-makers":
    case "repost-maker":
      return runEngageMembers(
        flags,
        "reshare",
        args[0] ?? flags.platform ?? "all"
      )
    case "upvote-members":
    case "upvote-member":
    case "upvote-makers":
    case "upvote-maker":
      return runEngageMembers(
        flags,
        "upvote",
        args[0] ?? flags.platform ?? "all"
      )
    case "comment-members":
    case "comment-member":
    case "comment-makers":
    case "comment-maker":
      return runEngageMembers(
        flags,
        "comment",
        args[0] ?? flags.platform ?? "all"
      )
    case "upvote":
    case "upvotes": {
      const target = args[0] ?? flags.platform ?? "producthunt"
      if (
        target === "producthunt" ||
        target === "product-hunt" ||
        target === "ph"
      ) {
        return runEngageMembers(flags, "upvote", "producthunt")
      }
      if (target === "peerlist") {
        return runEngageMembers(
          { ...flags, "target-source": "projects" },
          "upvote",
          "peerlist"
        )
      }
      console.error(fail(`Unknown upvote target: ${target}`))
      console.error("Try: indiecorns upvote producthunt")
      console.error("Or:  indiecorns upvote peerlist")
      return 1
    }
    case "rate":
    case "rating": {
      const target = args[0] ?? "peerlist"
      if (
        target === "peerlist" ||
        target === "launch" ||
        target === "indiecorns"
      ) {
        return runEngageMembers(
          { ...flags, "target-source": "projects" },
          "rate",
          "peerlist"
        )
      }
      if (target === "worktracks" || target === "worktracks-v2") {
        return runFollow(flags, "worktracks-peerlist-rating")
      }
      console.error(fail(`Unknown rating target: ${target}`))
      console.error("Try: indiecorns rate peerlist")
      console.error("Or:  indiecorns rate worktracks")
      return 1
    }
    case "join":
    case "accept":
    case "invite": {
      const target = args[0] ?? "slack"
      if (
        target === "slack" ||
        target === "slack-workspace" ||
        target === "discord" ||
        target === "server" ||
        target === "community"
      ) {
        return runFollow(flags, "discord")
      }
      if (
        target === "peerlist" ||
        target === "company" ||
        target === "peerlist-company"
      ) {
        return runFollow(flags, "peerlist-invite")
      }
      console.error(fail(`Unknown invite target: ${target}`))
      console.error("Try: indiecorns join slack")
      console.error("Or:  indiecorns join peerlist")
      return 1
    }
    case "run":
    case "do":
      return runAllOnboarding(flags)
    case "complete":
    case "done":
      return runComplete(flags, args[0] ?? "all")
    case "record":
    case "event":
      return runRecord(flags, args[0])
    case "events":
      return runEvents(flags)
    case "profiles":
      return runProfiles(flags)
    case "profile":
      return runProfile(flags, args)
    case "indiehackers":
    case "indie-hackers":
    case "ih":
      if (args[0] === "profiles" || args[0] === "profile") {
        return runProfiles({ ...flags, platform: "indiehackers" })
      }
      return runIndieHackers(flags, args)
    case "launch":
    case "launches":
    case "project":
    case "projects":
      return runLaunch(flags, args)
    case "post":
    case "posts":
      return runPost(flags, args)
    case "x":
    case "twitter":
      if (
        args[0] === "post" ||
        args[0] === "posts" ||
        args[0] === "tweet" ||
        args[0] === "tweets"
      ) {
        return runPost(flags, ["set", "x", ...args.slice(1)])
      }
      return runFollow(flags, "x")
    case "linkedin":
      if (args[0] === "post" || args[0] === "posts") {
        return runPost(flags, ["set", "linkedin", ...args.slice(1)])
      }
      return runFollow(flags, "linkedin")
    case "peerlist":
    case "peers":
    case "makers":
      if (args[0] === "profiles" || args[0] === "profile") {
        return runProfiles({ ...flags, platform: "peerlist" })
      }
      return runFollow(flags, "peerlist")
    case "producthunt":
    case "product-hunt":
    case "ph":
      if (args[0] === "profiles" || args[0] === "profile") {
        return runProfiles({ ...flags, platform: "producthunt" })
      }
      if (
        args[0] === "launch" ||
        args[0] === "launches" ||
        args[0] === "project" ||
        args[0] === "projects"
      ) {
        return runLaunch(flags, ["set", "producthunt", ...args.slice(1)])
      }
      if (args[0] === "upvote" || args[0] === "upvotes") {
        return runEngageMembers(
          flags,
          "upvote",
          args[1] ?? flags.platform ?? "producthunt"
        )
      }
      return runEngageMembers(flags, "upvote", "producthunt")
    case "dashboard":
      return runDashboard(flags)
    case "extension":
    case "ext":
    case "desktop": {
      const subcommand = args[0] ?? "open"
      if (
        subcommand === "open" ||
        subcommand === "run" ||
        subcommand === "next"
      ) {
        return runExtensionOpen({
          ...flags,
          "run-next": flags["run-next"] || subcommand !== "open",
        })
      }
      if (subcommand === "install" || subcommand === "add") {
        return runExtensionStore(flags, "install")
      }
      if (subcommand === "review") {
        return runExtensionStore(flags, "review")
      }
      console.error(fail(`Unknown extension command: ${subcommand}`))
      console.error("Try: indiecorns extension install")
      return 1
    }
    case "plugin": {
      const subcommand = args[0] ?? "install"
      if (subcommand === "install" || subcommand === "add") {
        return runPluginInstall(flags)
      }
      console.error(fail(`Unknown plugin command: ${subcommand}`))
      console.error("Try: indiecorns plugin install")
      return 1
    }
    case "telemetry":
    case "analytics":
      return runTelemetry(flags, args[0] ?? "status")
    case "agent":
    case "plan":
    case "actions":
      printJson(await getAgentPlan(flags))
      return 0
    case "start":
      return runOnboarding(flags)
    case "help":
    case "--help":
    case "-h":
      console.log(usage)
      return 0
    case undefined:
      return runOnboarding(flags)
    default:
      if (process.argv.slice(2).length === 0) {
        return runOnboarding(flags)
      }
      console.error(fail(`Unknown command: ${command}`))
      console.error(usage)
      return 1
  }
}

const cliStartedAt = Date.now()
const parsedForTelemetry = parseArgs(process.argv.slice(2))
const telemetryCommand = parsedForTelemetry.command ?? "start"
const telemetryFlags = parsedForTelemetry.flags
const telemetryArgs = parsedForTelemetry.args
const shouldTrackCommand = !["telemetry", "analytics"].includes(
  telemetryCommand
)

Promise.resolve(
  shouldTrackCommand
    ? trackCliEvent(
        "cli command started",
        getCommandTelemetryProperties({
          command: telemetryCommand,
          args: telemetryArgs,
          flags: telemetryFlags,
        }),
        telemetryFlags
      )
    : undefined
)
  .then(() => main())
  .then((exitCode) => {
    process.exitCode = exitCode
    return shouldTrackCommand
      ? trackCliEvent(
          "cli command completed",
          {
            ...getCommandTelemetryProperties({
              command: telemetryCommand,
              args: telemetryArgs,
              flags: telemetryFlags,
            }),
            duration_ms: Date.now() - cliStartedAt,
            exit_code: exitCode,
          },
          telemetryFlags
        )
      : undefined
  })
  .catch((error) => {
    console.error(fail(error.message))
    process.exitCode = 1
    return shouldTrackCommand
      ? trackCliEvent(
          "cli command failed",
          {
            ...getCommandTelemetryProperties({
              command: telemetryCommand,
              args: telemetryArgs,
              flags: telemetryFlags,
            }),
            duration_ms: Date.now() - cliStartedAt,
            error_name: error?.name ?? "Error",
          },
          telemetryFlags
        )
      : undefined
  })
  .finally(() => {
    return shutdownTelemetry()
  })
