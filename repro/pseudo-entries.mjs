// 在仓库根目录跑：node --import tsx repro/pseudo-entries.mjs
import * as cheerio from '../src/index.js'

const HTML = '<div data-bar="1" class="a"><p class="c">1</p></div><div class="b"><span class="c">2</span></div>'

const mk = () => cheerio.load(HTML, { pseudos: { bar: (el) => !!(el.attribs && el.attribs['data-bar']) } })

function show (label, fn) {
  let out
  try {
    const r = fn(mk())
    out = typeof r === 'boolean' ? String(r) : (r && typeof r.length === 'number' ? 'length=' + r.length : String(r))
  } catch (e) {
    out = 'THROWS ' + e.constructor.name + ': ' + String(e.message).slice(0, 46)
  }
  console.log('  ' + label.padEnd(34) + out)
}

console.log('=== 注册过 bar 这个伪类以后，各条入口的读数 ===')
show("$('div:bar')", ($) => $('div:bar'))
show("$.root().find('div:bar')", ($) => $.root().find('div:bar'))
show("$('div').filter(':bar')", ($) => $('div').filter(':bar'))
show("$('div').not(':bar')", ($) => $('div').not(':bar'))
show("$('div').is(':bar')", ($) => $('div').is(':bar'))
show("$('div').has(':bar')", ($) => $('div').has(':bar'))
show("$('div').closest('div:bar')", ($) => $('div').closest('div:bar'))
show("$('p').parent(':bar')", ($) => $('p').parent(':bar'))
show("$('div').children(':bar')", ($) => $('div').children(':bar'))
show("$('div').next(':bar')", ($) => $('div').next(':bar'))
show("$('div').nextAll(':bar')", ($) => $('div').nextAll(':bar'))
show("$('div').nextUntil(':bar')", ($) => $('div').nextUntil(':bar'))
show("$('div').nextUntil('span', ':bar')", ($) => $('div').nextUntil('span', ':bar'))
show("$('div').siblings(':bar')", ($) => $('div').siblings(':bar'))
show("$('div').find(':bar')", ($) => $('div').find(':bar'))

console.log('=== quirksMode 下同一个类名的大小写 ===')
const q = cheerio.load('<div class="FOO"></div><div class="foo"></div><p class="FOO"></p>', { quirksMode: true })
console.log('  $(".FOO")                       length=' + q('.FOO').length)
console.log('  $("div").filter(".FOO")         length=' + q('div').filter('.FOO').length)
console.log('  $("div").is(".FOO")            ' + q('div').first().is('.FOO'))
console.log('  $("div").find(".FOO")           length=' + q('div').find('.FOO').length)
console.log('  $("div").children(".FOO")       length=' + q('body').children('.FOO').length)
