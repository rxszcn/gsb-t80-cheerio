# 自定义伪类在各入口的生效情况（pseudos / quirksMode）

本报告只回答一个问题：`cheerio.load(html, { pseudos })` 时注册的自定义伪类（以及
`quirksMode` 这个同样依赖选择器配置的选项），到底在哪些公开入口能走到引擎。

复现脚本：`repro/pseudo-entries.mjs`（`node --import tsx repro/pseudo-entries.mjs`）。
本文所有读数均来自该脚本在本仓库的实际运行，未改动任何实现或测试。

引擎版本（`package.json` 锁定的 node_modules 实际版本）：
`cheerio-select@2.1.0`、`css-select@5.2.2`、`css-what@6.2.2`。

## 一、二十行读数：生效 / 抛错 / 静默（不对）空

注册：`pseudos: { bar: (el) => !!(el.attribs && el.attribs['data-bar']) }`。
HTML 中只有第一个 `<div data-bar="1">` 命中 `:bar`。

### A. 生效（配置真的到了引擎）—— 7 行

| 入口 | 读数 | 走的引擎函数 |
| --- | --- | --- |
| `$('div:bar')` | `length=1` | `select.select` |
| `$.root().find('div:bar')` | `length=1` | `select.select` |
| `$('div').not(':bar')` | `length=1` | `select.filter` |
| `$('div').is(':bar')` | `true` | `select.some` |
| `$('div').nextUntil(':bar')` | `length=1` | `select.is`（仅 until 参数） |
| `$('.FOO')`（quirks） | `length=3` | `select.select` |
| `$('div').is('.FOO')`（quirks） | `true` | `select.some` |

### B. 抛 `Unknown pseudo-class :bar` —— 8 行

| 入口 | 读数 |
| --- | --- |
| `$('div').filter(':bar')` | `THROWS Error: Unknown pseudo-class :bar` |
| `$('div').has(':bar')` | 同上（内部转成 `filter(':has(:bar)')`） |
| `$('div').closest('div:bar')` | 同上 |
| `$('p').parent(':bar')` | 同上 |
| `$('div').children(':bar')` | 同上 |
| `$('div').next(':bar')` | 同上 |
| `$('div').nextAll(':bar')` | 同上 |
| `$('div').siblings(':bar')` | 同上 |

另有一行要单列：

| 入口 | 读数 |
| --- | --- |
| `$('div').nextUntil('span', ':bar')` | `THROWS Error: Unknown pseudo-class :bar` |

这一行证明 `nextUntil` 两个参数走的不是一条路：第一个参数（until 条件）走
`select.is(elem, selector, this.options)`（`src/api/traversing.ts:211`），拿到全量
options 所以生效；第二个参数（filter）走 matcher 的 `filterArray`（同文件
`:128`-`:133`），配置被丢掉，所以抛错。所以 A 类里的 `nextUntil(':bar')` 和这一行
合起来正好是同一方法的两个面。

### C. 不抛错，但结果是“静默”的 —— 4 行

| 入口 | 读数 | 性质 |
| --- | --- | --- |
| `$('div').find(':bar')` | `length=0` | 配置其实到了引擎，0 是**语义正确**的空（两个 div 自身都不是自己的后代，data-bar 在 div 自身） |
| `$('div').filter('.FOO')`（quirks） | `length=1` | 静默错数：quirks 没到引擎，按大写精确匹配，只剩 1 个 |
| `$('div').find('.FOO')`（quirks） | `length=0` | 语义正确的空：find 这一路 quirks 生效（大小写不敏感），但 div 的后代里确实没有类名为 FOO/foo 的元素 |
| `$('body').children('.FOO')`（quirks） | `length=2` | 静默错数：children 这一路 quirks 没到引擎，按大写精确匹配，只剩 2 个 |

所以“静默空”要分两种，不能混为一谈：

- `find` 这一路既认 `pseudos` 也认 `quirksMode`，它给的 0 是**真阴性**，不是丢配置
  造成的假象。区分方法：把查询范围放到真正含命中后代的节点上，`find` 立刻给出非零
  结果（见第四部分的边界脚本：`$.root().find('span:bar')` → `length=1`）。
- `filter` / `children` / `parent` / `next*` / `siblings` / `closest` 这一路给的
  非抛错结果，对自定义伪类是一律抛错（B 类），对 `quirksMode` 则不抛错、静默按
  HTML 区分大小写的规则算，于是数量对不上（3 vs 1，2 vs 2 是因为大写恰好有两个）。

### 同类入口的共同点

- A 类的共同点：选择器被交给引擎时，options 里**带着** `pseudos` / `quirksMode`。
  只有两个来源：
  1. `find` / `_findBySelector` 显式挑出来的 7 个键（`src/api/traversing.ts:90`-
     `:100`）；
  2. 直接把 `this.options`（`InternalOptions` 全量对象）原样传下去的 `is`、`not`，
     以及 `*Until` 的 until 条件。
- B 类的共同点：全部经过 `filterArray(nodes, selector, this.options.xmlMode,
  this._root?.[0])`（`src/api/traversing.ts:789`-`:797`）或 `closest` 里就地组的
  两键对象（`:353`-`:356`），引擎拿到的 options 里没有 `pseudos`，
  `css-select` 查不到名字，在 `node_modules/css-select/lib/pseudo-selectors/index.js:43`
  抛出 `Unknown pseudo-class :name`。
- C 类里两个“错数”的共同点与 B 类完全相同（同一段代码），只是 `quirksMode`
  缺失时 `css-select` 不抛错，而是回落到默认大小写敏感（类名选择器的 `ignoreCase`
  取 `'quirks'`，由 `node_modules/css-select/lib/attributes.js:76` 的
  `!!options.quirksMode` 决定）。

### 一条选择器请求“过几次手”

从公开方法到引擎边界（`cheerio-select` 的导出）的跳数：

- `$('div:bar')`：3 跳 —— `load.ts` 的 `initialize` → `searchContext.find(search)`
  （`src/load.ts:252`）→ `find` → `_findBySelector`（`src/api/traversing.ts:67`）→
  `select.select`（`:102`）。`$.root().find(...)` 少前面 `initialize` 那一跳，是 2 跳。
- `filter`：2 跳 —— `filter`（`:783`-`:786`）→ `filterArray` → `select.filter`
  （`:796`）。`has` 多一跳（`has` 先拼 `:has(...)` 再进 `filter`，`:912`-`:918`）。
- `is`：1 跳 —— `is` 直接调 `select.some(..., this.options)`（`:817`-`:822`）。
- `not`：1 跳 —— `not` 直接调 `select.filter(..., this.options)`（`:867`）。
- `parent/children/next/nextAll/siblings`：3 跳 —— 导出的方法是
  `_matcher/_singleMatcher` 生成的闭包 → `_getMatcher` 里的包装函数
  （`:106`-`:138`）→ `filterArray` → `select.filter`。
- `closest`：1 跳 —— `closest` 直接调 `select.is(elem, selector, selectOpts)`
  （`:360`），但 `selectOpts` 是就地组的两键对象。
- `nextUntil(untilSel, filterSel)` 的 until 条件：`_matchUntil`（`:172`-`:218`）→
  `select.is`（`:211`），2 跳且带全量 options；它的 filter 参数：`_matchUntil` →
  `innerMatcher`（`_getMatcher` 生成）→ `filterArray` → `select.filter`，3 跳且丢配置。

## 二、配置在交给引擎前是怎么被丢掉的

`pseudos` / `quirksMode` 从 `load()` 进来后并没有丢：`flattenOptions`
（`src/options.ts:105`-`:131`）把它们原样并进 `InternalOptions`，每个实例的
`this.options` 都带着（`src/cheerio.ts:64`）。丢配置全部发生在**公开方法组 options
对象的那一刻**，共两种写法、四处代码：

1. `filterArray` 只组两键对象。`src/api/traversing.ts:789`-`:797`：

   ```ts
   export function filterArray<T>(nodes, match, xmlMode?, root?) {
     return typeof match === 'string'
       ? select.filter(match, nodes, { xmlMode, root })
       : nodes.filter(getFilterFn(match));
   }
   ```

   调用方 `filter`（`:785`）和 `_getMatcher` 生成的全部 matcher（`:128`-`:133`）
   只传了 `this.options.xmlMode` 和 `this._root?.[0]` 两个值。`pseudos`、
   `quirksMode`、`lowerCaseTags`、`lowerCaseAttributeNames` 在这里被整体丢掉。
   受害者：`filter`、`has`（经 `filter(':has(...)')`）、`parent`、`parents`、
   `children`、`next`、`nextAll`、`prev`、`prevAll`、`siblings`，以及所有
   `*Until` 的第二个 filter 参数。

2. `closest` 就地另组了一个两键对象。`src/api/traversing.ts:353`-`:356`：

   ```ts
   const selectOpts = {
     xmlMode: this.options.xmlMode,
     root: this._root?.[0],
   };
   ```

   然后 `select.is(elem, selector, selectOpts)`（`:360`）。同样没有 `pseudos`、
   `quirksMode`。

作为对照，全量 options 原样透传的只有两处：

- `is`：`select.some(nodes, selector, this.options)`（`:817`-`:822`）；
- `not`：`select.filter(match, nodes, this.options)`（`:867`）。

`this.options` 是完整的 `InternalOptions`，里面有 `pseudos` 和 `quirksMode`，所以这
两个方法能成。

而 `find` 走的是第三条路：`_findBySelector` 显式列举了选择器相关的 7 个键
（`:90`-`:100`：`context`、`root`、`xmlMode`、`lowerCaseTags`、
`lowerCaseAttributeNames`、`pseudos`、`quirksMode`），`pseudos` 和 `quirksMode`
都在白名单里，所以 `$('...')` 和 `.find(...)` 能成。

**为什么 `is` 与 `not` 能成而 `filter` 与 `closest` 不成**：不是引擎行为不同，是
四个方法各自组 options 时的写法不同。`is`/`not` 直接交全量 `this.options`；
`filter` 经 `filterArray` 只交 `{ xmlMode, root }`，`closest` 自己组了
`{ xmlMode, root }`。引擎在两种情况下收到的输入不同：全量对象时
`compilePseudoSelector` 能在 `options.pseudos[name]` 取到注册函数
（`node_modules/css-select/lib/pseudo-selectors/index.js:24`-`:32`），两键对象时
取不到，连续跳过 string/function/内置 filters/内置 pseudos 四个分支，落到
`:43` 抛 `Unknown pseudo-class :bar`。

## 三、`options.ts` 的示例和文档站站在哪一路；照它收敛会牺牲谁

- `src/options.ts:66`-`:81` 的 JSDoc 示例，以及文档站扩展页
  `website/src/content/docs/advanced/extending-cheerio.md`（“Adding Custom CSS
  Pseudo-Classes”一节），示例代码逐字相同：

  ```js
  const $ = cheerio.load('...', { pseudos: { foo: 'div.foo', bar: (el, val) => ... } });
  $(':foo').length;        // 1
  $('div:bar(boo)').length; // 1
  $('div:bar(baz)').length; // 0
  ```

  这三行验证全部走第一部分 A 类的 `$(...)` → `initialize` → `find` →
  `_findBySelector` → `select.select` 这一路（`src/load.ts:252` →
  `src/api/traversing.ts:102`），即带 7 键白名单的那一路。文档只承诺了这一路，
  没有承诺 `filter`/`closest`/`children` 等方法可用自定义伪类。

- “照它收敛”如果理解为：让所有入口都只按文档示例的语义、用 `_findBySelector`
  那种显式白名单对象（或两键对象）去调引擎，那么被改成抛错的是**现在跑得通的
  `is` 与 `not`**（以及 `*Until` 的 until 条件）。具体说：

  - `$('div').is(':bar')` 现在返回 `true`，收敛后与 `filter(':bar')` 一样抛
    `Unknown pseudo-class :bar`；
  - `$('div').not(':bar')` 现在返回 `length=1`，收敛后同样抛错；
  - `$('div').nextUntil(':bar')` 现在返回 `length=1`，收敛后 until 条件也会抛错
    （它的第二个 filter 参数本来就抛，不变）；
  - quirks 一侧的连带牺牲：`is('.FOO')`、`not('.FOO')` 现在按大小写不敏感得到
    `true` / `length=0`，收敛后会变成静默的大小写敏感结果（`false` / `length=2`），
    不抛错但读数改变。

  反过来，若按 `is`/`not` 的方向收敛（把全量 options 透传给所有入口），则 B 类
  8 行抛错和 C 类两个 quirks 错数会全部消失；文档示例不受任何影响，因为文档示例
  本来就走 find 路。`src` 现有测试没有任何用例引用 `pseudos`
  （`rg "pseudos" src/__tests__ src/__fixtures__` 无命中），所以这不是被测试钉死
  的行为，而是四个方法组 options 时不一致留下的缺口。

## 四、以哪一路为准，以及边界证据

以 `$(...)` / `.find(...)` → `_findBySelector` → `select.select` 这一路为准，理由
有三点：

1. 它是 `load(..., { pseudos })` 注册的伪类唯一**有文档承诺**的入口，`options.ts`
   的 JSDoc 和文档站的例子都只走这一路（见第三部分）。
2. 它是唯一对选择器相关配置做了**完整白名单转发**的入口（`pseudos`、
   `quirksMode`、`lowerCaseTags`、`lowerCaseAttributeNames` 都在
   `src/api/traversing.ts:90`-`:100`）；连 css-select 在编译 `:is()`/`:not()`/
   `:has()` 等子选择器时，`copyOptions` 也是把 `pseudos` 和 `quirksMode` 一并复制
   （`node_modules/css-select/lib/pseudo-selectors/subselects.js:34`-`:46`），与这
   一路的假设一致。
3. 这一路给出的空集合是可证伪的真阴性：把查询范围换到真正含命中后代的节点，结果
   立刻非零。因此 `repro` 里 `$('div').find(':bar')` 的 `length=0` 不能当成“find
   不支持自定义伪类”的证据。

下面的脚本在仓库外（`/tmp/pseudo-boundary/check.mjs`），只通过包的公开入口
`cheerio.load` 访问，挑了四个最难的边界：带参数的自定义伪类在前导位置（命中与落空
各一次）、自定义伪类嵌进 `:not()` / `:has()` 子选择器、quirksMode 在 find 与
`:not()` 子选择器里同时生效，并附两个走瘦对象入口的对照。实际输出：

```text
$.root().find('span:bar')                                        length=1
$('body').find(':barv(1)')                                       length=1
$('div').find(':barv(9)')                                        length=0
$('div').find(':not(:bar)')                                      length=1
$('div:has(:barv(2))')                                           length=1
$('body').find('.c')  (quirks)                                   length=2
$('p,div,span').filter(':not(.c)')  (quirks, find+filter chain)  length=3
control: $('div').filter(':barv(1)')                             THROWS Unknown pseudo-class :barv
control: $('p').closest('div:bar')                               THROWS Unknown pseudo-class :bar
```

读法：

- `find('span:bar')` → 1：repro 里 `$('div').find(':bar')` 的 0 只是作用域里没有
  后代命中，不是伪类没注册；换成确实带 `data-bar` 的后代立刻选到。
- `find(':barv(1)')` → 1 而 `find(':barv(9)')` → 0：前导伪类（selector 以 `:`
  开头）和参数传递在这一路都成立，0 是参数不匹配的真阴性。
- `find(':not(:bar)')` → 1、`$('div:has(:barv(2))')` → 1：自定义伪类穿透进
  css-select 的子选择器编译，证明 options 不只在顶层有效。
- quirks 行的读法：`find('.c')` → 2，说明 find 主体按大小写不敏感把
  `class="c"` 的 `<p>` 和 `class="C"` 的 `<span>` 都选到了；紧接着的
  `find('p,div,span').filter(':not(.c)')` → 3 是最硬的边界，实测剩下的 3 个元素是
  `div.a`、`div.b`、`span.C`。`:not(.c)` 本该在 quirks 下把 `<p class="c">` 和
  `<span class="C">` 都排除（剩 2 个 div），但外层 `.filter(...)` 走瘦对象
  `filterArray`，没带 `quirksMode`；css-select 的 `copyOptions` 只能从它收到的
  options 复制（`node_modules/css-select/lib/pseudo-selectors/subselects.js:34`-
  `:46`），源头没有就复制不出 `quirksMode`，于是内层 `.c` 回落为大小写敏感，只排除
  小写的 `<p>`，大写的 `span.C` 被静默留下。这就是“quirks 走选择和走过滤数量对不
  上”的精确机制：子选择器并不会凭空恢复配置，它只转发上层真的交给引擎的东西。
- 最后两行对照：同样的 `:barv(1)` / `div:bar`，只换入口到 `filterArray` 的
  `{ xmlMode, root }` 和 `closest` 的 `{ xmlMode, root }`，立刻抛
  `Unknown pseudo-class`，反证差异出在入口组 options 的写法，不在伪类本身。

脚本原文（可直接在仓库根目录用 `node --import tsx /tmp/pseudo-boundary/check.mjs`
复跑）：

```js
import * as cheerio from '/home/liuyang/gsb/repos/t80-cheerio/src/index.js'

const HTML = [
  '<div data-bar="1" class="a"><p class="c">1</p></div>',
  '<div class="b"><span data-bar="2" class="C">2</span></div>',
].join('')

const $ = cheerio.load(HTML, {
  quirksMode: true,
  pseudos: {
    bar: (el) => !!(el.attribs && el.attribs['data-bar']),
    barv: (el, val) => !!(el.attribs && el.attribs['data-bar'] === val),
  },
})

const rows = [
  ["$.root().find('span:bar')", () => 'length=' + $.root().find('span:bar').length],
  ["$('body').find(':barv(1)')", () => 'length=' + $('body').find(':barv(1)').length],
  ["$('div').find(':barv(9)')", () => 'length=' + $('div').find(':barv(9)').length],
  ["$('div').find(':not(:bar)')", () => 'length=' + $('div').find(':not(:bar)').length],
  ["$('div:has(:barv(2))')", () => 'length=' + $('div:has(:barv(2))').length],
  ["$('body').find('.c')  (quirks)", () => 'length=' + $('body').find('.c').length],
  ["$('p,div,span').filter(':not(.c)')  (quirks, find+filter chain)", () =>
    'length=' + $('body').find('p,div,span').filter(':not(.c)').length],
  ["control: $('div').filter(':barv(1)')", () => {
    try { return 'length=' + $('div').filter(':barv(1)').length }
    catch (e) { return 'THROWS ' + e.message.slice(0, 34) }
  }],
  ["control: $('p').closest('div:bar')", () => {
    try { return 'length=' + $('p').closest('div:bar').length }
    catch (e) { return 'THROWS ' + e.message.slice(0, 34) }
  }],
]

for (const [label, fn] of rows) console.log(label.padEnd(64), fn())
```
