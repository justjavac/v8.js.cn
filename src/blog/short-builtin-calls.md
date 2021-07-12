---
title: '短内置调用'
author: '[Toon Verwaest](https://twitter.com/tverwaes), The Big Short'
avatars:
  - toon-verwaest
date: 2021-05-06
tags:
  - JavaScript
description: '在 V8 v9.1 中，我们暂时取消了桌面上的内置函数的嵌入，以避免由远间接调用导致的性能问题。'
tweet: '1394267917013897216'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---

在 V8 v9.1 中，我们暂时禁用了桌面上的[嵌入式内置程序](https://v8.dev/blog/embedded-builtins)。虽然嵌入内置函数显著提高了内存使用率，但我们已经意识到嵌入内置函数和 JIT 编译代码之间的函数调用可能会带来相当大的性能损失。此成本取决于 CPU 的微体系结构。在这篇文章中，我们将解释为什么会发生这种情况，性能如何，以及我们计划采取什么措施来解决这个长期问题。

## 代码分配 { #code-allocation }

V8 的即时 (JIT) 编译器生成的机器代码在 VM 拥有的内存页面上动态分配。V8 在一个连续的地址空间区域内分配内存页，该区域本身要么位于内存中随机的某处（由于[地址空间布局随机化](https://en.wikipedia.org/wiki/Address_space_layout_randomization)的原因），要么位于我们为[指针压缩](https://v8.dev/blog/pointer-compression)分配的 4-GiB 虚拟内存区域（cage ）内的某处。

V8 JIT 代码调用内置函数（builtins）很常见。内置程序本质上是作为 VM 的一部分提供的机器代码片段。有一些内置函数实现了完整的 JavaScript 标准库函数，例如 [`Function.prototype.bind`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_objects/Function/bind)，但许多内置函数是机器代码的辅助片段，填补了 JS 的高级语义和 CPU 的低级能力之间的空白。例如，如果一个 JavaScript 函数想要调用另一个 JavaScript 函数，那么函数实现通常会调用 `CallFunction` 内置函数来确定应该如何调用目标 JavaScript 函数；即，它是代理还是常规函数，它需要多少个参数等。由于这些片段在我们构建 VM 时是已知的，因此它们“嵌入”在 Chrome 二进制文件中，这意味着它们最终会出现在 Chrome 二进制文件中代码区域。

## 直接与间接调用 { #direct-vs.-indirect-calls }

在 64 位架构上，包含这些内置程序的 Chrome 二进制文件与 JIT 代码相距甚远。对于 [x86-64](https://en.wikipedia.org/wiki/X86-64) 指令集，这意味着我们不能使用直接调用：它们采用 32 位有符号立即数作为调用地址的偏移量，并且目标可能超过 2 GiB。相反，我们需要依赖通过寄存器或内存操作数的间接调用。此类调用更依赖于预测（prediction），因为从调用指令本身无法立即看出调用的目标是什么。在 [ARM64](https://en.wikipedia.org/wiki/AArch64) 上我们根本不能使用直接调用，因为范围被限制为 128 MiB。这意味着在这两种情况下，我们都依赖于 CPU 间接分支预测器的准确性。

## 间接分支预测的限制 { #indirect-branch-prediction-limitations }

当面向 x86-64 时，依靠直接调用会很好。它应该减少间接分支预测器的压力，因为在指令解码后目标是已知的，但它也不需要将目标从常量或内存加载到寄存器中。但这不仅仅是机器代码中可见的明显差异。

由于 [Spectre v2](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html)，各种设备/操作系统组合已关闭间接分支预测。这意味着在此类配置中，我们将在依赖于 `CallFunction` 内置函数的 JIT 代码中调用函数时遇到代价高昂的停顿（very costly stalls）。

更重要的是，即使 64 位指令集架构（“CPU 的高级语言”）支持对远地址的间接调用，微架构也可以自由地实施具有任意限制的优化。间接分支预测器通常假设调用距离不超过特定距离（例如 4GiB），每次预测需要较少的内存。 例如，[英特尔优化手册](https://www.intel.com/content/dam/www/public/us/en/documents/manuals/64-ia-32-architectures-optimization-manual.pdf)明确指出：

> 对于 64 位应用程序，当分支目标与分支的距离超过 4 GB 时，分支预测性能可能会受到负面影响。

虽然在 ARM64 上，直接调用的架构调用范围限制为 128 MiB，但事实证明，[Apple 的 M1](https://en.wikipedia.org/wiki/Apple_M1) 芯片对间接调用预测具有相同的微架构 4 GiB 范围限制。对比 4 GiB 更远的调用目标的间接调用似乎总是被错误预测。由于 M1 的特别大的[重新排序缓冲区（re-order buffer）](https://en.wikipedia.org/wiki/Re-order_buffer)，CPU 的组件使未来预测的指令能够被推测性地乱序执行，频繁的错误预测会导致异常大的性能损失。

## 临时解决方案：复制内置函数 { #temporary-solution%3A-copy-the-builtins }

为了避免频繁错误预测的成本，并避免在 x86-64 上尽可能地依赖分支预测，我们决定在具有足够内存的台式机上临时将内置函数复制到 V8 的指针压缩区域（cage）中。这使复制的内置代码接近动态生成的代码。性能结果在很大程度上取决于设备配置，但以下是我们的性能机器人的一些结果：

![从实时页面记录的浏览基准](/_img/short-builtin-calls/v8-browsing.svg)

![基准分数提高](/_img/short-builtin-calls/benchmarks.svg)

对于每个 V8 实例，取消嵌入内置程序确实会增加受影响设备上的内存使用量 1.2 到 1.4 MiB。作为一个更好的长期解决方案，我们正在研究分配更接近 Chrome 二进制文件的 JIT 代码。这样我们就可以重新嵌入内置函数以重新获得内存优势，同时还能提高从 V8 生成的代码到 C++ 代码的调用性能。
