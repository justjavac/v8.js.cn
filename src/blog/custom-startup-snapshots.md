---
title: '自定义启动快照'
author: 'Yang Guo ([@hashseed](https://twitter.com/hashseed)), Software Engineer and engine pre-heater supplier'
avatars:
  - 'yang-guo'
date: 2015-09-25 13:33:37
tags:
  - internals
description: 'V8 嵌入器可以利用快照来跳过 JavaScript 程序初始化引起的启动时间。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
JavaScript 规范包括许多内置功能，从[数学函数](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Math)到[全功能的正则表达式引擎](https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions)。每个新创建的 V8 上下文从一开始就具有这些功能。为此，必须在创建上下文时设置全局对象（例如，浏览器中的 window  对象）和所有内置功能并将其初始化到 V8 的堆中。从头开始做这件事需要相当长的时间。

幸运的是，V8 使用了一个快捷方式来加快速度：就像解冻冷冻比萨作为一顿快餐一样，我们将先前准备好的快照直接反序列化到堆中以获得初始化的上下文。在普通台式计算机上，这可以将创建上下文的时间从 40 毫秒缩短到不到 2 毫秒。在普通手机上，这可能意味着 270 毫秒和 10 毫秒之间的差异。

嵌入 V8 的 Chrome 以外的应用程序可能需要的不仅仅是普通的 JavaScript。许多在启动时加载的额外的库脚本，在“实际”应用程序运行之前。例如，一个基于 V8 的简单 TypeScript VM 必须在启动时加载 TypeScript 编译器，以便将 TypeScript 源代码即时转换为 JavaScript。

从两个月前发布的 V8 v4.3 开始，嵌入器（embedders）可以利用快照（snapshotting）来跳过此类初始化引起的启动时间。此功能的[测试用例](https://chromium.googlesource.com/v8/v8.git/+/4.5.103.9/test/cctest/test-serialize.cc#661)展示了此 API 的工作原理。

要创建快照，我们可以调用 `v8::V8::CreateSnapshotDataBlob` 将要嵌入的脚本作为以空字符结尾的 C 字符串。创建新上下文后，将编译并执行此脚本。在我们的示例中，我们创建了两个自定义启动快照，每个快照都在 JavaScript 已经内置的内容之上定义了函数。

然后我们可以使用 `v8::Isolate::CreateParams` 来配置新创建的 isolate，以便它从自定义启动快照初始化上下文。在该 isolate 中创建的上下文是我们从中获取快照的上下文的精确副本。快照中定义的函数无需再次定义即可使用。

对此有一个重要限制：快照只能捕获 V8 的堆。创建快照时，V8 与外部的任何交互都是禁止的。此类互动包括：

- 定义和调用 API 回调（即通过 `v8::FunctionTemplate` 创建的函数）
- 创建类型化数组，因为后备存储可能在 V8 之外分配

当然，一旦捕获快照，从 `Math.random` 或 `Date.now` 等来源派生的值就会固定。它们不再是真正随机的，也不再反映当前时间。

除了限制之外，启动快照仍然是节省初始化时间的好方法。在上面的示例中（在普通台式计算机上），我们可以将启动时花费在加载 TypeScript 编译器上的时间缩短 100 毫秒。我们期待看到你如何使用自定义快照！
