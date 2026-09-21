# 自定义伪类（`pseudos`）在各入口的真实生效情况

复现脚本：`node --import tsx repro/pseudo-entries.mjs`（仓库根目录）。下面所有读数都来自这次实际运行，代码位置以行号点名。

## 一、二十行读数的三类分法

### 生效（7 行）

| 调用 | 读数 |
| --- | --- |
| `$('div:bar')` | `length=1` |
| `$.root().find('div:bar')` | `length=1` |
| `$('div').not(':bar')` | `length=1` |
| `$('div').is(':bar')` | `true` |
| `$('div').nextUntil(':bar')` | `length=1` |
| `$(".FOO")`（quirksMode） | `length=3` |
| `$("div").is(".FOO")`（quirksMode） | `true` |

### 抛错（9 行，全部是 `Error: Unknown pseudo-class :bar`）

`$('div').filter(':bar')`、`$('div').has(':bar')`、`$('div').closest('div:bar')`、`$('p').parent(':bar')`、`$('div').children(':bar')`、`$('div').next(':bar')`、`$('div').nextAll(':bar')`、`$('div').nextUntil('span', ':bar')`、`$('div').siblings(':bar')`。

### 静默空 / 静默错数（4 行，不报错但读数不是用户要的）

| 调用 | 读数 | 原因 |
| --- | --- | --- |
| `$('div').find(':bar')` | `length=0` | 选项其实送到了引擎；空是因为 `find` 只在后代里找，两个 div 的后代（p、span）都没有 `data-bar`。语义正确的空，但不声不响。 |
| `$("div").filter(".FOO")` | `length=1` | `quirksMode` 在转手时被丢，类名退回大小写敏感；quirksMode 下应为 2。 |
| `$("div").find(".FOO")` | `length=0` | div 没有子元素，语义正确的空。 |
| `$("div").children(".FOO")` | `length=2` | `quirksMode` 被丢；body 下 3 个带类子元素只匹配了 2 个大写 `FOO`，quirksMode 下应为 3。 |

### 同类入口的共同点

- **生效类**分两种内部形态，但都把 `pseudos`/`quirksMode` 原样送进了 cheerio-select：要么走 `_findBySelector` 的白名单对象（`$()`、`find`），要么把 `this.options` 整个漏给引擎（`is`、`not`、`*Until` 的停止选择器）。
- **抛错类**全部在把配置交给引擎之前手工新组了一个只含 `xmlMode` 和 `root` 两个键的对象，`pseudos` 和 `quirksMode` 根本没上车。
- **静默类**里，`filter(".FOO")` 和 `children(".FOO")` 与抛错类同一条路（两键对象），只是类名大小写不匹配不抛错，所以表现为数量对不上；两个 `find` 的空是后代语义，不是选项丢失。

### 一条选择器请求过几次手

- `$('div:bar')`：`initialize`（src/load.ts:252，`searchContext.find(search)`）→ `find`（src/api/traversing.ts:67）→ `_findBySelector`（src/api/traversing.ts:79）→ `select.select`（cheerio-select）→ css-select。cheerio 内部 3 次转手。
- `filter`：`filter`（traversing.ts:785）→ `filterArray`（traversing.ts:789）→ `select.filter`（traversing.ts:796）。内部 2 次。
- `parent/children/next/nextAll/siblings`：`_getMatcher` 生成的闭包 → 闭包内调 `filterArray`（traversing.ts:128）→ `select.filter`。内部 2 次。
- `closest`：`closest` → `select.is`（traversing.ts:360）。只过 1 次手，但选项是手工两键对象（traversing.ts:353）。
- `is`：`is` → `select.some`（traversing.ts:818），1 次手，整个 `this.options` 传入。
- `not`：`not` → `select.filter`（traversing.ts:867），1 次手，整个 `this.options` 传入。
- `nextUntil`：停止选择器走 `select.is(elem, selector, this.options)`（traversing.ts:211）；过滤选择器走 `innerMatcher` → `filterArray`（traversing.ts:128）。**同一个方法的两个参数走两条不同的路**，这就是 `nextUntil(':bar')` 能跑而 `nextUntil('span', ':bar')` 抛错的原因。

## 二、选项在哪几处被丢，为什么 is/not 成而 filter/closest 不成

丢选项的位置只有两处，都是"把配置交给引擎前手工组了个带两个键的对象"：

1. `filterArray`，src/api/traversing.ts:796：`select.filter(match, nodes, { xmlMode, root })`。`filter`、`has`（先拼 `:has(...)` 再走 `filter`，traversing.ts:893）以及所有 `_getMatcher` 系方法（`parent`、`parents`、`children`、`next`、`nextAll`、`prev`、`prevAll`、`siblings`、`*Until` 的过滤参数）都汇到这里。
2. `closest`，src/api/traversing.ts:353-355：`selectOpts = { xmlMode: this.options.xmlMode, root: this._root?.[0] }`，自产自销，不经过 `filterArray`。

对照组 `_findBySelector`（traversing.ts:90-100）组的是七键白名单：`context`、`root`、`xmlMode`、`lowerCaseTags`、`lowerCaseAttributeNames`、`pseudos`、`quirksMode`——cheerio-select 认的键一个不少，所以 `$()` 和 `find` 从不丢。

`is` 与 `not` 能成，是因为它们根本不组新对象：`is` 把 `this.options`（整个 `InternalOptions`）直接塞给 `select.some`（traversing.ts:818），`not` 同样塞给 `select.filter`（traversing.ts:867），`*Until` 的停止选择器塞给 `select.is`（traversing.ts:211）。`InternalOptions` 里天然带着 `pseudos` 和 `quirksMode`，cheerio-select 只读自己认的键，多出来的解析器键（`decodeEntities` 之类）被无视。也就是说这一组能跑是"全量泄漏"的副产品，不是有意设计；`filter` 与 `closest` 不成，是因为它们显式组对象时只挑了 `xmlMode` 和 `root` 两个键。

## 三、文档站在哪一路，照它收敛的代价

src/options.ts:56-77 的 `pseudos` 示例和 website/src/content/docs/advanced/extending-cheerio.md 的"Adding Custom CSS Pseudo-Classes"一节，全部用例都是 `$(':foo')`、`$('div:bar(boo)')` 这种顶层 `$()` 调用——站在 `_findBySelector` 白名单路上，没有任何一个示例走 `filter`/`is`/`closest`。

照它收敛的含义是：文档只承诺 `$()` 选择入口，其余入口按仓库里现成的"显式组对象"先例统一——而那个先例就是 `filterArray`/`closest` 的两键对象。一旦这样统一，现在靠"泄漏整个 `this.options`"才跑得通的那一类会立刻改成抛 `Unknown pseudo-class`：`is`、`not`，以及 `nextUntil`/`prevUntil`/`parentsUntil` 的停止选择器参数。quirksMode 同理，`$("div").is(".FOO")` 这类现在碰巧正确的读数会退回大小写敏感。也就是说，按文档收敛不是"修好九处抛错"，而是先把生效类里的泄漏组拉下水。

## 四、以哪一路为准，以及边界证据

以 `_findBySelector` 白名单路（`$()` / `find` / `$.root().find`）为准。理由三条：

1. 它是全仓库唯一一处把 cheerio-select 认的五个选项键（`xmlMode`、`lowerCaseTags`、`lowerCaseAttributeNames`、`pseudos`、`quirksMode`）显式列全的地方（traversing.ts:90-100），是有维护意图的契约，不是巧合。
2. options.ts 的示例和扩展文档都站在它上面，用户照文档写代码命中的就是这条路。
3. 全量泄漏路把解析器专用的键一起塞给选择引擎，能跑是副作用；两键路是明确的不完整。要统一，方向只能是把白名单推广到 `filterArray` 和 `closest`，而不是反过来。

### 仓库外验证脚本

放在 `/tmp/pseudo-canonical.mjs`（不在仓库内），从仓库根目录用 `node --import tsx /tmp/pseudo-canonical.mjs` 运行。最难的边界选的是：`quirksMode` 的类名大小写折叠和带参数的自定义伪类挤在同一条复合选择器里——两个选项必须同时到达引擎，缺任何一个读数都会变。

```js
// 仓库外脚本：只验证 $()/find 这条“白名单”路在最难边界上读到什么
import * as cheerio from '/home/liuyang/gsb/repos/t80-cheerio/src/index.js'

const HTML = '<div class="FOO" data-bar="x"><span class="FOO" data-bar="x">s</span></div><div class="foo">b</div>'
const $ = cheerio.load(HTML, {
  quirksMode: true,
  pseudos: { bar: (el, v) => el.attribs['data-bar'] === v },
})

console.log("$('div.foo:bar(x)')             length=" + $('div.foo:bar(x)').length)
console.log("$.root().find('div.foo:bar(x)')   length=" + $.root().find('div.foo:bar(x)').length)
console.log("$('div span.foo:bar(x)')          length=" + $('div span.foo:bar(x)').length)
try {
  console.log("$('div').filter('.foo:bar(x)')   length=" + $('div').filter('.foo:bar(x)').length)
} catch (e) {
  console.log("$('div').filter('.foo:bar(x)')   THROWS " + e.message)
}
```

实际输出：

```text
$('div.foo:bar(x)')             length=1
$.root().find('div.foo:bar(x)')   length=1
$('div span.foo:bar(x)')          length=1
$('div').filter('.foo:bar(x)')   THROWS Unknown pseudo-class :bar
```

读数解读：`div.foo` 命中的必须是 `class="FOO"` 且带 `data-bar="x"` 的那个 div——`quirksMode` 没到会匹配成另一个没有 `data-bar` 的 div 而得到 0，`pseudos` 没到会抛错。`length=1` 证明两个选项在这条路上同时活着；同一条选择器换 `filter` 入口立刻抛错，证明边界确实卡在选项转手处而不是选择器本身。
