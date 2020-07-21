---
title: 'V8 v7.2 发布'
author: 'Andreas Haas, handler of traps'
avatars:
  - andreas-haas
date: 2018-12-18 11:48:21
tags:
  - release
description: 'V8 v7.2 features high-speed JavaScript parsing, faster async-await, reduced memory consumption on ia32, public class fields, and much more!'
tweet: '1074978755934863361'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
每六周，我们会按照 [V8 的发布流程](/docs/release-process)创建一个新的 V8 分支。在进入 Chrome Beta 里程碑之前，此版本从 V8 的 master 分支创建出来。今天我们很高兴地宣布当前最新的分支异常创建出来了，[V8 version 7.2](https://chromium.googlesource.com/v8/v8.git/+log/branch-heads/7.2)，它将在几个星期内与 Chrome 72 Stable 同时发布。V8 v7.2 包含了各种面向开发者的新特性。这篇文章提供了预期发布的一些功能亮点。

## 内存 {#memory}

现在基于 ia32 架构的平台已经默认开启了对[将内置函数直接以二进制方式嵌入](/blog/embedded-builtins)的支持。

## 性能 {#performance}

### JavaScript 解析 {#javascript-parsing}

平均而言，网页在启动时 V8 用来解析 JavaScript 所花费的时间占了 9.5%。因此，我们在 v7.2 版本中更加专注于为 V8 提供更快的 JavaScript 解析器。我们全面提高了解析速度。从 v7.0 开始，用于桌面的解析速度提高了大约 30%。过去几个月我们对 Facebook 加载网页进行了基准测试，下图显示了解析时间的显着改进。

![V8 在 facebook.com 的解析时间(越低表示越好)](/_img/v8-release-72/facebook-parse-time.png)

我们不仅针对 Facebook，我们的解析器可以用在各种不同的场景下，都有显著的性能提升。下图显示了几个热门网站上最新 v7.2 版本的改进。

![V8 v7.2 解析时间的提升(越低表示越好)](/_img/v8-release-72/relative-parse-times.svg)

总而言之，这次改进将平均解析占比从 9.5% 降低到了 7.5%，从而缩短了加载时间，并提高了响应速度。

### `async`/`await` {#async%2Fawait}

V8 v7.2 带来了[更快的 `async`/`await` 实现](/blog/fast-async#await-under-the-hood)，默认开启。我们提交了[规范提案](https://github.com/tc39/ecma262/pull/1250)，收集了一些 Web 兼容性数据，并且已经正式合并到 ECMAScript 规范中。

### 元素展开语法 {#spread-elements}

当元素展开（spread elements）出现在数组字面量前面时，V8 V7.2 极大地提高了元素展开的性能，例如 `[...x]` 或 `[...x, 1, 2]`。这种改进适用于数组展开，原始字符串，Set，Map keys，Map values，这一切都得益于 `Array.from(x)`。有关更多详细信息，请参阅我们[深入理解如何加速元素展开的文章](/blog/spread-elements)。

### WebAssembly {#webassembly}

我们分析了许多 WebAssembly 基准测试，并使用它们来指导执行层中的代码生成。尤其是 V8 v7.2 优化了编译器的调度程序和后端循环的 node 拆分。我们还改进了包装器缓存并引入了自定义包装器，以减少导入 JavaScript 的 math 函数的开销。此外，我们设计了对寄存器分配器的更改，以改善某些代码模式（code patterns）的性能，这些代码模式将在更高版本中出现。

### Trap handlers {#trap-handlers}

Trap handlers 正在改进 WebAssembly 代码的吞吐量。它们在 V8 v7.2 中的 Windows，macOS 和 Linux 上已经可用。在 Chromium 中，它们在 Linux 上启用。当确认稳定性时，Windows 和 macOS 将会效仿。我们目前正致力于在 Android 上提供它们。

## 异步堆栈跟踪 {#async-stack-traces}

正如[之前所提到的](/blog/fast-async#improved-developer-experience)，我们增加了一个所谓的新功能：[zero-cost async stack traces](https://bit.ly/v8-zero-cost-async-stack-traces)，丰富了异步调用中 `error.stack` 的调用栈信息。此特性目前可使用 `--async-stack-traces` 命令行标志开启。

## JavaScript 语言特性 {#javascript-language-features}

### Public class fields

V8 v7.2 增加了对 [public class fields](/features/class-fields) 的支持。用来代替：

```js
class Animal {
  constructor(name) {
    this.name = name;
  }
}

class Cat extends Animal {
  constructor(name) {
    super(name);
    this.likesBaths = false;
  }
  meow() {
    console.log('Meow!');
  }
}
```

......现在，你可以这样写：

```js
class Animal {
  constructor(name) {
    this.name = name;
  }
}

class Cat extends Animal {
  likesBaths = false;
  meow() {
    console.log('Meow!');
  }
}
```

计划在未来的 V8 版本中支持 [private class fields](/features/class-fields#private-class-fields)。

### `Intl.ListFormat`

V8 v7.2 增加了对 [`Intl.ListFormat` 提案](/features/intl-listformat)的支持，实现了列表的本地化格式。

```js
const lf = new Intl.ListFormat('en');
lf.format(['Frank']);
// → 'Frank'
lf.format(['Frank', 'Christine']);
// → 'Frank and Christine'
lf.format(['Frank', 'Christine', 'Flora']);
// → 'Frank, Christine, and Flora'
lf.format(['Frank', 'Christine', 'Flora', 'Harrison']);
// → 'Frank, Christine, Flora, and Harrison'
```

有关更多信息和用法示例，请查看我们的 [Web 基础知识：`Intl.ListFormat`](/features/intl-listformat)。

### Well-formed `JSON.stringify` {#well-formed-json.stringify}

在之前的 `JSON.stringify` 规范中，如果输入中包含了任何的单独代理(Lone surrogates)，会返回格式错误的 Unicode 字符串（以及 UTF-8 表示形式）：

```js
// Old behavior:
JSON.stringify('\uD800');
// → '"�"'

// New behavior:
JSON.stringify('\uD800');
// → '"\\ud800"'
```

V8 现在实现了一个 [stage 3 提案](/features/well-formed-json-stringify)，该提议改变了 `JSON.stringify` 输出含有单独代理(Lone surrogates)的转义序列的方式，使其输出有效的 Unicode（并以 UTF-8 表示）：

请注意，`JSON.parse(stringified)` 的运行结果仍然和以前一样。

### Module namespace exports {#module-namespace-exports}

在 [JavaScript 模块](/features/modules) 中，已经可以使用以下语法：

```js
import * as utils from './utils.mjs';
```

但是，之前没有对应的 `export`语法...... [直到现在](/features/module-namespace-exports)：

```js
export * as utils from './utils.mjs';
```

这相当于以下内容：

```js
import * as utils from './utils.mjs';
export { utils };
```

## V8 API

请使用 `git log branch-heads/7.1..branch-heads/7.2 include/v8.h` 获取 API 的变更列表。

开发者可以使用 `git checkout -b 7.2 -t branch-heads/7.2` 来使用 V8 v7.2 中的实验性新功能，具体请参阅[使用 Git 获取 V8 源码](/docs/source-code#using-git)。或者，您可以订阅 [Chrome 的 Beta 频道](https://www.google.com/chrome/browser/beta.html) 来尽快尝试新功能。
