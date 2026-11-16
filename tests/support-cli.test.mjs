import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

const cli = fileURLToPath(new URL("../indiecorns/bin/indiecorns.mjs", import.meta.url))
const appUrl = "https://app.indiecorns.com"
const url = "https://peerlist.io/maker/project/launch"

function fixture(t, member) {
  const home = mkdtempSync(join(tmpdir(), "indiecorns-support-cli-"))
  t.after(() => rmSync(home, { recursive:true, force:true }))
  const configDir = join(home, ".indiecorns")
  const directory = join(configDir, "worker")
  mkdirSync(directory, {recursive:true})
  const actorId = `member_${member}`
  const accountId = `buffer_${member}`
  const organizationId = `org_${member}`
  const channelId = `channel_${member}`
  const serviceId = `service_${member}`
  const slackUserId = `UREADER${member.toUpperCase()}`
  const token = `buffer-token-${member}`
  const config = join(configDir, "config.json")
  const readRequests = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : []
  const signIn = (actor = actorId) => writeFileSync(config, JSON.stringify({
    browserSession:{ appUrl, userId:actor, cliSessionId:`session_${actor}`, cliSecret:`secret_${actor}` },
  }))
  signIn()
  const calls = join(home, "calls.jsonl")
  const providerPost = join(home, "post.json")
  const newRequest = join(home, "new-request.txt")
  const oldRequestTime = Date.now() - 60000
  const stub = join(home, "stub.mjs")
  writeFileSync(stub, `
    import assert from "node:assert/strict"
    import {appendFileSync,existsSync,readFileSync,writeFileSync} from "node:fs"
    const calls=${JSON.stringify(calls)}, providerPost=${JSON.stringify(providerPost)}
    const actorId=${JSON.stringify(actorId)}, token=${JSON.stringify(token)}
    const channel={id:${JSON.stringify(channelId)},organizationId:${JSON.stringify(organizationId)},serviceId:${JSON.stringify(serviceId)},
      name:"Fixture channel",service:"linkedin",isDisconnected:false,isLocked:false,isQueuePaused:false,allowedActions:["scheduleUpdates"]}
    const account={id:${JSON.stringify(accountId)},organizations:[{id:channel.organizationId}]}
    const link=${JSON.stringify(url)}
    const day=86400000
    const slackUserId=${JSON.stringify(slackUserId)}, newRequest=${JSON.stringify(newRequest)}
    const makeRequest=(id,createdAt,targetUrl,requestedActions=["share"])=>({id:id.repeat(64),platform:"peerlist",requesterSlackUserId:"UMAKER",
      source:"slack_launch_request",createdAt,expiresAt:createdAt+7*day,requestedActions,
      status:"review_available",targetUrl,ownershipVerified:false})
    globalThis.fetch=async (input, options={})=>{
      const target=new URL(input)
      const method=options.method||"GET"
      if(target.origin===${JSON.stringify(appUrl)}){
        appendFileSync(calls,JSON.stringify({path:target.pathname,method})+"\\n")
        if(target.pathname.endsWith("/action-targets"))return Response.json({targets:[],pagination:{hasMore:false,nextCursor:null}})
        if(target.pathname.endsWith("/worker-feed")&&method==="POST")return Response.json({accepted:true,task:null})
        if(target.pathname.endsWith("/worker-feed")&&target.searchParams.get("support")==="1"){
          assert.equal(new Headers(options.headers).get("x-indiecorns-cli-session"),"session_"+actorId)
          const now=Date.now()
          const recent=existsSync(newRequest)?JSON.parse(readFileSync(newRequest,"utf8")):{}
          return Response.json({version:1,targets:[],cursor:"",latest:"0.000000",
            snapshot:{version:1,workspaceId:"TTEST",channelId:"CTEST",observedAt:now,expiresAt:now+day,memberIds:["UMAKER",slackUserId],identities:[]},
            support:{version:1,actorId,memberSlackUserId:slackUserId,status:"ready",observedAt:now,expiresAt:now+300000,requests:[
              makeRequest("a",${oldRequestTime},"https://peerlist.io/maker/project/old-launch"),
              ...(recent.vote?[makeRequest("c",recent.vote,"https://peerlist.io/maker/project/vote-only",["upvote"])]:[]),
              ...(recent.share?[makeRequest("b",recent.share,link)]:[])
            ]}
          })
        }
      }
      if(target.origin==="https://api.buffer.com"){
        assert.equal(method,"POST")
        assert.equal(new Headers(options.headers).get("authorization"),"Bearer "+token)
        const body=JSON.parse(options.body)
        const operation=body.operationName || /(?:query|mutation)\\s+(\\w+)/.exec(body.query)?.[1]
        appendFileSync(calls,JSON.stringify({operation,variables:body.variables})+"\\n")
        if(operation==="IndiecornsBufferAccount")return Response.json({data:{account}})
        if(operation==="IndiecornsBufferChannels")return Response.json({data:{channels:[channel]}})
        if(operation==="IndiecornsBufferChannel")return Response.json({data:{channel}})
        if(operation==="IndiecornsBufferShare"){
          const input=body.variables.input
          assert.equal(input.channelId,channel.id)
          const post={id:"post_"+account.id,channelId:channel.id,text:input.text,status:"sent",sentAt:new Date().toISOString()}
          writeFileSync(providerPost,JSON.stringify(post))
          return Response.json({data:{createPost:{__typename:"PostActionSuccess",post:{id:post.id,channelId:post.channelId}}}})
        }
        if(operation==="IndiecornsBufferPost")return Response.json({data:{post:JSON.parse(readFileSync(providerPost,"utf8"))}})
      }
      throw new Error("Unexpected fixture request")
    }
  `)
  const settings = {
    enabled:true,provider:"buffer",accountId,organizationId,channelId,serviceId,
    platforms:["peerlist"], textTemplate:`Picked by member ${member}: {url}`,
  }
  const env = {
    ...process.env, HOME:home, USERPROFILE:home, INDIECORNS_TOKEN:"", INDIECORNS_GITHUB_TOKEN:"",
    INDIECORNS_PRODUCTHUNT_TOKEN:"", INDIECORNS_SLACK_TOKEN:"", INDIECORNS_BUFFER_TOKEN:"", INDIECORNS_TELEMETRY_DISABLED:"1",
  }
  const invoke = (args, input) => spawnSync(process.execPath, [
    "--import", pathToFileURL(stub).href, cli, "worker", ...args, "--json", "--no-telemetry",
  ], {env,input,encoding:"utf8",timeout:20000})
  const ok = (args,input) => {
    const result = invoke(args,input)
    assert.equal(result.status,0,result.stderr)
    return JSON.parse(result.stdout)
  }
  const configuration = (input = settings) => ok(["support","configure","--stdin"],JSON.stringify(input))
  const run = () => ok(["run","--once"])
  const writes = () => readRequests().filter(r=>r.operation==="IndiecornsBufferShare")
  const state = () => JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))
  const resetFeed = () => {
    const previous = state()
    previous.communityFeed.nextPollAt = 0
    previous.priorityNextPollAt = 0
    writeFileSync(join(directory,"state.json"),JSON.stringify(previous))
  }
  const newLaunch = action => {
    const requests = existsSync(newRequest) ? JSON.parse(readFileSync(newRequest,"utf8")) : {}
    requests[action] = Date.now()
    writeFileSync(newRequest,JSON.stringify(requests))
  }
  return {settings,token,signIn,invoke,ok,configuration,run,writes,state,resetFeed,readRequests,newLaunch}
}

test("two member CLI workers publish to their own opted-in destination and do not resend on restart", t => {
  const members = [fixture(t,"a"),fixture(t,"b")]
  for (const own of members) {
    own.ok(["credentials","--provider","buffer","--token-stdin"],own.token)
    assert.deepEqual(own.ok(["support","destinations"]).destinations.map(d=>d.channelId),[own.settings.channelId])
    own.run()
    assert.equal(own.writes().length,0,"a connected credential is not consent")
  }
  assert.equal(members[0].invoke(["support","configure","--stdin"],JSON.stringify(members[1].settings)).status,1)
  for (const own of members) {
    own.configuration()
    assert.equal(own.ok(["policy"]).mode,"draft","support sharing must not enable unrelated actions")
    own.run()
    assert.equal(own.writes().length,0,"the inbox catch-up cannot publish a request made before opt-in")
    own.newLaunch("vote")
    own.resetFeed()
    own.run()
    assert.equal(own.writes().length,0,"a vote-only request cannot trigger sharing")
    own.ok(["policy","--mode","collect"])
    own.newLaunch("share")
    own.resetFeed()
    own.run()
    assert.equal(own.writes().length,0,"collect mode stops new shares")
    const collecting = own.ok(["support"])
    assert.equal(collecting.automaticExternalActions,false)
    assert.equal(collecting.sharing.status,"paused_by_collect_mode")
    assert.equal(own.ok(["status"]).support.automaticExternalActions,false)
    own.ok(["policy","--mode","draft"])
    own.resetFeed()
    own.run()
    const [write] = own.writes()
    assert.equal(own.writes().length,1)
    assert.equal(write.variables.input.channelId,own.settings.channelId)
    assert.equal(write.variables.input.text,own.settings.textTemplate.replace("{url}",url))
    assert.equal(own.readRequests().filter(r=>r.operation==="IndiecornsBufferPost").length,1)
    assert.equal(own.state().actionBudget.attempts,1)
    const support = own.ok(["support"])
    assert.equal(support.automaticExternalActions,true)
    assert.equal(support.sharing.action,"share")
    assert.equal(support.sharing.counts.sent, 1)
    assert.equal(support.sharing.receipts[0].postId, `post_${own.settings.accountId}`)
    assert.equal(support.sharing.receipts[0].requestId, "b".repeat(64))
    assert.equal(support.sharing.receipts[0].action,"share")
    assert.doesNotMatch(JSON.stringify(own.ok(["status"])), /post_buffer_|Picked by member/)
    own.run()
    assert.equal(own.writes().length,1)
    own.signIn("another_member")
    const other = own.ok(["support"])
    assert.equal(other.count,0)
    assert.equal(other.automaticExternalActions,false)
    assert.doesNotMatch(JSON.stringify(other), /post_buffer_/)
    assert.equal(own.ok(["policy"]).supportSharing,undefined)
    own.signIn()
    const paused = own.ok(["support","pause"])
    assert.equal(paused.enabled,false)
    assert.equal(paused.counts.sent,1)
    const bufferReads = own.readRequests().filter(record=>record.operation).length
    own.resetFeed()
    own.run()
    assert.equal(own.writes().length,1)
    assert.equal(own.readRequests().filter(record=>record.operation).length, bufferReads)
    assert.equal(own.ok(["policy"]).mode,"draft")
  }
})
