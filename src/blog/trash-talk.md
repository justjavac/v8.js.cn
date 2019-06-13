---
title: '谈谈 GC：新的 Orinoco 垃圾收集器'
author: 'Peter ‘the garbo’ Marshall ([@hooraybuffer](https://twitter.com/hooraybuffer))'
avatars:
  - 'peter-marshall'
date: 2019-01-03 17:45:34
tags:
  - internals
  - memory
description: 'Orinoco, V8 的新垃圾收集器，采用了 stop-the-world 垃圾回收器，以使其变成了一个更加并行，并发和增量的垃圾回收器'
tweet: '1080867305532416000'
cn:
  author: '[Shawn偷偷的](https://www.zhihu.com/people/shawn-sit)，OverflowStack Engineer。文章来自知乎专栏：<https://zhuanlan.zhihu.com/p/55917130>'
  avatars:
    - shawn-sit
---
过去这些年 V8 的垃圾回收器（GC）发生了很多的变化，Orinoco 项目采用了 stop-the-world 垃圾回收器，以使其变成了一个更加并行，并发和增量的垃圾回收器。

:::note
**注：**如果您更喜欢在阅读文章时观看演示文稿，请欣赏以下视频！如果喜欢阅读文章，请跳过视频并继续阅读。
:::

<figure>
  <div class="video video-16:9">
    <iframe src="https://www.youtube.com/embed/Scxz6jVS4Ls" width="640" height="360" loading="lazy"></iframe>
  </div>
</figure>

不论什么垃圾回收器都有一些定期需要去做的任务：

1. 标记活动对象（live objects）和非活动对象(dead objects)
1. 回收或者重用被非活动对象占据的内存
1. 合并或者整理内存（可选）

这些任务可以按照顺序或者交叉地执行。一种方式是暂停 JavaScript 的执行，在主线程上按照顺序去执行这些任务。这样做导致的结果就是 JavaScript 延迟执行，以及页面渲染时 JavaScript 来不及执行导致的页面空白或者卡顿问题（jank）。这个问题在之前的两篇文章（[文章一](/blog/jank-busters/)，[文章二](/blog/orinoco/)）已经探讨过, 这样做同时也会降低JavaScript执行的吞吐量（throughput）。

## 主垃圾回收器 —— 全量标记和整理 { #major-gc }

主垃圾回收器从整个堆（heap）中收集垃圾。

<figure>
  <img src="/_img/trash-talk/01.svg" intrinsicsize="960x294" alt="">
  <figcaption>主垃圾回收器主要有三个阶段：标记（marking），清除（sweeping）和整理（compacting）</figcaption>
</figure>

### 标记阶段 { #marking }

确定哪些对象可以被回收是垃圾回收中重要的一步。垃圾回收器通过可访问性（reachability）来确定对象的 “活跃度”（liveness）。这意味着任何对象如果在运行时是可访问的（reachable），那么必须保证这些对象应该在内存中保留，如果对象是不可访问的（unreachable）那么这些对象就可能被回收。

标记阶段就是找到可访问对象的一个过程；垃圾回收是从一组对象的指针（objects pointers）开始的，我们将其称之为根集（root set），这其中包括了执行栈和全局对象；然后垃圾回收器会跟踪每一个指向 JavaScript 对象的指针，并将对象标记为可访问的，同时跟踪对象中每一个属性的指针并标记为可访问的，这个过程会递归地进行，直到标记到运行时每一个可访问的对象。

### 清除阶段 { #sweeping }

清除阶段就是将非活动对象占用的内存空间添加到一个叫空闲列表（free-list）的数据结构中。一旦标记完成，垃圾回收器会找到不可访问对象的内存空间，并将内存空间添加到相应的空闲列表中。空闲列表中的内存块由大小来区分，为什么这样做呢？为了方便以后需要分配内存，就可以快速的找到大小合适的内存空间并分配给新的对象。

### 整理阶段 { #compaction }

主垃圾回收器会通过一种叫做碎片启发式（fragmentation heuristic）的算法来整理内存页)，你可以将整理阶段理解为老式 PC 上的磁盘整理。那么碎片启发式算法是怎么做的呢？我们将活动对象复制到当前没有被整理的其他内存页中（即被添加到空闲列表的内存页）；通过这种做法，我们就可以利用内存中高度小而分散的内存空间。

垃圾回收器复制活动对象到当前没有被整理的其他内存页中有一个潜在的缺点，我们要分配内存空间给很多常驻内存（ long-living）的对象时，复制这些对象会带来很高的成本。这就是为什么我们只选择整理内存中高度分散的内存页，并且对其他内存页我们只进行清除而不是也同样复制活动对象的原因。

## 分代堆布局 { #generational-layout }

堆在 V8 中会分为两块不同的区域，我们将其称之为代（[generations](/blog/orinoco-parallel-scavenger)）；这两块区域分别称之为老生代（old generation）和新生代（young generation），新生代又进一步分为 ‘nursery’ 子代和 ‘intermediate’ 子代两块区域； 一个对象第一次分配内存时会被分配到新生代中的‘ nursery’ 子代；如果进过下一次垃圾回收这个对象还存在新生代中，这时候我们移动到 ‘intermediate’ 子代，再经过下一次垃圾回收这个对象还在新生代，这时候我们就会把这个对象移动到老生代。

<figure>
  <img src="/_img/trash-talk/02.svg" intrinsicsize="960x333" alt="">
  <figcaption>V8中堆分成两代，如果经过垃圾回收对象还存活的话会从新生代移动到老生代</figcaption>
</figure>

在垃圾回收中有一个重要的术语：“代际假说”（The Generational Hypothesis）；代际假说表明很多对象在内存中存在的时间很短（die young）。换句话说，从垃圾回收的角度来看，很多对象一经分配内存空间随即就变成了不可访问的。这个假说不仅仅适用于 V8 和 JavaScript，同样适用于大多数的动态语言。

V8分代堆布局的设计主要是为了利用对象存在生命周期的这个事实；垃圾回收实质上就是整理内存和移动内存中的对象，那这就意味着我们应该多移动对象到空闲列表中的内存中去；这个看上去似乎有点违反直觉，因为在垃圾回收的时候复制对象的成本很高。但是根据代际假说在垃圾回收中，在内存中存活下来的对象其实并不是很多。所以重新分配内存给新创建的对象，这反而变成了隐式的垃圾；这就意味着我们只需花费复制存活对象的成本，并不需要耗费成本去分配新的内存。

## 副垃圾回收器 —— 清道夫(Scavenger) { #minor-gc }

V8 有两个垃圾回收器，[**主垃圾回收器（Full Mark-Compact）**](#major-gc)从整个堆中回收垃圾，**副垃圾回收器（Scavenger）**从新生代中回收垃圾。主垃圾回收器可以很有效的从整个堆中回收垃圾，但是代际假说告诉我们新分配内存的对象也极有可能需要垃圾回收。

副垃圾回收器只从新生代中回收垃圾，幸存的对象总是会被分配到内存页中去。V8 为新生代内存采用了‘半空间’（semi-space）的设计，这意味着为了做疏散（译者注：移动对象）这一步骤（evacuation step），有一半的内存空间是空闲的。在清理时，初始的空闲区域称之为“To-Space”，复制对象过来的区域称之为“From-Space”；在最坏的情况下，如果每一个对象在清理的时候存活了下来，那我们就要复制每一个对象。

对于清理，我们会维护一个额外的根集（root set），这个根集里会存放一些从旧到新的引用。这些引用是在旧空间（old-space）中指向新生代中对象的指针。我们使用[“写屏障（write barriers）”](https://www.memorymanagement.org/glossary/w.html#term-write-barrier)来维护从旧到新的引用列表，而不是跟踪整个堆中的每一个对象变更。当堆和全局对象结合使用时，我们知道每一个在新生代中对象的引用，而无需追踪整个老生代。

疏散步骤将所有的活动对象移动到连续的一块内存中，这样做的好处就是完全移除内存碎片（清理非活动对象时留下的内存碎片）；然后我们把两块内存空间互换，即把 ‘To-Space’ 变成 ‘From-Space’，反之亦然。一旦垃圾回收完成，新分配的内存空间将从 ‘From-Space’ 下一个空闲内存地址开始。

<figure>
  <img src="/_img/trash-talk/03.svg" intrinsicsize="960x333" alt="">
  <figcaption>副垃圾回收器移动活动对象到一个新的内存页</figcaption>
</figure>

如果仅仅是凭借这一策略，我们就会很快的耗尽新生代的内存空间；为了新生代的内存空间不被耗尽，在下一次垃圾回收的时候，我们会把活动对象移动（evacuate）到老生代，而不是 ‘To-Space’。

清理的最后一步是把移动后的对象的指针地址更新，每一个被复制对象都会留下一个转发地址（forwarding-address），用于更新指针以指向新的地址。

<figure>
  <img src="/_img/trash-talk/04.svg" intrinsicsize="960x333" alt="">
  <figcaption>副垃圾回收器移动 ‘intermediate’ 子代的活动对象到老生代</figcaption>
</figure>

副垃圾回收器在清理时，实际上执行三个步骤：标记，移动活动对象，和更新对象的指针；这些都是交错进行，而不是在不同阶段。

## Orinoco { #orinoco }

这些算法和优化在很多垃圾回收相关的文献或着具有垃圾回收机制的编程语言中都是非常常见的，但是这些先进的垃圾回收机制已经经过了漫长发展。测量垃圾回收所花费时间的一个重要指标就是执行垃圾回收时主线程挂起的时间。对于传统的 ‘stop-the-world’ 垃圾回收器来说，垃圾回收所花费的时间可以直接简单相加。而这种垃圾回收的方式直接影响了用户体验，会直接导致页面卡顿，渲染延迟等一系列问题。

<figure>
  <img src="/_img/v8-orinoco.svg" width="256" height="256" intrinsicsize="192x192" alt="">
  <figcaption>V8 垃圾回收器 Orinoco 的 LOGO</figcaption>
</figure>

Orinoco 是 V8 垃圾回收器项目的代号，它利用最新的和最好的垃圾回收技术来降低主线程挂起的时间， 比如：并行（parallel）垃圾回收，增量（incremental）垃圾回收和并发（concurrent）垃圾回收。这里有一些术语在垃圾回收的上下文中有特定的含义，所以这是值得去详细的探讨的。

### 并行垃圾回收 { #parallel }

并行是主线程和协助线程同时执行同样的工作，但是这仍然是一种 ‘stop-the-world’ 的垃圾回收方式，但是垃圾回收所耗费的时间等于总时间除以参与的线程数量（加上一些同步开销）。这是这三种技术中最简单的 JavaScript 垃圾回收方式；因为没有 JavaScript 的执行，因此只要确保同时只有一个协助线程在访问对象就好了。

<figure>
  <img src="/_img/trash-talk/05.svg" intrinsicsize="490x168" alt="">
  <figcaption>主线程和协助线程同在一时间做同样的任务</figcaption>
</figure>

### 增量垃圾回收 { #incremental }

增量式垃圾回收是主线程间歇性的去做少量的垃圾回收的方式。我们不会在增量式垃圾回收的时候执行整个垃圾回收的过程，只是整个垃圾回收过程中的一小部分工作。做这样的工作是极其困难的，因为 JavaScript 也在做增量式垃圾回收的时候同时执行，这意味着堆的状态已经发生了变化，这有可能会导致之前的增量回收工作完全无效。从图中可以看出并没有减少主线程暂停的时间（事实上，通常会略微增加），只会随着时间的推移而增长。但这仍然是解决问题的的好方法，通过 JavaScript 间歇性的执行，同时也间歇性的去做垃圾回收工作，JavaScript 的执行仍然可以在用户输入或者执行动画的时候得到及时的响应。

<figure>
  <img src="/_img/trash-talk/06.svg" intrinsicsize="452x129" alt="">
  <figcaption>垃圾回收任务交错的进入主线程执行</figcaption>
</figure>

### 并发垃圾回收 { #concurrent }

并发是主线程一直执行 JavaScript，而辅助线程在后台完全的执行垃圾回收。这种方式是这三种技术中最难的一种，JavaScript 堆里面的内容随时都有可能发生变化，从而使之前做的工作完全无效。最重要的是，现在有读/写竞争（read/write races），主线程和辅助线程极有可能在同一时间去更改同一个对象。这种方式的优势也非常明显，主线程不会被挂起，JavaScript 可以自由地执行 ，尽管为了保证同一对象同一时间只有一个辅助线程在修改而带来的一些同步开销。

<figure>
  <img src="/_img/trash-talk/07.svg" intrinsicsize="443x168" alt="">
  <figcaption>垃圾回收任务完全发生在后台，主线程可以自由的执行 JavaScript</figcaption>
</figure>

## V8 里面当前使用的几种垃圾回收机制 { #state }

### Scavenging { #scavenging }

现今，V8 在新生代垃圾回收中使用并行清理，每个协助线程会将所有的活动对象都移动到 ‘To-Space’。在每一次尝试将活动对象移动到 ‘To-Space’ 的时候必须通确保原子化的读和写以及比较和交换操作。不同的协助线程都有可能通过不同的路径找到相同的对象，并尝试将这个对象移动到 ‘To-Space’；无论哪个协助线程成功移动对象到 ‘To-Space’，都必须更新这个对象的指针，并且去维护移动这个活动对象所留下的转发地址。以便于其他协助线程可以找到该活动对象更新后的指针。为了快速的给幸存下来的活动对象分配内存，清理任务会使用线程局部分配缓冲区。

<figure>
  <img src="/_img/trash-talk/08.svg" intrinsicsize="960x339" alt="">
  <figcaption>并行清理在主线程和多个协助线程之间分配清理任务</figcaption>
</figure>

### Major GC { #major-gc-state }

V8 中的主垃圾回收器主要使用并发标记，一旦堆的动态分配接近极限的时候，将启动并发标记任务。每个辅助线程都会去追踪每个标记到的对象的指针以及对这个对象的引用。在 JavaScript 执行的时候，并发标记在后台进行。[写入屏障（write barriers）](https://dl.acm.org/citation.cfm?id=2025255)技术在辅助线程在进行并发标记的时候会一直追踪每一个 JavaScript 对象的新引用。

<figure>
  <img src="/_img/trash-talk/09.svg" intrinsicsize="960x339" alt="">
  <figcaption>主垃圾回收器并发的去标记和清除对象，并行的去整理内存和更新活动对象的指针</figcaption>
</figure>

当并发标记完成或者动态分配到达极限的时候，主线程会执行最终的快速标记步骤；在这个阶段主线程会被暂停，这段时间也就是主垃圾回收器执行的所有时间。在这个阶段主线程会再一次的扫描根集以确保所有的对象都完成了标记；然后辅助线程就会去做更新指针和整理内存的工作。并非所有的内存页都会被整理，之前提到的加入到空闲列表的内存页就不会被整理。在暂停的时候主线程会启动并发清理的任务，这些任务都是并发执行的，并不会影响并行内存页的整理工作和 JavaScript 的执行。

## 空闲时垃圾回收器 { #idle-time-gc }

JavaScript 是无法去直接访问垃圾回收器的，这些都是在V8的实现中已经定义好的。但是 V8 确实提供了一种机制让Embedders（嵌入V8的环境）去触发垃圾回收，即便 JavaScript 本身不能直接去触发垃圾回收。垃圾回收器会发布一些 “空闲时任务（Idle Tasks）”，虽然这些任务都是可选的，但最终这些任务会被触发。像 Chrome 这些嵌入了 V8 的环境会有一些空闲时间的概念。比如：在 Chrome 中，以每秒60帧的速度去执行一些动画，浏览器大约有16.6毫秒的时间去渲染动画的每一帧，如果动画提前完成，那么 Chrome 在下一帧之前的空闲时间去触发垃圾回收器发布的空闲时任务。

<figure>
  <img src="/_img/trash-talk/10.svg" intrinsicsize="424x252" alt="">
  <figcaption>空闲时垃圾回收器，利用主线程上的空闲时间主动的去执行垃圾回收工作</figcaption>
</figure>

如果想知道空闲时垃圾回收器更详细的内容，请看这篇文章 [our in-depth publication on idle-time GC](https://queue.acm.org/detail.cfm?id=2977741)。

## 小贴士 { #takeaways }

V8 的垃圾回收器项目自立项以来已经走过了漫长的道路。向现有的垃圾回收器添加并行、并发和增量垃圾回收技术经过了很多年的努力，并且也已经取得了一些成效。将大量的移动对象的任务转移到后台进行，大大减少了主线程暂停的时间，改善了页面卡顿，让动画，滚动和用户交互更加流畅。[Scavenger 回收器](/blog/orinoco-parallel-scavenger)将新生代的垃圾回收时间减少了大约 20% - 50%，[空闲时垃圾回收器](/blog/free-garbage-collection)在 Gmail 网页应用空闲的时候将 JavaScript 堆内存减少了 45%。[并发标记清理](/blog/jank-busters)可以减少大型 WebGL 游戏的主线程暂停时间，最多可以减少 50%。

但是任重而道远，减少垃圾收集导致主线程暂停的时间，为用户提供流畅的体验是非常重要的，我们正在研究更高级的技术。最重要的是 Blink（Chrome 的渲染引擎）也有一个垃圾回收器（Oilpan），我们正在改善两个垃圾回收器之间的协作，并准备将一些新技术从 V8 的垃圾回收器（Orinoco）移植到 Oilpan 上。

大部分 JavaScript 开发人员并不需要考虑垃圾回收，但是了解一些垃圾回收的内部原理，可以帮助你了解内存的使用情况，以及采取合适的编范式。比如：从 V8 堆内存的分代结构和垃圾回收器的角度来看，创建生命周期较短的对象的成本是非常低的，但是对于生命周期较长的对象来说成本是比较高的。这些模式是适用于很多动态编程语言的，而不仅仅是 JavaScript。
