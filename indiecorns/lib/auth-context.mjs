import {createHash} from 'node:crypto'
export function credentialContext(headers) {
  const names=new Set(['authorization','x-indiecorns-cli-session','x-indiecorns-cli-secret'])
  return Object.entries(headers??{}).filter(([key])=>names.has(key.toLowerCase())).map(([key,value])=>[key.toLowerCase(),value]).sort(([a],[b])=>a.localeCompare(b))
}
export const credentialRevision=headers=>createHash('sha256').update(JSON.stringify(credentialContext(headers))).digest('hex')
