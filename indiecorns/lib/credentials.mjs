import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { saveState } from './worker.mjs'
const environmentKeys={slack:'INDIECORNS_SLACK_TOKEN',github:'INDIECORNS_GITHUB_TOKEN'}
const validateProvider=provider=>{if (!Object.hasOwn(environmentKeys,provider)) throw new Error('Provider must be slack or github')}
const read=directory=>{
  try{return JSON.parse(readFileSync(join(directory,'credentials.json'),'utf8'))}
  catch(error){if(error.code==='ENOENT')return {};throw error}
}
export function credential(directory,provider,environment=process.env) {
  validateProvider(provider)
  return environment[environmentKeys[provider]] || read(directory)[provider] || null
}
export function storeCredential(directory,provider,value) {
  validateProvider(provider)
  if (value!==null && (typeof value!=='string' || !value || value.length>16384 || /\s/.test(value))) throw new Error('Invalid provider credential')
  mkdirSync(directory,{recursive:true,mode:0o700})
  const values=read(directory)
  if (value===null) delete values[provider];else values[provider]=value
  const path=join(directory,'credentials.json')
  saveState(path,values)
  chmodSync(path,0o600)
  return {provider,configured:value!==null}
}
