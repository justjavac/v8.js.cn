---
title: 'Chrome 的一小步，V8 的一大堆'
author: 'guardians of the heap Ulan Degenbaev, Hannes Payer, Michael Lippautz, and DevTools warrior Alexey Kozyatinskiy'
avatars:
  - 'ulan-degenbaev'
  - 'michael-lippautz'
  - 'hannes-payer'
date: 2017-02-09 13:33:37
tags:
  - memory
description: 'V8 最近增加了对堆大小的硬限制。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 对其堆大小有硬性限制。这可以防止应用程序发生内存泄漏。当应用程序达到这个硬限制时，V8 会执行一系列最后的垃圾回收。如果垃圾回收对释放内存没有帮助，V8 将停止执行并报告内存不足（out-of-memory）故障。如果没有硬性限制，内存泄漏应用程序可能会耗尽所有系统内存，从而损害其它应用程序的性能。

具有讽刺意味的是，这种保护机制使 JavaScript 开发人员更难调查内存泄漏。在开发人员设法检查 DevTools 中的堆之前，应用程序可能会耗尽内存。此外，DevTools 进程本身可能会耗尽内存，因为它使用的是普通 V8 实例。例如，获取[此演示](https://ulan.github.io/misc/heap-snapshot-demo.html)的堆快照会由于当前稳定的 Chrome 内存不足（out-of-memory ）而中止执行。

历史上，V8 堆限制被方便地设置为适合有符号的 32 位整数范围和一些余量。随着时间的推移，这种便利导致 V8 中的代码松散，混合不同位宽的类型，有效地打破了增加限制的能力。最近我们清理了垃圾回收器代码，允许使用更大的堆大小。DevTools 已经使用了这个功能，并且在前面提到的演示中获取堆快照在最新的 Chrome Canary 中可以按预期工作。

我们还在 DevTools 中添加了一项功能，可以在应用程序快要用尽内存时暂停应用程序。此功能对于调查导致应用程序在短时间内分配大量内存的错误很有用。当使用最新的 Chrome Canary 版本运行[此演示](https://ulan.github.io/misc/oom.html)时，DevTools 在内存不足故障之前暂停应用程序并增加堆限制，使用户有机会检查堆，在控制台上评估表达式以释放内存，然后恢复执行以便进一步调试。

![](/_img/heap-size-limit/debugger.png)

V8 嵌入器可以使用 `ResourceConstraints` API 的 [`set_max_old_space_size`](https://codesearch.chromium.org/chromium/src/v8/include/v8.h?q=set_max_old_space_size) 函数增加堆限制。但请注意，垃圾回收器中的某些阶段对堆大小具有线性依赖性。垃圾回收停顿可能会随着更大的堆而增加。
