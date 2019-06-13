---
title: '`Intl.RelativeTimeFormat`'
author: 'Mathias Bynens ([@mathias](https://twitter.com/mathias))'
avatars:
  - 'mathias-bynens'
date: 2018-10-22
tags:
  - Intl
  - Node.js 12
  - io19
tweet: '1054387117571354624'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
现代 Web 应用程序通常使用“昨天”，“42秒前”或“3个月”之类的短语，而不是完整的日期和时间戳。这种相对时间格式已经变得非常普遍，以至于几个流行的库都实现了本地化格式化的函数。（例如 [Moment.js](https://momentjs.com/), [Globalize](https://github.com/globalizejs/globalize), [date-fns](https://date-fns.org/docs/)）

实现本地化相对时间格式化的一个问题是，您需要为每种语言提供习惯词或短语列表（例如“昨天”或“上一季度”）。[Unicode CLDR](http://cldr.unicode.org/) 提供了此数据，但要在 JavaScript 中使用它，必须将其嵌入到库代码中一起提供。遗憾的是，这无疑会增加这些库的包大小，这会影响到脚本的加载时间、解析/编译成本和内存消耗。

全新的 `Intl.RelativeTimeFormat` API 将此负担转移到了 JavaScript 引擎，JavaScript 引擎可以提供语言环境数据并使其直接供 JavaScript 开发人员使用。 `Intl.RelativeTimeFormat` 在不牺牲性能的情况下实现相对时间的本地化格式化。

## 用法与示例 {#usage-examples}

以下示例展示了如何使用英语创建相对时间格式化程序。

```js
const rtf = new Intl.RelativeTimeFormat('en');

rtf.format(3.14, 'second');
// → 'in 3.14 seconds'

rtf.format(-15, 'minute');
// → '15 minutes ago'

rtf.format(8, 'hour');
// → 'in 8 hours'

rtf.format(-2, 'day');
// → '2 days ago'

rtf.format(3, 'week');
// → 'in 3 weeks'

rtf.format(-5, 'month');
// → '5 months ago'

rtf.format(2, 'quarter');
// → 'in 2 quarters'

rtf.format(-42, 'year');
// → '42 years ago'
```

需要注意的是传递给 Intl.RelativeTimeFormat 构造函数的参数必须是[一个 BCP 47 语言标记](https://tools.ietf.org/html/rfc5646)，或者是[一个包括多个语言标记的数组](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl#Locale_identification_and_negotiation)。

以下是使用其他语言（汉语简体中文）的示例：（译注：原文是西班牙语）

```js
const rtf = new Intl.RelativeTimeFormat('zh'); // 或 'zh-Hans-CN'

rtf.format(3.14, 'second');
// → '3.14秒钟后'

rtf.format(-15, 'minute');
// → '15分钟前'

rtf.format(8, 'hour');
// → '8小时后'

rtf.format(-2, 'day');
// → '2天前'

rtf.format(3, 'week');
// → '3周后'

rtf.format(-5, 'month');
// → '5个月前'

rtf.format(2, 'quarter');
// → '2个季度后'

rtf.format(-42, 'year');
// → '42年前'
```

此外，`Intl.RelativeTimeFormat` 构造函数还接受一个可选 `options` 参数，该参数可以对输出进行细粒度控制。为了说明灵活性，让我们根据默认设置查看更多输出：

```js
// 创建一个简体中文相对时间格式化示例，使用默认设置。
// 在这个例子中，我们将默认参数显式的传进去
const rtf = new Intl.RelativeTimeFormat('zh', {
 localeMatcher: 'best fit', // 其他值: 'lookup'
 style: 'long', // 其他值: 'short' 或 'narrow'
 numeric: 'always', // 其他值: 'auto'
});

rtf.format(-1, 'day');
// → '1天前'

rtf.format(0, 'day');
// → '0天后'

rtf.format(1, 'day');
// → '1天后'

rtf.format(-1, 'week');
// → '1周前'

rtf.format(0, 'week');
// → '0周后'

rtf.format(1, 'week');
// → '1周后'
```

您可能已经注意到上面的格式化程序生成了字符串 `'1天前'` 而不是 `'昨天'`，还有显得比较弱智的 `'0周后'` 而不是 `'本周'`。发生这种情况是因为默认情况下，格式化程序使用数值进行输出。

要更改此行为，请将 `numeric` 选项设置为 `'auto'`（默认值是 `'always'`）：

```js
// Create a relative time formatter for the English language that does
// not always have to use numeric value in the output.
const rtf = new Intl.RelativeTimeFormat('zh', { numeric: 'auto' });

rtf.format(-1, 'day');
// → '昨天'

rtf.format(-2, 'day');
// → '前天'

rtf.format(0, 'day');
// → '今天'

rtf.format(1, 'day');
// → '明天'

rtf.format(2, 'day');
// → '后天'

rtf.format(-1, 'week');
// → '上周'

rtf.format(0, 'week');
// → '本周'

rtf.format(1, 'week');
// → '下周'
```

与其他 `Intl` 类一样，`Intl.RelativeTimeFormat` 除了 `format` 方法之外，还有一个 `formatToParts` 方法。虽然 `format` 涵盖了最常见的用例，但如果您需要访问生成的输出的各个部分，`formatToParts` 会很有帮助：

```js
// Create a relative time formatter for the English language that does
// not always have to use numeric value in the output.
const rtf = new Intl.RelativeTimeFormat('zh', { numeric: 'auto' });

rtf.format(-1, 'day');
// → '昨天'

rtf.formatToParts(-1, 'day');
// → [{ type: 'literal', value: '昨天' }]

rtf.format(3, 'week');
// → '3周后'

rtf.formatToParts(3, 'week');
// → [
//  { type: 'integer', value: '3', unit: 'week' },
//  { type: 'literal', value: '周后' }
// ]
```

有关其余选项及其行为的详细信息，请参阅 [API docs in the proposal repository](https://github.com/tc39/proposal-intl-relative-time#api).

## 结论 {#conclusion}

`Intl.RelativeTimeFormat` 默认情况下在 V8 v7.1.179 和 Chrome 71 中可用。随着此 API 变得更加广泛可用，您将发现诸如 [Moment.js](https://momentjs.com/), [Globalize](https://github.com/globalizejs/globalize), [date-fns](https://date-fns.org/docs/) 之类的库，会从代码库中移除对硬编码 CLDR 数据库的依赖性，而使用本机相对时间格式化功能，从而提高加载时性能、分析和编译时性能、运行时性能和内存使用。

## `Intl.RelativeTimeFormat` support { #support }

<feature-support chrome="71 /blog/v8-release-71#javascript-language-features"
                 firefox="65"
                 safari="no"
                 nodejs="12 https://twitter.com/mathias/status/1120700101637353473"
                 babel="no"></feature-support>
