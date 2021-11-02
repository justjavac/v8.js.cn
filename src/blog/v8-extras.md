---
title: 'V8 extras'
author: 'Domenic Denicola ([@domenic](https://twitter.com/domenic)), Streams Sorcerer'
avatars:
  - 'domenic-denicola'
date: 2016-02-04 13:33:37
tags:
  - internals
description: 'V8 v4.8 包括 V8 extras，这是一个简单的接口，旨在允许嵌入者编写高性能、self-hosted 的 API。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 用 JavaScript 本身实现了 JavaScript 语言内置（built-in）对象和函数的很大一部分。例如，你可以看到我们的 [promises 实现](https://code.google.com/p/chromium/codesearch#chromium/src/v8/src/js/promise.js) 是用 JavaScript 编写的。此类内置程序称为 _self-hosted_。这些实现包含在我们的 [启动快照](/blog/custom-startup-snapshots) 中，因此可以快速创建新的上下文，而无需在运行时设置和初始化 self-hosted 内置程序。

V8 的嵌入者，例如 Chromium，有时也希望用 JavaScript 编写 API。这对于 self-contained 的平台功能（如 [streams](https://streams.spec.whatwg.org/)）或作为在预先存在的较低级别功能之上构建的较高级别功能的“分层平台”的一部分的功能特别有效。尽管总是可以在启动时运行额外的代码来引导嵌入器 API（例如在 Node.js 中所做的），但理想情况下，嵌入器应该能够获得与 V8 相同的 self-hosted API 的速度优势。

从我们的 [v4.8 版本](/blog/v8-release-48) 开始，V8 extras 是 V8 的一个新特性，其设计目标是允许嵌入者通过一个简单的接口编写高性能、自托管的 API。 Extras 是嵌入器提供的 JavaScript 文件，它们被直接编译到 V8 快照中。它们还可以访问一些辅助实用程序，从而可以更轻松地在 JavaScript 中编写安全的 API。

## 例子 { #an-example }

V8 extra 文件只是一个具有特定结构的 JavaScript 文件：

```js
(function(global, binding, v8) {
  'use strict';
  const Object = global.Object;
  const x = v8.createPrivateSymbol('x');
  const y = v8.createPrivateSymbol('y');

  class Vec2 {
    constructor(theX, theY) {
      this[x] = theX;
      this[y] = theY;
    }

    norm() {
      return binding.computeNorm(this[x], this[y]);
    }
  }

  Object.defineProperty(global, 'Vec2', {
    value: Vec2,
    enumerable: false,
    configurable: true,
    writable: true
  });

  binding.Vec2 = Vec2;
});
```

这里有几点需要注意：

- `global` 对象不存在于作用域链中，因此对它的任何访问（例如对 `Object` 的访问）都必须通过提供的 `global` 参数显式完成。
- `binding` 对象是为嵌入器存储值或从嵌入器检索值的地方。C++ API `v8::Context::GetExtrasBindingObject()` 提供了从嵌入器端访问 `binding` 对象的方法。在我们的玩具示例中，我们让嵌入器执行范数计算；在一个真实的例子中，你可能会委托嵌入器来做一些更棘手的事情，比如 URL 解析。我们还将 `Vec2` 构造函数添加到 `binding` 对象，以便嵌入器代码可以创建 `Vec2` 实例而无需通过潜在可变的 `global` 对象。
- `v8` 对象提供了少量 API 以允许您编写安全代码。在这里，我们创建了私有符号来以无法从外部操纵的方式存储我们的内部状态。 （私有符号是 V8 内部的概念，在标准 JavaScript 代码中没有意义。）V8 的内置函数经常使用 “%-function calls” 来处理这类事情，但 V8 的 extras  不能使用 %-function，因为它们是一个 V8 的内部实现细节，不适合嵌入器依赖。

你可能对这些对象的来源感到好奇。所有这三个都在 [V8 的引导程序](https://code.google.com/p/chromium/codesearch#chromium/src/v8/src/bootstrapper.cc) 中初始化，它安装了一些基本属性，但主要将初始化留给 V8 的 self-hosted JavaScript。例如，V8 中几乎每个 .js 文件都会在 `global` 上安装一些东西；见 [promise.js](https://code.google.com/p/chromium/codesearch#chromium/src/v8/src/js/promise.js&sq=package:chromium&l=439) 或 [uri.js](https://code.google.com/p/chromium/codesearch#chromium/src/v8/src/js/uri.js&sq=package:chromium&l=371)。我们在 [许多地方](https://code.google.com/p/chromium/codesearch#search/&q=extrasUtils&sq=package:chromium&type=cs) 将 API 安装到 `v8` 对象上。（`binding` 对象在被 extra 或嵌入器操作之前是空的，所以 V8 本身唯一相关的代码是引导程序创建它时。）

最后，为了告诉 V8 我们将编译 extra，我们在项目的 gypfile 中添加一行：

```js
'v8_extra_library_files': ['./Vec2.js']
```

(You can see a real-world example of this [in V8’s gypfile](https://code.google.com/p/chromium/codesearch#chromium/src/v8/build/standalone.gypi&sq=package:chromium&type=cs&l=170).)

## 实践中的 V8 extras { #v8-extras-in-practice }

V8 extras 为嵌入器提供了一种新的轻量级方式来实现功能。JavaScript 代码可以更轻松地操作 JavaScript 内置函数，如数组、maps 或 promises；它可以随意地调用其它 JavaScript 函数；它可以以惯用的方式处理异常。与 C++ 实现不同，通过 V8 extras 在 JavaScript 中实现的功能可以从内联（inlining）中受益，并且调用它们不会产生任何跨界（boundary-crossing）成本。与 Chromium 的 Web IDL 绑定等传统绑定系统相比，这些优势尤为明显。

V8 extras 在去年被引入和改进，Chromium 目前正在使用它们来 [实现 streams](https://code.google.com/p/chromium/codesearch#chromium/src/third_party/WebKit/Source/core/streams/ReadableStream.js)。Chromium 还考虑使用 V8 extras 功能来实现 [scroll customization](https://codereview.chromium.org/1333323003) 和 [高效的 geometry APIs](https://groups.google.com/a/chromium.org/d/msg/blink-dev/V_bJNtOg0oM/VKbbYs-aAgAJ)。

V8 extras 仍在进行中，接口有一些粗糙的边缘情况和缺点，我们希望随着时间的推移解决。有改进空间的主要领域是调试故事：错误不容易追踪，运行时调试最常使用打印语句完成。未来，我们希望将 V8 extras 集成到 Chromium 的开发人员工具和跟踪框架中，无论是 Chromium 本身还是任何使用相同协议的嵌入器。

使用 V8 extras 时需要谨慎的另一个原因是开发人员需要付出额外的努力来编写安全且健壮的代码。V8 extras 代码直接在快照上运行，就像 V8 的 self-hosted 内置代码一样。它访问与用户态 JavaScript 相同的对象，没有绑定层或单独的上下文来防止此类访问。例如，像 `global.Object.prototype.hasOwnProperty.call(obj, 5)` 这样看似简单的东西，由于用户代码修改内置函数，而有六种可能的方式会导致其失败（算上它们！）。像 Chromium 这样的嵌入器需要对任何用户代码具有健壮性，无论其行为如何，因此在这种环境中，编写 extras  程序时需要比编写传统的 C++ 实现的功能时更加小心。

如果你想了解有关 V8 extras 功能的更多信息，请查看我们的 [设计文档](https://docs.google.com/document/d/1AT5-T0aHGp7Lt29vPWFr2-qG8r3l9CByyvKwEuA8Ec0/edit#heading=h.32abkvzeioyz)，其中包含更多详细信息。我们期待改进 V8 extras 功能，并添加更多功能，让开发人员和嵌入者能够为 V8 运行时编写富有表现力的高性能附加功能。
