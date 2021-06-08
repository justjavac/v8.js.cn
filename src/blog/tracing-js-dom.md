---
title: '从 JS 追踪到 DOM 并返回'
author: 'Ulan Degenbaev, Alexei Filippov, Michael Lippautz, and Hannes Payer — the fellowship of the DOM'
avatars:
  - 'ulan-degenbaev'
  - 'michael-lippautz'
  - 'hannes-payer'
date: 2018-03-01 13:33:37
tags:
  - internals
  - memory
description: 'Chrome 的 DevTools 现在可以跟踪和获取 C++ DOM 对象快照，并显示来自 JavaScript 的所有可访问 DOM 对象及其引用。'
tweet: '969184997545562112'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
在 Chrome 66 中调试内存泄漏（memory leaks）变得更加容易。Chrome 的 DevTools 现在可以跟踪和获取 C++ DOM 对象快照，并显示来自 JavaScript 的所有可访问 DOM 对象及其引用。此功能是 V8 垃圾回收器的新 C++ 跟踪机制的好处之一。

## 背景 { #background }

当未使用的对象由于来自其它对象的无意引用而未被释放时，会发生垃圾收集系统中的内存泄漏。网页中的内存泄漏通常涉及 JavaScript 对象和 DOM 元素之间的交互。

以下[小示例](https://ulan.github.io/misc/leak.html)显示了当程序员忘记取消注册事件侦听器时发生的内存泄漏。事件侦听器引用的对象都不能被垃圾回收。特别是，iframe 窗口与事件侦听器一起泄漏。

```js
// Main window:
const iframe = document.createElement('iframe');
iframe.src = 'iframe.html';
document.body.appendChild(iframe);
iframe.addEventListener('load', function() {
  const localVariable = iframe.contentWindow;
  function leakingListener() {
    // Do something with `localVariable`.
    if (localVariable) {}
  }
  document.body.addEventListener('my-debug-event', leakingListener);
  document.body.removeChild(iframe);
  // BUG: forgot to unregister `leakingListener`.
});
```

泄漏的 iframe 窗口还使所有 JavaScript 对象保持活动状态。

```js
// iframe.html:
class Leak {};
window.globalVariable = new Leak();
```

了解保留路径（retaining paths）的概念以查找内存泄漏的根本原因很重要。保留路径是防止泄漏对象（leaking object）的垃圾回收的对象链。该链从根对象开始，例如主窗口的全局对象。链在泄漏的对象处结束。链中的每个中间对象都有对链中下一个对象的直接引用。例如，iframe 中 `Leak` 对象的保留路径如下：

![图 1：保留通过 `iframe` 和事件侦听器泄漏的对象的路径](/_img/tracing-js-dom/retaining-path.svg)

请注意，保留路径两次穿过 JavaScript / DOM 边界（分别以绿色/红色突出显示）。JavaScript 对象存在于 V8 堆中，而 DOM 对象是 Chrome 中的 C++ 对象。

## DevTools 堆快照 { #devtools-heap-snapshot }

我们可以通过在 DevTools 中拍摄堆快照来检查任何对象的保留路径。堆快照精确地捕获了 V8 堆上的所有对象。直到最近，它只有关于 C++ DOM 对象的简略信息。例如，Chrome 65 显示了小示例中 `Leak` 对象的不完整保留路径：

![图 2：Chrome 65 中的保留路径（retaining path）](/_img/tracing-js-dom/chrome-65.png)

只有第一行是精确的：`Leak` 对象确实存储在 iframe 的 window 对象的 `global_variable` 中。后续行简略了真实的保留路径并使内存泄漏的调试变得困难。

从 Chrome 66 开始，DevTools 会跟踪 C++ DOM 对象并精确捕获它们之间的对象和引用。这是基于之前为跨组件垃圾回收引入的强大的 C++ 对象跟踪机制。结果，[DevTools 中的保留路径](https://www.youtube.com/watch?v=ixadA7DFCx8)现在实际上是正确的：

<figure>
  <div class="video video-16:9">
    <iframe src="https://www.youtube.com/embed/ixadA7DFCx8" width="640" height="360" loading="lazy"></iframe>
  </div>
  <figcaption>图 3：Chrome 66 中的保留路径（retaining path）</figcaption>
</figure>

## 幕后：跨组件追踪 { #under-the-hood%3A-cross-component-tracing }

DOM 对象由 Blink（Chrome 的渲染引擎）管理，它负责将 DOM 转换为屏幕上的实际文本和图像。Blink 及其对 DOM 的表示是用 C++ 编写的，这意味着 DOM 不能直接暴露给 JavaScript。相反，DOM 中的对象分为两半：JavaScript 可用的 V8 包装器对象和表示 DOM 中节点的 C++ 对象。这些对象之间有直接的引用。跨多个组件（例如 Blink 和 V8）确定对象的活跃度和所有权是很困难的，因为所有相关方都需要就哪些对象仍然存在以及哪些对象可以回收达成一致。

在 Chrome 56 及更早版本（即 2017 年 3 月之前）中，Chrome 使用一种称为 _对象分组（object grouping）_ 的机制来确定活跃度。根据文档中的包含情况为对象分配组。只要单个对象通过其它保留路径保持活动状态，则具有所有包含对象的组将保持活动状态。这在 DOM 节点的上下文中是有意义的，这些节点总是引用它们的包含文档，形成所谓的 DOM 树。然而，这种抽象删除了所有实际的保留路径，这使得它很难用于调试，如图 2 所示。在不适用这种场景的对象的情况下，例如 JavaScript 闭包用作事件侦听器，这种方法也变得很麻烦，并导致各种错误，其中 JavaScript 包装器对象会过早地被回收，导致它们被空的 JS 包装器替换，从而失去所有属性。

从 Chrome 57 开始，这种方法被跨组件跟踪（cross-component tracing）取代，这是一种通过跟踪从 JavaScript 到 DOM 的 C++ 实现并返回来确定活跃度的机制。我们在 C++ 端实现了增量跟踪，并带有写屏障，以避免我们在[之前的博客文章](/blog/orinoco-parallel-scavenger)中讨论过的任何 stop-the-world 跟踪 jank。跨组件跟踪不仅提供了更好的延迟，而且还更好地近似了跨组件边界的对象的活跃度，并修复了一些曾经导致泄漏的[场景](https://bugs.chromium.org/p/chromium/issues/detail?id=501866)。 最重要的是，它允许 DevTools 提供实际代表 DOM 的快照，如图 3 所示。

试试看！ 我们很高兴听到您的反馈。
