import {setTimeout as sleep} from 'node:timers/promises'

// Pixel silhouette and cyan/pink/yellow mane from the Indiecorns brand mark:
// platform/public/brand/indiecorns-mark.png in Indiecorns/indiecorns.
const pixels = [
  ' #                     ',
  '#y#    ##              ',
  '#yy####cp##            ',
  ' #y#www#cpy#           ',
  '  ##wggg#cpy#          ',
  '  #ww#gg#cpy#          ',
  ' #wgggggg#cpy#         ',
  '#wwgggggg#cpy#         ',
  '#wggg#ggg#ccpy#      # ',
  '#wgg#ggggg#######   #p#',
  ' ###ggggggggggggg###cp#',
  '    #gggggggggggggg#cp#',
  '   #ggggggggggggggg#cp#',
  '   #ggggggggggggggg#cy#',
  '    #gggggggggggggg##y#',
  '     #gggg####gggg#  # ',
  '     #ggg#    #ggg#    ',
  '     #gg#     #gg#     ',
  '     #cc#     #cc#     ',
  '     #cc#     #cc#     ',
  '      ##       ##      ',
]
const palette = {'#':'100;116;139', y:'255;218;92', c:'154;239;252', p:'255;198;197', w:'255;255;255', g:'224;222;222'}
const reset = '\x1b[0m'
const truthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

export function introOptions({command,args=[],flags={},env=process.env,stdout=process.stdout,stdin=process.stdin,agentHost=false}={}) {
  const entry = command === undefined || ['start','help','intro','wizard','-h'].includes(command) || command==='worker' && args[0]==='setup'
  const show = Boolean(entry && stdout.isTTY && stdin.isTTY && !agentHost && !env.CI && env.TERM!=='dumb' &&
    !flags.json && !flags.ndjson && !flags.agent && !flags['no-intro'] && !truthy(env.INDIECORNS_NO_INTRO))
  const color = !Object.hasOwn(env,'NO_COLOR') && env.TERM!=='dumb'
  const reduced = truthy(env.REDUCE_MOTION) || truthy(env.INDIECORNS_REDUCED_MOTION)
  return {show,color,animate:show && color && !reduced && !flags['no-animation'],compact:(stdout.columns??80)<66 || (stdout.rows??24)<19}
}

export function introFrame({color=true,compact=false,phase=2,version=''}={}) {
  if(compact || !color) return `\n  /\u005c  Indiecorns${version ? '  v'+version : ''}\n <  '> Build together. Go further.\n  \/\n\n`
  const captions = {3:`\x1b[1mIndiecorns${reset}`,4:'Build together. Go further.',6:`\x1b[2mCommunity CLI${version?' / v'+version:''}${reset}`}
  const lines=[]
  const paint=(cell,x)=>palette[cell]&&'cpy'.includes(cell)&&phase<2&&x>phase*8?palette.g:palette[cell]
  for(let y=0;y<pixels.length;y+=2) {
    let row='  '
    for(let x=0;x<23;x++) {
      const upper=pixels[y][x],lower=pixels[y+1]?.[x]??' '
      const fg=paint(upper,x),bg=paint(lower,x)
      row+=reset+(fg?`\x1b[38;2;${fg}m`:'')+(bg?`\x1b[48;2;${bg}m`:'')+(fg?'▀':bg?'▄':' ')
      // For a bottom-only pixel, its foreground must be the bottom colour.
      if(!fg && bg) row=row.slice(0,-1)+`\x1b[38;2;${bg}m\x1b[49m▄`
    }
    row+=reset+'    '+(captions[y/2]??(y===0?['·','✦','✧'][phase]+'  '+ '\x1b[2mOne herd. More momentum.'+reset:''))
    lines.push(row)
  }
  return '\n'+lines.join('\n')+'\n\n'
}

export async function showTerminalIntro(options={}) {
  const settings=introOptions(options)
  if(!settings.show)return false
  const output=options.stdout??process.stdout
  const frame=phase=>introFrame({...settings,phase,version:options.version})
  output.write(frame(0))
  if(settings.animate && !settings.compact) {
    // A bounded 160 ms sparkle. No hidden cursor, raw input mode or listeners
    // to leak on Ctrl-C. Finish before the command begins writing output.
    for(const phase of [1,2]) {
      await (options.wait??sleep)(80)
      output.write('\x1b[12A\r'+frame(phase).slice(1))
    }
  }
  return true
}
