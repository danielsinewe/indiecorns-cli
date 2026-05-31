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
const POSTHOG_PROJECT_ID = "183838"
const POSTHOG_MCP_URL = `https://mcp.posthog.com/mcp?project_id=${POSTHOG_PROJECT_ID}`
const CLI_INSTALL_ACTION_ID = "cli"
const ONBOARDING_ACTIONS = [
  {
    id: CLI_INSTALL_ACTION_ID,
    aliases: ["install", "terminal"],
    title: "Install the CLI",
    credits: 100,
    url: "https://www.npmjs.com/package/indiecorns",
    kind: "command",
    command: "npx indiecorns login",
    verification: "cli_session",
    required: true,
  },
  {
    id: "peerlist-upvote",
    aliases: ["upvote", "launch", "peerlist-launch"],
    title: "Upvote Indiecorns on Peerlist",
    credits: 100,
    url: "https://peerlist.io/danielsinewe/project/indiecorns",
    command: "npx indiecorns upvote peerlist",
    verification: "external_platform",
    requires: [CLI_INSTALL_ACTION_ID],
  },
  {
    id: "discord",
    aliases: ["server", "community", "discord-server"],
    title: "Join the Discord server",
    credits: 100,
    url: "https://discord.gg/JRwTZrTGy",
    command: "npx indiecorns join discord",
    verification: "external_platform",
    requires: [CLI_INSTALL_ACTION_ID],
  },
  {
    id: "external-profile-peerlist",
    aliases: ["peerlist-profile", "profile-peerlist"],
    title: "Add your Peerlist profile",
    credits: 50,
    url: `${DEFAULT_APP_URL}/dashboard#social-links`,
    command: "npx indiecorns profile set peerlist --username <username>",
    verification: "profile_link",
    requires: [CLI_INSTALL_ACTION_ID],
  },
]

const usage = `Indiecorns CLI

Usage:
  indiecorns [command] [options]

Commands:
  wizard                         Run the CLI-first Indiecorns setup wizard
  collective                     Show the CLI-first collective command center
  init                           Alias for wizard
  login                          Sign in to Indiecorns in your browser
  signup                         Create an Indiecorns account in your browser
  status                         Show CLI authentication status
  tasks                          Show onboarding tasks
  follow <discord>               Open a task and earn onboarding credits
  upvote peerlist                Open the Indiecorns Peerlist launch upvote
  join discord                   Open the Indiecorns Discord invite
  record peerlist --target <u>   Record an external Peerlist follow event
  events                         Show recorded external action events
  profiles [--platform <name>]   Show known external profiles and follow targets
  profile show [platform]        Show your saved external profiles
  profile set peerlist --username <u>
                                 Save your Peerlist username for Indiecorns
  run                            Run every pending onboarding task
  complete <peerlist-upvote|discord|external-profile-peerlist|all>
                                 Mark an already-finished task as complete
  dashboard                      Open your Indiecorns dashboard
  agent                          Print a Codex-ready JSON action plan
  plugin install                 Install the Indiecorns Codex plugin locally
  telemetry status               Show CLI telemetry status
  telemetry disable              Disable CLI telemetry
  telemetry enable               Enable CLI telemetry
  doctor                         Check a local Indiecorns app checkout
  help                           Show this help

Options:
  --json                         Print machine-readable JSON where supported
  --agent                        Print agent-safe JSON and never open a browser
  --ndjson                       Stream wizard lifecycle events as NDJSON
  --app-url <url>                Override Indiecorns app URL
  --no-open                      Print auth URL without opening a browser
  --timeout <seconds>            Login wait timeout, default 180
  --actor <username>             External platform username performing an action
  --target <username>            External platform username being acted on
  --target-url <url>             External platform profile URL being acted on
  --username <username>          Your external platform username
  --profile-url <url>            Your external platform profile URL
  --display-name <name>          External platform display name
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

const hasToken = () => Boolean(process.env.INDIECORNS_TOKEN)
const hasBrowserSession = () =>
  Boolean(readConfig().browserSession?.authenticatedAt)
const telemetryDisabledValues = new Set(["1", "true", "yes", "on"])

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
  telemetryDisabledValues.has(
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

const getActionCommand = (action, flags) => {
  if (action.kind === "command") {
    return `${action.command} --app-url ${getAppUrl(flags)}`
  }

  if (isProfileAction(action)) {
    const platform = getProfilePlatform(action)
    const valueFlag =
      platform === "website" ? "--profile-url <url>" : "--username <username>"
    return `npx indiecorns profile set ${platform} ${valueFlag} --app-url ${getAppUrl(flags)}`
  }

  if (action.command) {
    return `${action.command} --no-open --app-url ${getAppUrl(flags)}`
  }

  return `npx indiecorns follow ${action.id} --no-open --app-url ${getAppUrl(flags)}`
}

const getCompleteCommand = (action, flags) =>
  isProfileAction(action)
    ? getActionCommand(action, flags)
    : `npx indiecorns complete ${action.id} --app-url ${getAppUrl(flags)}`

const getRunCommand = (flags) =>
  `npx indiecorns run --app-url ${getAppUrl(flags)}`

const getCliAuthHeaders = () => {
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

const getAgentPlan = async (flags) => {
  const appUrl = getAppUrl(flags)
  const authenticated = hasToken() || hasBrowserSession()
  const appActions = await getOnboardingActionsFromApp(flags)
  const actions = appActions?.actions ?? ONBOARDING_ACTIONS
  const taskOutputs = actions.map((action) => toTaskOutput(action, flags))
  const completedCount = taskOutputs.filter(
    (action) => action.status === "completed"
  ).length
  const openedCount = taskOutputs.filter(
    (action) => action.status === "opened"
  ).length
  const pendingCount = taskOutputs.filter(
    (action) => action.status === "pending"
  ).length

  return {
    app: "indiecorns",
    agentReady: true,
    appUrl,
    auth: {
      authenticated,
      method: hasToken() ? "INDIECORNS_TOKEN" : "browser",
      loginUrl: `${appUrl}/sign-in?source=cli`,
      signupUrl: `${appUrl}/sign-up?source=cli`,
      loginCommand: `npx indiecorns login --app-url ${appUrl}`,
      signupCommand: `npx indiecorns signup --app-url ${appUrl}`,
      statusCommand: "npx indiecorns status --json",
    },
    plugin: {
      name: "indiecorns",
      installed: existsSync(join(homedir(), "plugins", "indiecorns")),
      autoInstalledBy: "npx indiecorns login",
      installCommand: "npx indiecorns plugin install",
      requiredForAutopilot: true,
    },
    dashboard: {
      url: `${appUrl}/dashboard`,
      command: `npx indiecorns dashboard --no-open --app-url ${appUrl}`,
    },
    onboarding: {
      liveStatusLoaded: Boolean(appActions?.actions),
      total: taskOutputs.length,
      completed: completedCount,
      opened: openedCount,
      pending: pendingCount,
      creditsEarned: taskOutputs
        .filter((action) => action.status === "completed")
        .reduce((total, action) => total + action.credits, 0),
      creditsAvailable: taskOutputs.reduce(
        (total, action) => total + action.credits,
        0
      ),
      pendingCommands: taskOutputs
        .filter((action) => action.status === "pending")
        .map((action) => action.command),
      remainingCommands: taskOutputs
        .filter((action) => action.status !== "completed")
        .map((action) => action.command),
      requiredFirstActionId: CLI_INSTALL_ACTION_ID,
    },
    actions: taskOutputs.map((action) => ({
      id: action.id,
      kind: action.kind,
      title: action.title,
      credits: action.credits,
      status: action.status,
      url: action.url,
      command: action.command,
      completeCommand: action.completeCommand,
      verification: action.verification,
      required: action.required,
      requires: action.requires,
      verificationNote:
        action.kind === "command"
          ? "Running the authenticated CLI completes this action automatically."
          : action.id === "peerlist-upvote"
            ? "The CLI opens and stores the launch upvote task. Actual upvote verification depends on the user's Peerlist session."
            : action.id === "discord"
              ? "The CLI opens and stores the Discord invite task. Actual join verification depends on the user's Discord session."
              : action.id === "external-profile-peerlist"
                ? "The CLI saves your Peerlist profile link for Indiecorns."
                : "The CLI can open and persist this action. Actual verification depends on the external platform session.",
      aliases: action.aliases,
    })),
    nextCommands: [
      "npx indiecorns login --no-open",
      "npx indiecorns tasks --json",
      "npx indiecorns run --no-open --json",
      "npx indiecorns upvote peerlist --no-open",
      "npx indiecorns join discord --no-open",
      "npx indiecorns profile set peerlist --username <username>",
      "npx indiecorns profiles --platform peerlist --json",
      "npx indiecorns dashboard --no-open",
    ],
  }
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

const createCliSession = async (appUrl) => {
  const response = await fetch(`${appUrl}/api/cli/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cliVersion: getCliVersion(),
      nodeVersion: process.version,
      platform: osPlatform(),
      architecture: osArch(),
    }),
  })

  if (!response.ok) {
    throw new Error("Unable to create a CLI auth session.")
  }

  return response.json()
}

const pollCliSession = async ({ appUrl, id, secret }) => {
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

  const response = await fetch(`${getAppUrl(flags)}/api/onboarding/actions`, {
    headers,
  })

  if (!response.ok) {
    return null
  }

  return response.json()
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

  const url = new URL(`${getAppUrl(flags)}/api/onboarding/events`)
  if (flags.action) {
    url.searchParams.set("actionId", flags.action)
  }
  if (flags.platform) {
    url.searchParams.set("platform", flags.platform)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const getExternalProfilesFromApp = async (flags) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const url = new URL(`${getAppUrl(flags)}/api/users/external-profiles`)
  if (flags.platform && flags.platform !== "all") {
    url.searchParams.set("platform", flags.platform)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const saveExternalProfileToApp = async ({ flags, platform }) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const username = flags.username ?? flags.user ?? flags.handle
  const profileUrl = flags["profile-url"] ?? flags.url
  if (!username && !profileUrl) {
    return {
      saved: false,
      message: "Missing --username or --profile-url.",
    }
  }

  const response = await fetch(
    `${getAppUrl(flags)}/api/users/external-profiles`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        platform,
        username,
        profileUrl,
        displayName: flags["display-name"],
        source: flags.source ?? "cli",
        confidence: flags.confidence ?? "user_verified",
      }),
    }
  )

  if (!response.ok) {
    return null
  }

  return response.json()
}

const saveExternalActionEventToApp = async ({
  flags,
  actionId,
  platform,
  eventType = "follow",
  status = "followed",
}) => {
  const headers = getCliAuthHeaders()
  if (!headers) {
    return null
  }

  const targetUsername = flags.target ?? flags["target-username"]
  const targetProfileUrl =
    flags["target-url"] ??
    flags.url ??
    (platform === "peerlist" && targetUsername
      ? `https://peerlist.io/${targetUsername}`
      : undefined)

  if (!targetProfileUrl) {
    return {
      saved: false,
      message: "Missing --target-url or --target.",
    }
  }

  const response = await fetch(`${getAppUrl(flags)}/api/onboarding/events`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
      },
    }),
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

const saveCompletedSession = ({ appUrl, session, id, secret }) => {
  const config = readConfig()
  const authenticatedAt = session.completedAt ?? new Date().toISOString()
  writeConfig({
    ...config,
    pendingCliSession: undefined,
    browserSession: {
      authenticatedAt,
      appUrl,
      userEmail: session.userEmail,
      userId: session.userId,
      cliVersion: session.cliVersion,
      nodeVersion: session.nodeVersion,
      platform: session.platform,
      architecture: session.architecture,
      cliSessionId: id,
      cliSecret: secret,
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

const markCliInstalled = async (appUrl) => {
  const [savedAction, pluginInstall] = await Promise.all([
    saveCliInstallAction(appUrl),
    installPluginBundle(),
  ])

  return { savedAction, pluginInstall }
}

const waitForAppCliSession = async ({ appUrl, id, secret, timeoutSeconds }) => {
  const deadline = Date.now() + timeoutSeconds * 1000

  while (Date.now() < deadline) {
    const session = await pollCliSession({ appUrl, id, secret })

    if (session.status === "completed") {
      saveCompletedSession({ appUrl, session, id, secret })
      const installResult = await markCliInstalled(appUrl)
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
  const authUrl = new URL(`${appUrl}/${route}`)
  const action =
    mode === "signup"
      ? "Create your Indiecorns account"
      : "Sign in to Indiecorns"
  authUrl.searchParams.set("source", "cli")

  let cliSession = null
  if (!flags.json) {
    cliSession = await withSpinner(
      "Preparing your Indiecorns sign-in link...",
      () => createCliSession(appUrl),
      ok("Sign-in link is ready.")
    )
    authUrl.searchParams.set("cli_session", cliSession.id)
    authUrl.searchParams.set("cli_secret", cliSession.secret)
    writeConfig({
      ...readConfig(),
      pendingCliSession: {
        appUrl,
        id: cliSession.id,
        secret: cliSession.secret,
        createdAt: new Date().toISOString(),
      },
    })
  }

  if (flags.json) {
    printJson({
      status: "browser_auth_required",
      mode,
      url: authUrl.toString(),
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
    "I will open Indiecorns, wait here, connect this terminal, and install the local agent plugin for you."
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
        console.log(ok("Agent plugin installed for local coding agents."))
      } else if (session.pluginInstall?.error) {
        console.log(
          warn(`Plugin install skipped: ${session.pluginInstall.error}`)
        )
      }
      console.log("")
      console.log(`${bold("Next:")} npx indiecorns tasks`)
      console.log(dim("Tip: agents can use npx indiecorns agent for JSON."))
      return 0
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
      console.log(ok("Agent plugin installed for local coding agents."))
    }
    return 0
  }

  const config = readConfig()
  if (config.pendingCliSession?.id && config.pendingCliSession?.secret) {
    const session = await pollCliSession(config.pendingCliSession)
    if (session.status === "completed") {
      saveCompletedSession({
        appUrl: config.pendingCliSession.appUrl,
        session,
        id: config.pendingCliSession.id,
        secret: config.pendingCliSession.secret,
      })
      const installResult = await markCliInstalled(
        config.pendingCliSession.appUrl
      )

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
        console.log(ok("Agent plugin installed for local coding agents."))
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
      console.log(ok("Agent plugin installed for local coding agents."))
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
    (action) => action.id === normalized || action.aliases.includes(normalized)
  )
}

const normalizeActionUrl = (action) => action.url ?? action.href

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
    credits: mergedAction.credits,
    status: mergedAction.status ?? "pending",
    url: normalizeActionUrl(mergedAction),
    command: getActionCommand(mergedAction, flags),
    completeCommand: getCompleteCommand(mergedAction, flags),
    verification: mergedAction.verification ?? "external_platform",
    aliases: mergedAction.aliases,
    required: Boolean(mergedAction.required),
    requires: mergedAction.requires ?? [],
  }
}

const runTasks = async (flags) => {
  const appActions = await getOnboardingActionsFromApp(flags)
  const actions = appActions?.actions ?? ONBOARDING_ACTIONS
  const taskOutputs = actions.map((action) => toTaskOutput(action, flags))
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
      automationCommand: getRunCommand(flags),
      summary: {
        total: taskOutputs.length,
        completed: completedTasks.length,
        pending: pendingTasks.length,
        creditsEarned,
        creditsAvailable,
        requiredFirstActionId: CLI_INSTALL_ACTION_ID,
        readyForAutopilot: cliInstalled,
      },
      tasks: taskOutputs,
      pendingCommands: pendingTasks.map((action) => action.command),
      commands: taskOutputs.map((action) => action.command),
    })
    return 0
  }

  printBrandHeader("found your next onboarding moves.")
  section("Progress")
  console.log(
    `${completedTasks.length}/${taskOutputs.length} complete · ${creditsEarned}/${creditsAvailable} credits`
  )

  if (pendingTasks.length > 0) {
    section(cliInstalled ? "Next Best Moves" : "Start Here")
    for (const action of pendingTasks) {
      if (!cliInstalled && action.id !== CLI_INSTALL_ACTION_ID) {
        continue
      }
      console.log(`${ok(action.command.replace(/^npx /, ""))}`)
      console.log(`  ${action.title} (+${action.credits} credits)`)
    }
    if (!cliInstalled) {
      console.log("")
      console.log(warn("The rest unlock after this terminal is authenticated."))
      console.log(dim("Login installs the local agent plugin automatically."))
    }
  }

  if (completedTasks.length > 0) {
    section("Already Done")
    for (const action of completedTasks) {
      console.log(`${ok("done")} ${action.title} (+${action.credits} credits)`)
    }
  }

  console.log("")
  console.log(`Run ${ok("indiecorns run")} and I will walk the queue for you.`)
  console.log(
    `Run ${ok("indiecorns tasks --json")} for automation-friendly output.`
  )
  return 0
}

const runFollow = async (flags, target) => {
  const action = findAction(target)

  if (!action) {
    console.error(fail("Unknown follow task."))
    console.error("Try: indiecorns upvote peerlist")
    console.error("Or:  indiecorns join discord")
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
      url: action.url,
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
  console.log(dim(action.url))
  const savedAction = await withSpinner(
    "Saving this action to your Indiecorns account...",
    () => saveOnboardingActionToApp({ flags, action }),
    ok("Task state saved.")
  )
  if (savedAction?.saved) {
    console.log(ok("Saved this action to your Indiecorns account."))
  }

  if (flags.open === false || flags["no-open"]) {
    console.log(`If the browser does not open, copy this URL: ${action.url}`)
    console.log("After following, return to Indiecorns to continue onboarding.")
    return 0
  }

  if (openUrl(action.url)) {
    console.log(ok("Opened your browser."))
    console.log("After the external action is done, come back and keep going.")
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

  const appActions = await getOnboardingActionsFromApp(flags)
  const statusById = new Map(
    (appActions?.actions ?? []).map((action) => [
      action.id,
      action.status ?? "pending",
    ])
  )
  const results = []

  for (const action of ONBOARDING_ACTIONS) {
    const currentStatus = statusById.get(action.id) ?? "pending"
    if (currentStatus === "completed") {
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

    const savedAction = await saveOnboardingActionToApp({
      flags,
      action,
      status: action.kind === "command" ? "completed" : "opened",
      source: "agent",
    })

    if (action.kind !== "command" && !flags["no-open"] && !flags.agent) {
      openUrl(action.url)
      await sleep(400)
    }

    results.push({
      id: action.id,
      title: action.title,
      status: savedAction?.action?.status ?? "opened",
      saved: Boolean(savedAction?.saved),
      skipped: false,
      url: action.url,
      verification: action.verification,
      verified: false,
      nextCommand: getCompleteCommand(action, flags),
    })
  }

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    ran: results.length,
    results,
    completeAllCommand: `npx indiecorns complete all --app-url ${getAppUrl(flags)}`,
    note: "CLI install is completed automatically from an authenticated CLI session. External follow actions should be marked complete only after they were actually performed on the target platform.",
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
      ? ONBOARDING_ACTIONS.filter((action) => !isProfileAction(action))
      : [findAction(target)].filter(Boolean)

  if (selectedActions.length === 0) {
    console.error(fail("Unknown task to complete."))
    console.error("Try: indiecorns complete peerlist-upvote")
    console.error("Or:  indiecorns complete discord")
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
  const platform = target ?? flags.platform ?? "peerlist"
  const action = findAction(platform)

  if (!action) {
    console.error(fail("Unknown external action to record."))
    console.error("Try: indiecorns record peerlist --target <username>")
    return 1
  }

  const savedEvent = await saveExternalActionEventToApp({
    flags,
    actionId: action.id,
    platform: action.id,
    eventType: "follow",
    status: "followed",
  })

  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    saved: Boolean(savedEvent?.saved),
    event: savedEvent?.event,
    message: savedEvent?.message,
  }

  if (flags.json) {
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
      `Recorded ${output.event?.actor_username ?? "user"} follows ${targetLabel} on ${platform}.`
    )
  )
  return 0
}

const runEvents = async (flags) => {
  const events = await getExternalActionEventsFromApp(flags)
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    events: events?.events ?? [],
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

  console.log(color("Indiecorns external action events", colors.cyan))
  for (const event of output.events) {
    const actor = event.actor_username ?? "user"
    const target =
      event.target_username ??
      event.target_display_name ??
      event.target_profile_url
    console.log(
      `${ok(event.status)} ${actor} ${event.event_type}s ${target} on ${event.platform}`
    )
  }
  return 0
}

const runProfiles = async (flags) => {
  const platform = flags.platform ?? "all"
  const result = await getExternalProfilesFromApp({ ...flags, platform })
  const output = {
    authenticated: Boolean(getCliAuthHeaders()),
    platform: result?.platform ?? platform,
    profiles: result?.profiles ?? [],
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
      console.log(
        `${ok(profile.platform)} @${profile.username} ${profile.profileUrl}`
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
    console.error("Or:  indiecorns profile set website --profile-url <url>")
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
    profile: savedProfile?.profile,
    message: savedProfile?.message,
  }

  if (flags.json) {
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
    console.log(warn(output.message ?? "Profile was not saved."))
    return 1
  }

  console.log(ok(`Saved ${platform} username @${output.profile?.username}.`))
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

const readJsonFile = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return fallback
  }
}

const readEnvFile = (path) => {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=")
          const key = line.slice(0, index)
          const value = line.slice(index + 1).replace(/^['"]|['"]$/g, "")
          return [key, value]
        })
    )
  } catch {
    return {}
  }
}

const getHomePluginInstallPaths = () => ({
  pluginRoot: join(homedir(), "plugins", "indiecorns"),
  marketplacePath: join(homedir(), ".agents", "plugins", "marketplace.json"),
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

const installPluginBundle = () => {
  if (!existsSync(bundledPluginRoot)) {
    return {
      installed: false,
      error: "The Indiecorns plugin bundle is missing from this package.",
    }
  }

  const { pluginRoot, marketplacePath } = getHomePluginInstallPaths()
  rmSync(pluginRoot, { recursive: true, force: true })
  mkdirSync(dirname(pluginRoot), { recursive: true })
  cpSync(bundledPluginRoot, pluginRoot, { recursive: true })
  installPluginMarketplaceEntry(marketplacePath)

  return {
    installed: true,
    pluginRoot,
    marketplacePath,
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
  console.log("Restart Codex so it reloads the local plugin marketplace.")
  return 0
}

const getDoctorReport = () => {
  const pkg = readPackage()
  const npmVersion = spawnSync("npm", ["--version"], { encoding: "utf8" })
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "0",
    10
  )
  const localEnv = readEnvFile(join(appRoot, ".env.local"))
  const vercelEnv = readEnvFile(join(appRoot, ".env.vercel.local"))
  const configuredPosthogKey =
    localEnv.NEXT_PUBLIC_POSTHOG_KEY ??
    vercelEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ??
    process.env.NEXT_PUBLIC_POSTHOG_KEY ??
    process.env.INDIECORNS_POSTHOG_KEY
  const configuredPosthogHost =
    localEnv.NEXT_PUBLIC_POSTHOG_HOST ??
    vercelEnv.NEXT_PUBLIC_POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    process.env.INDIECORNS_POSTHOG_HOST
  const pluginMcp = readJsonFile(join(bundledPluginRoot, ".mcp.json"), {})
  const pluginPosthogUrl = pluginMcp.mcpServers?.posthog?.url

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
    {
      status: configuredPosthogKey === DEFAULT_POSTHOG_KEY ? "ok" : "warn",
      label: "PostHog project key",
      detail: configuredPosthogKey ? "configured for Indiecorns" : "missing",
      audience: "developer",
    },
    {
      status:
        configuredPosthogHost === "https://eu.i.posthog.com" ? "ok" : "warn",
      label: "PostHog EU ingest host",
      detail: configuredPosthogHost ?? "missing",
      audience: "developer",
    },
    {
      status: pluginPosthogUrl === POSTHOG_MCP_URL ? "ok" : "warn",
      label: "PostHog MCP project",
      detail: pluginPosthogUrl ?? "missing from plugin .mcp.json",
      audience: "developer",
    },
  ]

  return { appRoot, packageName: pkg.name, rows }
}

const getUserVisibleDoctorRows = (rows) =>
  rows.filter((row) => row.audience !== "developer")

const runDoctor = (flags) => {
  const report = getDoctorReport()

  if (flags.json) {
    printJson(report)
    return report.rows.some((row) => row.status === "fail") ? 1 : 0
  }

  printBrandHeader("checked this local app checkout.")
  section("Doctor")
  console.log(`App root: ${report.appRoot}`)
  printRows(report.rows)
  return report.rows.some((row) => row.status === "fail") ? 1 : 0
}

const getWizardReport = async (flags) => {
  const appUrl = getAppUrl(flags)
  const doctor = getDoctorReport()
  const agentPlan = await getAgentPlan(flags)
  const config = readConfig()
  const pluginInstallPaths = getHomePluginInstallPaths()
  const pluginInstalled = existsSync(pluginInstallPaths.pluginRoot)
  const authenticated = hasToken() || hasBrowserSession()
  const taskSummary = agentPlan.onboarding

  return {
    app: "indiecorns",
    mode: "cli_first_collective",
    appUrl,
    authenticated,
    authMethod: hasToken() ? "INDIECORNS_TOKEN" : "browser",
    userEmail: config.browserSession?.userEmail,
    doctor,
    plugin: {
      installed: pluginInstalled,
      pluginRoot: pluginInstallPaths.pluginRoot,
      marketplacePath: pluginInstallPaths.marketplacePath,
      installCommand: "npx indiecorns plugin install",
    },
    onboarding: taskSummary,
    commands: {
      login: `npx indiecorns login --app-url ${appUrl}`,
      tasks: `npx indiecorns tasks --app-url ${appUrl}`,
      run: `npx indiecorns run --app-url ${appUrl}`,
      agent: `npx indiecorns agent --app-url ${appUrl}`,
      dashboard: `npx indiecorns dashboard --app-url ${appUrl}`,
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
    step: "analyze",
    status: report.doctor.rows.some((row) => row.status === "fail")
      ? "failed"
      : "ok",
    rows: report.doctor.rows,
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
    return report.doctor.rows.some((row) => row.status === "fail") ? 1 : 0
  }

  const report = await withSpinner(
    "Checking your app, auth, plugin, and onboarding state...",
    () => getWizardReport(flags),
    ok("Workspace scan complete.")
  )

  printBrandHeader(`Wizard v${getCliVersion()}`)
  console.log(dim("Feedback: hello@indiecorns.com"))
  section("Welcome")
  console.log(
    "I am your Indiecorns setup guide. I connect your account, install the local agent plugin, and hand your onboarding tasks to agents safely."
  )
  section("What I Checked")
  console.log("  - Local project health")
  console.log("  - CLI authentication")
  console.log("  - Local agent plugin")
  console.log("  - Live onboarding actions")
  section("Status")
  printRows(getUserVisibleDoctorRows(report.doctor.rows))
  console.log(
    `${report.authenticated ? ok("OK") : warn("WARN")} auth - ${
      report.authenticated
        ? (report.userEmail ?? report.authMethod)
        : "not connected"
    }`
  )
  console.log(
    `${report.plugin.installed ? ok("OK") : warn("WARN")} agent plugin - ${
      report.plugin.installed ? report.plugin.pluginRoot : "not installed yet"
    }`
  )
  console.log(
    `${ok("OK")} onboarding - ${report.onboarding.completed}/${report.onboarding.total} complete, ${report.onboarding.creditsEarned}/${report.onboarding.creditsAvailable} credits`
  )
  console.log("")

  if (!report.authenticated) {
    section("Next")
    console.log(`  ${ok(report.commands.login)}`)
    console.log("  Sign in once. I will install the local agent plugin too.")

    if (process.stdout.isTTY && !flags["no-open"]) {
      console.log("")
      console.log("Starting browser sign-in now.")
      return runBrowserAuth(flags, "login")
    }

    console.log("")
    console.log("For agent or headless use:")
    console.log(`  ${ok("npx indiecorns wizard --ndjson --no-open")}`)
    return 0
  }

  section("Next")
  if (!report.plugin.installed) {
    console.log(`  ${ok(report.commands.pluginInstall)}`)
  }
  console.log(`  ${ok(report.commands.tasks)}`)
  console.log(`  ${ok(report.commands.run)}`)
  console.log(`  ${ok(report.commands.agent)}`)
  console.log("")
  console.log(
    "Agents should use `indiecorns agent` or `indiecorns wizard --ndjson`."
  )
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
      return runWizard(flags)
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
      return runFollow(flags, args[0])
    case "upvote": {
      const target = args[0] ?? "peerlist"
      if (
        target === "peerlist" ||
        target === "launch" ||
        target === "indiecorns"
      ) {
        return runFollow(flags, "peerlist-upvote")
      }
      console.error(fail(`Unknown upvote target: ${target}`))
      console.error("Try: indiecorns upvote peerlist")
      return 1
    }
    case "rate":
    case "rating": {
      console.error(fail("Peerlist rating is not part of the current setup."))
      console.error("Try: indiecorns upvote peerlist")
      console.error("Or:  indiecorns join discord")
      return 1
    }
    case "join":
    case "accept":
    case "invite": {
      const target = args[0] ?? "discord"
      if (
        target === "discord" ||
        target === "server" ||
        target === "community"
      ) {
        return runFollow(flags, "discord")
      }
      console.error(fail(`Unknown invite target: ${target}`))
      console.error("Try: indiecorns join discord")
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
    case "x":
    case "twitter":
      return runFollow(flags, "x")
    case "linkedin":
      return runFollow(flags, "linkedin")
    case "peerlist":
    case "peers":
    case "makers":
      if (args[0] === "profiles" || args[0] === "profile") {
        return runProfiles({ ...flags, platform: "peerlist" })
      }
      return runFollow(flags, "peerlist")
    case "dashboard":
      return runDashboard(flags)
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
    case "doctor":
      return runDoctor(flags)
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
