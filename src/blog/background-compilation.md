---
title: '后台编译'
author: '[Ross McIlroy](https://twitter.com/rossmcilroy), main thread defender'
avatars:
  - 'ross-mcilroy'
date: 2018-03-26 13:33:37
tags:
  - internals
description: '从 Chrome 66 开始，V8 在后台线程上编译 JavaScript 源代码，在典型网站上将主线程上的编译时间减少了 5% 到 20%。'
tweet: '978319362837958657'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
TL;DR: 从 Chrome 66 开始，V8 在后台线程上编译 JavaScript 源代码，在典型网站上将主线程上的编译时间减少了 5% 到 20%。

## 背景 { #background }

从版本 41 开始，Chrome 支持通过 V8 的 [`StreamedSource`](https://cs.chromium.org/chromium/src/v8/include/v8.h?q=StreamedSource&sq=package:chromium&l=1389) API [在后台线程上解析 JavaScript 源文件](https://blog.chromium.org/2015/03/new-javascript-techniques-for-rapid.html)。这使 V8 能够在 Chrome 从网络下载文件的第一个块后立即开始解析 JavaScript 源代码，并在 Chrome 通过网络流式传输文件时继续并行解析。这可以提供相当大的加载时间改进，因为 V8 几乎可以在文件下载完成时完成对 JavaScript 的解析。

但是，由于 V8 原始基线编译器的限制，V8 仍然需要返回主线程来完成解析并将脚本编译为 JIT 机器代码，以便执行脚本代码。切换到新的 [Ignition + TurboFan pipeline](/blog/launching-ignition-and-turbofan) 后，我们现在也可以将字节码编译移至后台线程，从而释放 Chrome 的主线程以提供更流畅、响应更快的 Web 浏览体验。

## 构建后台线程字节码编译器 { #building-a-background-thread-bytecode-compiler }

V8 的 Ignition 字节码编译器将解析器生成的 [抽象语法树(AST)](https://en.wikipedia.org/wiki/Abstract_syntax_tree) 作为输入，并生成字节码流 (`BytecodeArray`) 以及关联的元数据，使 Ignition 解释器能够执行 JavaScript 源代码。

![](/_img/background-compilation/bytecode.svg)

Ignition 的字节码编译器在构建时考虑了多线程，但是在整个编译管道中需要进行大量更改以启用后台编译。主要更改之一是防止编译管道在后台线程上运行时访问 V8 的 JavaScript 堆中的对象。V8 堆中的对象不是线程安全的，因为 Javascript 是单线程的，并且可能在后台编译期间被主线程或 V8 的垃圾收集器修改。

访问 V8 堆上对象的编译管道有两个主要阶段：AST internalization 和 bytecode finalization。AST internalization 是将 AST 中标识的字面量对象（字符串、数字、对象字面量模板等）分配到 V8 堆上的过程，以便在执行脚本时生成的字节码可以直接使用它们。这个过程传统上在解析器构建 AST 后立即发生。因此，稍后在编译管道中有许多步骤依赖于已分配的字面量对象。为了启用后台编译，我们在编译管道中将 AST internalization 移动到了字节码编译之后。这需要修改管道的后期阶段，以访问嵌入在 AST 中的 _原始_ 字面量值，而不是内部化的堆上值。

Bytecode finalization 涉及构建最终的 `BytecodeArray` 对象，用于执行该函数以及相关的元数据——例如，一个用于存储字节码引用的常量的 `ConstantPoolArray`，以及一个将 JavaScript 源代码行和列号映射到字节码偏移量的 `SourcePositionTable`。由于 JavaScript 是一种动态语言，如果与字节码相关联的 JavaScript 函数被回收，这些对象都需要存在于 JavaScript 堆中，以使其能够被垃圾回收。以前，其中一些元数据对象将在字节码编译期间分配和修改，这涉及访问 JavaScript 堆。为了启用后台编译，Ignition 的字节码生成器被重构以跟踪此元数据的详细信息，并将它们在 JavaScript 堆上的分配推迟到编译的最后阶段。

通过这些更改，几乎所有脚本的编译都可以移动到后台线程，只有简短的 AST internalization 和 bytecode finalization 完成步骤在脚本执行之前发生在主线程上。

![](/_img/background-compilation/threads.svg)

目前，只有顶级脚本代码和立即调用的函数表达式 (IIFE) 在后台线程上编译——内部函数仍然在主线程上延迟编译（第一次执行时）。 我们希望在未来将后台编译扩展到更多情况。然而，即使有这些限制，后台编译仍会使主线程空闲更长时间，使其能够执行其它工作，例如对用户交互做出反应、渲染动画或以其它方式产生更流畅、更灵敏的体验。

## 结果 { #results }

我们在一组流行的网页上使用我们的 [真实世界基准测试框架](/blog/real-world-performance) 评估了后台编译的性能。

![](/_img/background-compilation/desktop.svg)

![](/_img/background-compilation/mobile.svg)

可以在后台线程上发生的编译比例取决于在顶级流脚本编译期间编译的字节码的比例以及在调用内部函数时被延迟编译的字节码比例（这仍然必须发生在主线程上）。因此，在主线程上节省的时间比例各不相同，大多数页面的主线程编译时间减少了 5% 到 20%。

## 下一步 { #next-steps }

有什么比在后台线程上编译脚本更好的呢？ 根本不需要编译脚本！除了后台编译，我们还一直致力于改进 V8 的 [代码缓存系统](/blog/code-caching)，以扩展 V8 缓存的代码量，从而加快您经常访问的站点的页面加载速度。我们希望尽快为您带来这方面的最新信息。敬请关注！
