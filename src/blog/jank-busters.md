---
title: 'Jank 克星第一部分'
author: 'the jank busters: Jochen Eisinger, Michael Lippautz, and Hannes Payer'
avatars:
  - 'michael-lippautz'
  - 'hannes-payer'
date: 2015-10-30 13:33:37
tags:
  - memory
description: '本文讨论了在 Chrome 41 和 Chrome 46 之间实现的优化，这些优化可显著减少垃圾回收的停顿时间，从而带来更好的用户体验。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
当 Chrome 无法在 16.66 毫秒内渲染一帧（每秒刷新 60 帧）时，就会注意到 "Jank"，或换句话说可见的卡顿。到目前为止，大多数 V8 垃圾回收工作都是在主渲染线程上执行的，参照图 1，当需要维护太多对象时，通常会导致 jank。对于 V8 团队（[1](https://blog.chromium.org/2011/11/game-changer-for-interactive.html), [2](https://www.youtube.com/watch?v=3vPOlGRH6zk), [3](/blog/free-garbage-collection)）而言，消除 jank 一直是头等大事。本文讨论了在 Chrome 41 和 Chrome 46 之间实现的一些优化，这些优化可显着减少垃圾回收停顿，从而带来更好的用户体验。

![图1：在主线程上执行垃圾回收](/_img/jank-busters/gc-main-thread.png)

垃圾回收期间的 jank 的主要来源是处理各种 bookkeeping 数据结构。这些数据结构中的许多结构都可以进行与垃圾回收无关的优化。两个示例分别是所有 ArrayBuffer 的列表，以及每个 ArrayBuffer 的视图列表。这些列表允许 DetachArrayBuffer 操作的有效实现，而不会对访问 ArrayBuffer 视图造成任何性能影响。但是，在网页创建数百万个 ArrayBuffer 的情况下（例如，基于 WebGL 的游戏），在垃圾回收期间更新这些列表会造成严重的 jank。在 Chrome 46 中，我们删除了这些列表，而是通过在每次加载并存储到 ArrayBuffers 之前插入检查来检测分离的缓冲区。通过将其分散在整个程序执行过程中，减少了不必要的 jank，从而分摊了在 GC 中遍历大 bookkeeping 列表的成本。尽管按访问检查从理论上讲可以减慢大量使用 ArrayBuffers 的程序的吞吐量，但实际上，V8 的优化编译器通常可以删除多余的检查，并将剩余的检查提升到循环之外，从而导致 execution profile 更加平滑，而对整体性能的影响很小或几乎没有。

另一个导致 jank 的原因是 bookkeeping 与跟踪 Chrome 和 V8 之间共享的对象的生存期有关。尽管 Chrome 和 V8 内存堆是不同的，但它们必须针对某些对象（例如 DOM 节点）进行同步，这些对象以 Chrome 的 C++ 代码实现，但可以通过 JavaScript 进行访问。V8 创建了一个不透明的数据类型，称为 handle，它使 Chrome 浏览器可以在不了解实现细节的情况下操纵 V8 堆对象。对象的生存期受 handle 的约束：只要 Chrome 保持 handle 不变，V8 的垃圾回收器就不会丢弃该对象。V8 为每个通过 V8 API 传给 Chrome 的 handle 创建了一个称为全局引用（global reference）的内部数据结构，这些全局引用告诉 V8 的垃圾收集器该对象仍然存活。对于 WebGL 游戏，Chrome 可能会创建数百万个此类 handle，而 V8 则需要创建相应的全局引用来管理其生命周期。在主垃圾回收停顿中处理这些大量的全局引用是可观察到的 jank。幸运的是，传递给 WebGL 的对象通常只是传递而从未真正修改过，从而可以进行简单的静态[转义分析](https://en.wikipedia.org/wiki/Escape_analysis)。本质上，对于已知通常将小数组作为参数的 WebGL 函数，可将基础数据复制到堆栈上，从而使全局引用过时。这种混合方法的结果是，对于大量渲染的 WebGL 游戏，停顿时间最多可减少 50％。

V8 的大部分垃圾回收都是在主渲染线程上执行的。将垃圾收集操作移至并发（concurrency）线程可以减少垃圾回收器的等待时间，并进一步减少 jank。这是一个固有的复杂任务，因为主 JavaScript 应用程序和垃圾回收器可能会同时观察和修改相同的对象。到目前为止，并发仅限于清除老年代（old generation）的常规对象 JS 堆。最近，我们还实现了 V8 堆的代码和映射空间的并发清除。此外，我们实现了对未使用页面的并发取消映射，以减少必须在主线程上执行的工作，参照图 2。

![图2：在并发的垃圾回收线程上执行的一些垃圾回收操作。](/_img/jank-busters/gc-concurrent-threads.png)

在基于 WebGL 的游戏中，例如 [Turbolenz 的 Oort 在线演示](http://oortonline.gl/)，可以清楚地看到所讨论的优化的影响。以下视频将 Chrome 41 与 Chrome 46 进行了比较：

<figure>
  <div class="video video-16:9">
    <iframe src="https://www.youtube.com/embed/PgrCJpbTs9I" width="640" height="360" loading="lazy"></iframe>
  </div>
</figure>

我们目前正在使更多的垃圾回收组件增量，并发和并行，以进一步缩短主线程上的垃圾回收停顿时间。请继续关注，因为我们正在准备一些有趣的补丁程序。
