---
title: '免费获取垃圾回收'
author: 'Hannes Payer and Ross McIlroy, Idle Garbage Collectors'
avatars:
  - 'hannes-payer'
  - 'ross-mcilroy'
date: 2015-08-07 13:33:37
tags:
  - internals
  - memory
description: 'Chrome 41 将昂贵的内存管理操作隐藏在较小的、未使用的空闲时间块内，从而减少了麻烦。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
JavaScript 性能仍然是 Chrome 价值观的关键方面之一，尤其是在实现流畅体验方面。从 Chrome 41 开始，V8 利用一项新技术，通过将昂贵的内存管理操作隐藏在较小、未使用的空闲时间（idle time）块中，从而提高了 Web 应用程序的响应能力。结果，Web 开发人员应该期望由于垃圾回收的影响，现在将具有更轻微的刺痛感而使滚动和 buttery 动画更加流畅。

许多现代语言引擎（例如 Chrome 的 V8 JavaScript 引擎）动态管理用于运行应用程序的内存，因此开发人员无需自己担心。引擎会定期传递分配过的内存给应用程序，确定不再需要哪些数据，并将其清除以释放空间。此过程称为[垃圾回收（GC）](https://en.wikipedia.org/wiki/Garbage_collection_(computer_science))。

在 Chrome 浏览器中，我们致力于提供每秒 60 帧（FPS）的流畅视觉体验。尽管 V8 已经尝试在较小的块中执行垃圾回收，但是较大的垃圾回收操作可能并且确实会在不可预测的时间（有时是在动画的中间）发生，从而暂停执行并阻止 Chrome 达到60 FPS的目标。

Chrome 41 包含一个[用于 Blink 渲染引擎的任务计划程序](https://blog.chromium.org/2015/04/scheduling-tasks-intelligently-for_30.html)，该任务计划程序可以对潜在灵敏（latency-sensitive）的任务进行优先级排序，以确保 Chrome 保持响应能力和快速性。除了能够对工作进行优先级排序外，此任务计划程序还集中了解系统的繁忙程度，需要执行哪些任务以及这些任务的紧急程度。因此，它可以估算 Chrome 何时可能处于空闲状态，以及大概需要保持多长时间。

当 Chrome 在网页上显示动画时，就会发生这种情况。动画将以 60 FPS 的速度更新屏幕，使 Chrome 大约有 16.6 毫秒的时间来执行更新。这样，Chrome 将在显示前一帧后立即在当前帧上开始工作，并为该新帧执行输入，动画和帧渲染任务。如果 Chrome 在不到 16.6 毫秒内完成了所有这些工作，则在需要开始渲染下一帧之前，它在剩余时间内将无事可做。Chrome 的调度程序（scheduler）可让 V8 在 Chrome 空闲（idle）时安排特殊的 _空闲任务（idle tasks）_，从而利用此 _空闲时间段（idle time period）_。

![图1：带有空闲任务（idle tasks）的帧渲染](/_img/free-garbage-collection/frame-rendering.png)

空闲任务（Idle tasks）是特殊的低优先级任务，它们在调度程序确定其处于空闲时间段时运行。空闲任务有一个截止日期（deadline），这是调度程序对它预计保持空闲状态的估计。在图 1 的动画示例中，这将是开始绘制下一帧的时间。在其它情况下（例如，当没有任何屏幕活动发生时），这可能是安排运行下一个待处理任务的时间，上限为 50 毫秒，以确保 Chrome 保持对意外用户输入的响应。空闲任务使用截止日期来估计它可以完成多少工作，而不会引起混乱或输入响应延迟。

空闲任务中完成的垃圾回收对关键的、潜在灵敏的操作隐藏。这意味着这些垃圾回收任务是“免费（free）”完成的。为了了解 V8 如何做到这一点，有必要回顾一下 V8 当前的垃圾回收策略。

## 深入研究 V8 的垃圾回收引擎 { #deep-dive-into-v8’s-garbage-collection-engine }

V8 使用了[分代垃圾回收器](http://www.memorymanagement.org/glossary/g.html#term-generational-garbage-collection)，其中的 Javascript 堆分为新分配的对象的新生代（young generation）和长期存在的对象的老年代（old generation）。[由于大多数对象都死于年轻时](http://www.memorymanagement.org/glossary/g.html#term-generational-hypothesis)，因此这种分代的策略使垃圾回收器可以在较小的新生代（称为清道夫）中执行常规的短时间垃圾回收，而不必在老年代中跟踪对象。

新生代使用[半空间（semi-space）](http://www.memorymanagement.org/glossary/s.html#semi.space)分配策略，其中新对象最初是在新生代的活动半空间（active semi-space）中分配的。一旦该半空间变满，清除操作会将活动对象（live objects）移动到另一个半空间。曾经被移动过的对象被提升为老年代，并被认为是长期存活（long-living）的。一旦移动了活动对象，新的半空间将变为活动状态，而旧半空间中的所有剩余死亡对象都将被丢弃。

因此，新生代清除的持续时间取决于新生代中活动对象的数量。当大多数对象在新生代中变得无法到达时，清除速度会很快（<1 ms）。但是，如果大多数对象在清除过程中幸存下来，则清除的持续时间可能会明显更长。

当老年代中的活动对象的数量增长超出启发式派生（heuristically-derived）的限制时，将执行整个堆的主要回收。老年代使用带有多种优化功能的[标记清除回收器](http://www.memorymanagement.org/glossary/m.html#term-mark-sweep)来改善延迟和内存消耗。标记延迟时间取决于必须标记的活动对象的数量，对于大型 Web 应用程序，标记整个堆可能要花费 100 毫秒以上的时间。为了避免长时间中断主线程，V8 长期以来具有[以许多小步长增量标记活动对象](https://blog.chromium.org/2011/11/game-changer-for-interactive.html)的能力，目的是使每个标记步长的持续时间保持在 5 毫秒以下。

标记后，通过清除整个老年代内存，可以为应用程序再次提供可用内存。该任务由专用清除程序线程同时执行。最后，执行内存压缩以减少老年代中的内存碎片。该任务可能非常耗时，并且仅在内存碎片成为问题时才执行。

总之，有四个主要的垃圾回收任务：

1. 新生代的清除工作通常很快
2. 由增量标记器执行的标记步长，可以根据步长大小而任意延长
3. 完整的垃圾回收，可能需要很长时间
4. 具有积极的内存压缩的完整垃圾回收，这可能需要很长时间，但是会清理零碎的内存

为了在空闲时间执行这些操作，V8 将垃圾回收空闲任务发布到调度程序。当这些空闲任务运行时，将为它们提供完成任务的截止日期。V8 的垃圾回收空闲时间处理程序评估应执行哪些垃圾收集任务，以减少内存消耗，同时遵守截止日期，以避免将来在帧渲染或输入延迟方面造成麻烦。

如果应用程序的测量分配率显示新生代可能在下一个预期的空闲时间段之前已满，则垃圾收集器将在空闲任务期间执行新生代的清理。此外，它会计算最近的清理任务所花费的平均时间，以预测将来的清理工作的持续时间，并确保它不会违反空闲任务的截止时间。

当老年代中活动对象的数量接近堆限制时，将开始增量标记。增量标记步长可以根据应标记的字节数线性缩放。根据平均测得的标记速度，垃圾回收空闲时间处理程序将尝试使尽可能多的标记工作适合给定的空闲任务。

如果老年代几乎已满，并且估计为任务提供的截止日期足够长以完成回收，则在空闲任务期间安排一次完整的垃圾回收。根据标记速度乘以分配的对象数，可以预测回收停顿时间。只有在网页闲置了相当长的时间后，才执行带有额外内存压缩的完整垃圾回收。

## 性能评估 { #performance-evaluation }

为了评估在空闲时间运行垃圾回收的影响，我们使用了 Chrome 的 [Telemetry 性能基准测试框架](https://www.chromium.org/developers/telemetry)来评估流行的网站在加载时的滚动状态。我们对 Linux 工作站上的[前 25](https://code.google.com/p/chromium/codesearch#chromium/src/tools/perf/benchmarks/smoothness.py&l=15)个站点以及 Android Nexus 6 智能手机上的[典型移动站点](https://code.google.com/p/chromium/codesearch#chromium/src/tools/perf/benchmarks/smoothness.py&l=104)进行了基准测试，它们都是受欢迎的网页（包括复杂的 Web 应用程序，例如 Gmail，Google Docs 和 YouTube）并滚动其内容几秒钟 。Chrome 的目标是保持 60 FPS 的滚动速度，以提供流畅的用户体验。

图 2 显示了在空闲时间安排的垃圾回收百分比。与 Nexus 6 相比，工作站更快的硬件会有更长的总体空闲时间，从而可以在此空闲时间内安排更多百分比的垃圾回收（垃圾回收的百分比为 31％ 和 43％），最终根据我们的[指标](https://www.chromium.org/developers/design-documents/rendering-benchmarks)的垃圾回收率提高了约 7％。

![图2：空闲时间发生的垃圾回收百分比](/_img/free-garbage-collection/idle-time-gc.png)

除了提高页面渲染的平滑度之外，这些空闲时间还提供了在页面完全空闲时执行更积极的垃圾回收的机会。Chrome 45 的最新改进利用了这一优势，从而大大减少了空闲的前台标签所消耗的内存量。图 3 展示了与 Chrome 43 中的同一页面相比，Gmail 的 JavaScript 堆空闲后如何将其内存使用量减少约 45％ 的情况。

<figure>
  <div class="video video-16:9">
    <iframe src="https://www.youtube.com/embed/ij-AFUfqFdI" width="640" height="360" loading="lazy"></iframe>
  </div>
  <figcaption>图 3：最新版本的 Chrome 45（左）与 Chrome 43 上 Gmail 的内存使用情况</figcaption>
</figure>

这些改进表明，可以通过更聪明地了解何时执行昂贵的垃圾回收操作来隐藏垃圾回收停顿。Web 开发人员不必再担心垃圾回收停顿，即使是针对柔滑流畅的 60 FPS 动画也是如此。请继续关注垃圾回收调度的更多改进。
