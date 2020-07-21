---
title: 'V8 v7.1 发布'
author: 'Stephan Herhut ([@herhut](https://twitter.com/herhut)), cloned cloner of clones'
avatars:
  - stephan-herhut
date: 2018-10-31 15:44:37
tags:
  - release
description: 'V8 v7.1 features embedded bytecode handlers, improved TurboFan escape analysis, postMessage(wasmModule), Intl.RelativeTimeFormat, and globalThis!'
tweet: '1057645773465235458'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
每六周，我们会按照 [V8 的发布流程](/docs/release-process)创建一个新的 V8 分支。在进入 Chrome Beta 里程碑之前，此版本从 V8 的 master 分支创建出来。今天我们很高兴地宣布当前最新的分支异常创建出来了，[V8 version 7.1](https://chromium.googlesource.com/v8/v8.git/+log/branch-heads/7.1)，它将在几个星期内与 Chrome 71 Stable 同时发布。V8 v7.1 包含了各种面向开发者的新特性。这篇文章提供了预期发布的一些功能亮点。

## 内存 {#memory}

在 v6.9/v7.0 中[将内置函数直接以二进制方式嵌入](/blog/embedded-builtins)后，解释器的字节码处理程序现在也[嵌入到二进制文件中](https://bugs.chromium.org/p/v8/issues/detail?id=8068)。每个 Isolate 平均节省大约 200 KB。

## 性能 {#performance}

TurboFan 中的逃逸分析（对局部作用域的对象执行标量替换）得到了改进，当来自周围上下文的变量转移到本地闭包时，它还能够[处理高阶函数的局部函数上下文](https://bit.ly/v8-turbofan-context-sensitive-js-operators)。请考虑以下示例：

```js
function mapAdd(a, x) {
  return a.map(y => y + x);
}
```

注意，这里的 `x` 是局部作用域闭包 `y => y + x` 的自由变量。V8 v7.1 现在可以完全忽略上下文中分配的 `x`，在某些情况下可以提高 40%。

![通过新的逃逸分析提升性能（越低越好）](/_img/v8-release-71/improved-escape-analysis.svg)

逃逸分析现在还能够消除使用变量作为索引访问局部数据的行为。下面是一个例子：

```js
function sum(...args) {
  let total = 0;
  for (let i = 0; i < args.length; ++i)
    total += args[i];
  return total;
}

function sum2(x, y) {
  return sum(x, y);
}
```

请注意，`args` 是 `sum2` 的局部变量（假设 `sum` 被内联进了 `sum2`）。在 V8 v7.1 中，TurboFan 现在可以把 `args` 完全消除，并使用三元操作 `i === 0 ? x : y` 替换变量索引访问操作 `args[i]`。在使用 JetStream/EarleyBoyer 进行基准测试时，性能提高了约 2%。我们将来会继续扩展此优化，使具有两个以上元素的数组也可以进行类似优化。

## Wasm modules 的结构化克隆 {#structured-cloning-of-wasm-modules}

最后，[`postMessage` is supported for Wasm modules](https://github.com/WebAssembly/design/pull/1074)。`WebAssembly.Module` 对象现在可以被 `postMessage` 发送到 web workers。为了更加清晰，这仅限于 web workers（相同的进程，不同的线程），而不能扩展到跨进程场景（例如跨域(cross-origin) `postMessage` 或 shared web workers）。

## JavaScript 语言新特性 {#javascript-language-features}

[`Intl.RelativeTimeFormat` API](/features/intl-relativetimeformat) 可以让我们处理相对时间的本地化格式（例如，“昨天”，“42秒前”或“3个月”），而不牺牲性能。下面是一个例子：

```js
// 创建一个本地化相对时间，中文
const rtf = new Intl.RelativeTimeFormat('zh', { numeric: 'auto' });

rtf.format(-1, 'day');
// → '昨天'

rtf.format(0, 'day');
// → '今天'

rtf.format(1, 'day');
// → '明天'

rtf.format(-1, 'week');
// → '上周'

rtf.format(0, 'week');
// → '本周'

rtf.format(1, 'week');
// → '下周'
```

有关 `Intl.RelativeTimeFormat` 的更多信息，请阅读 Google Web Fundamentals 的 [The Intl.RelativeTimeFormat API](/features/intl-relativetimeformat) 文章，中文翻译版[国际化相对时间格式化API：Intl.RelativeTimeFormat](https://zhuanlan.zhihu.com/p/47417391)。

V8 v7.1 还增加了对 [`globalThis` 提案](https://github.com/tc39/proposal-global)的支持，此提案提供了访问全局对象的通用机制，即使在严格模式的函数或模块中，而不管平台如何。

## V8 API {#v8-api}

请使用 `git log branch-heads/7.0..branch-heads/7.1 include/v8.h` 获取 API 的变更列表。

开发者可以使用 `git checkout -b 7.1 -t branch-heads/7.1` 来使用 V8 v7.1 中的实验性新功能，具体请参阅[使用 Git 获取 V8 源码](/docs/source-code#using-git)。或者，您可以订阅 [Chrome 的 Beta 频道](https://www.google.com/chrome/browser/beta.html) 来尽快尝试新功能。
