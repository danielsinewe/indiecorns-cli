import { createReadStream } from "node:fs"

export async function readSupportSettings(flags, stdin = process.stdin) {
  const file = typeof flags.file === "string" && Boolean(flags.file)
  const piped = flags.stdin === true
  if (file === piped || (Object.hasOwn(flags, "file") && !file) ||
      (Object.hasOwn(flags, "stdin") && !piped) || (piped && stdin.isTTY)) {
    throw new Error("Provide your sharing settings using --file <path> or piped --stdin.")
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of file ? createReadStream(flags.file) : stdin) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 8192) throw new Error("Sharing settings exceed 8 KiB.")
      chunks.push(bytes)
    }
  } catch (error) {
    if (error.code) throw new Error("Could not read sharing settings.")
    throw error
  }
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error("Provide sharing settings as a JSON object.")
  }
  const allowed = new Set(["enabled", "provider", "accountId", "organizationId", "channelId", "serviceId", "platforms", "textTemplate"])
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.enabled !== true || value.provider !== "buffer" ||
      Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error("Sharing settings must explicitly enable Buffer and contain only supported settings.")
  }
  return value
}
