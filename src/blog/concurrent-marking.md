---
title: 'V8 的并发标记'
author: 'Ulan Degenbaev, Michael Lippautz, and Hannes Payer — main thread liberators'
avatars:
  - 'ulan-degenbaev'
  - 'michael-lippautz'
  - 'hannes-payer'
date: 2018-06-11 13:33:37
tags:
  - internals
  - memory
description: 'This post describes the garbage collection technique called concurrent marking.'
tweet: '1006187194808233985'
cn:
  author: '本文由开源中国翻译，[原文地址](https://www.oschina.net/translate/v8-javascript-engine)。参与翻译：kevinlinkai, Tocy, 琪花亿草, 豆豆胡萝卜, 焙焙龙, 凉凉_'
---
本文详细描述了被称为**并发标记**的垃圾回收技术。该优化允许 JavaScript 应用在垃圾回收器扫描其堆以查找和标记活动对象时可继续执行。我们的基准测试显示，并发标记相比在主线程上标记节省了 60％-70％ 的时间。并发标记是 [Orinoco 项目](/blog/orinoco) 的最后一块拼图 - 使用新的多并发和并行垃圾回收机制增量地替换旧的垃圾回收机制的项目。Chrome 64 和 Node.js v10 默认启用并发标记。

## 背景 { #background }

标记是 V8 的 [Mark-Compact](https://en.wikipedia.org/wiki/Tracing_garbage_collection) 垃圾收集器的一个阶段。在这个阶段中，收集器发现并标记了所有的活动对象。标记从一组已知的活动对象开始，例如全局对象和当前活动函数——所谓的根。收集器将根标记为活动的，并跟随指针来发现更多的活动对象。收集器继续标记新发现的对象并跟随标记指针，直到没有需要标记的对象为止。在标记结束时，应用程序无法访问堆中未被标记的对象，并且可以安全的回收。

我们可以将标记认为是[图遍历](https://en.wikipedia.org/wiki/Graph_traversal)。堆上的对象是图的节点。从一个对象指向另一个对象是图的边。从图中给一个节点，我们可以使用对象的[隐藏类 hidden class](/blog/fast-properties) 找出该节点所有外出边（out-going edges）。

![图示 1. 对象关系图](/_img/concurrent-marking/00.svg)

V8 使用每个对象的两个标记位和一个标记工作表来实现标记。两个标记位编码三种颜色：白色（`00`），灰色（`10`）和黑色（`11`）。最初所有的对象都是白色，意味着收集器还没有发现他们。当收集器发现一个对象时，将其标记为灰色并推入到标记工作表中。当收集器从标记工作表中弹出对象并访问他的所有字段时，灰色就会变成黑色。这种方案被称做三色标记法。当没有灰色对象时，标记结束。所有剩余的白色对象无法达到，可以被安全的回收。

![图示 2. 从根节点开始标记](/_img/concurrent-marking/01.svg)

![图示 3. 收集器通过处理其指针将灰色对象变为黑色](/_img/concurrent-marking/02.svg)

![图示 Figure 4. 标记完成后的最终状态](/_img/concurrent-marking/03.svg)

需要注意的是，上述标记法仅适用于在标记进行中应用程序暂停的情况。如果我们允许应用程序在标记过程中运行，那么应用程序可能改变图并且最终欺骗收集器释放活动对象。

## 减少标记暂停 { #reducing-marking-pause }

一次执行标记可能需要几百毫秒才能完成一个很大的堆。

![](/_img/concurrent-marking/04.svg)

这样长时间的停顿可能会使应用程序无响应，并导致用户体验不佳。在 2011 年，V8 从 stop-the-world 标记切换到增量标记。在增量标记期间，垃圾收集器将标记工作分解为更小的块，并且允许应用程序在块之间运行：

![](/_img/concurrent-marking/05.svg)

垃圾收集器选择在每个块中执行多少增量标记来匹配应用程序的分配速率。一般情况下，这极大地提高了应用程序的响应速度。对内存压力较大的堆，收集器仍然可能出现长时间的暂停来维持分配。

增量标记不是没有代价的。应用程序必须通知垃圾收集器关于改变对象图的所有操作。V8 使用 Dijkstra 风格的写屏障（write-barrier）机制来实现通知。在 JavaScript 中，每次形如 `object.field = value` 的写操作之后，V8 会插入 write-barrier 代码。

```cpp
// 调用 `object.field = value` 之后
write_barrier(object, field_offset, value) {
  if (color(object) == black && color(value) == white) {
    set_color(value, grey);
    marking_worklist.push(value);
  }
}
```

Write-barrier 机制强制不变黑的对象指向白色对象。这也被称为强三色不变性，保证应用程序不能在垃圾收集器中隐藏活动对象，因此标记结束时的所有白色对象对于应用程序来说都是不可达的，可以安全释放。

就像[之前博客](/blog/free-garbage-collection)中描述的那样，增量标记很好的集成了空闲时间垃圾收集调度。Chrome 的 Blink 任务调度程序可以在主线程的空闲时间调度小的增量标记步骤，而不会造成混乱。如果空闲时间可用，该优化效果将会非常好。

由于 write-barrier 机制的成本，增量标记可能会降低应用程序的吞吐量。通过使用额外的工作线程可以改善吞吐量和暂停时间。有两种方法可以在工作线程上进行标记：并行标记和并发标记。

**并行**标记发生在主线程和工作线程上。应用程序在整个并行标记阶段暂停。它是 stop-the-world 标记的多线程版本。

![](/_img/concurrent-marking/06.svg)

**并发**标记主要发生在工作线程上。当并发标记正在进行时，应用程序可以继续运行。

![](/_img/concurrent-marking/07.svg)

下面两节描述我们如何在 V8 中添加对并行和并发标记的支持。

## 并行标记 { #parallel-marking }

在并行标记的时候，我们可以假定应用都不会同时运行。这大大的简化了实现，因为我们可以假定对象图是静态的，而且不会改变。为了并行标记对象图，我们需要让垃圾收集数据结构是线程安全的，而且寻找一个可以在线程间运行的高效共享标记的方法。下面的示意图展示了并行标记包含的数据结构。箭头代表数据流的方向。简单来说，示意图省略了堆碎片处理所需的数据结构。

![图示 5. 并行标记使用到的数据结构](/_img/concurrent-marking/08.svg)

注意，这些线程只能读取对象图，而不能修改它。对象的标记位和标记列表必须支持读写访问。

## 标记工作列表和工作窃取 { #marking-worklist-and-work-stealing }

标记工作列表（marking-worklist）的实现对性能至关重要，而且它通过在其他线程没有工作可做的情况下，有多少工作可以分配给他们，来平衡快速线程本地的性能。

要权衡的两个极端的情况是（a）使用完全并发数据结构，达成最佳共享即所有对象都可以隐式共享，和（b）使用完全本地线程（thread-local）数据结构，没有对象可以共享，优化线程本地吞吐量。图 6 展示了 V8 是如何通过使用一个基于本地线程插入和删除的段的标记工作列表来平衡这些需求的。一旦一个段满了，它会被发布到一个可以用来窃取的共享全局池。使用这种方法，V8 允许标记线程在不用任何同步的情况下尽可能长的执行本地操作，而且还处理了当单个线程达成了一个新的对象子图，而另一个线程在完全耗尽了本地段时饥饿的情况。

![图示 6. Marking worklist](/_img/concurrent-marking/09.svg)

## 并发标记 { #concurrent-marking }

当工作线程正在访问堆上的对象的同时，并发标记允许 JavaScript 在主线程上运行。这为潜在的竞态数据打开大门。举个例子：当工作者线程正在读取字段时，JavaScript 可能正在写入对象字段。竞态数据会混淆垃圾回收器释放活动对象或者将原始值和指针混合在一起。

主线程的每个改变对象图的操作将会是竞态数据的潜在来源。由于 V8 是具有多种对象布局优化功能的高性能引擎，潜在竞态数据来源相当多。以下是 high-level 列表：

- 对象分配
- 写对象
- 对象布局变化
- 快照反序列化
- 功能去优化（deopt）实现
- 新生代垃圾回收期间的疏散
- 代码修补

在以上这些操作上，主线程需要与工作线程同步。同步代价和复杂度视操作而定。大部分操作允许轻量级的同步和原子操作之间的访问，但是少部分操作需独占访问对象。在下面的小节中我们强调一些有趣的案例。

### 写屏障 { #write-barrier }

通过写入对象字段导致的数据竞争通过将写入操作转变为[放宽原子写入](https://en.cppreference.com/w/cpp/atomic/memory_order#Relaxed_ordering)并调整写屏障来解决：

```cpp
// 调用 `atomic_relaxed_write(&object.field, value)` 后
write_barrier(object, field_offset, value) {
  if (color(value) == white && atomic_color_transition(value, white, grey)) {
    marking_worklist.push(value);
  }
}
```

与上面的写屏障进行比较：

```cpp
// 调用 `object.field = value` 后
write_barrier(object, field_offset, value) {
  if (color(object) == black && color(value) == white) {
    set_color(value, grey);
    marking_worklist.push(value);
  }
}
```

这有两个变化：

1. 不对源对象进行颜色检查 (`color(object) == black`)
2. `value` 的颜色从白色到灰色的转换变成了原子操作

如果不对源对象进行颜色检查，写屏障变得更保守。举个例子，只要对象存在都会标记他们就算那些对象是无法获取的。我们删除了这个检查以避免在写操作和写障碍之间需要昂贵的内存栅栏（memory fence）：

```cpp
atomic_relaxed_write(&object.field, value);
memory_fence();
write_barrier(object, field_offset, value);
```

没有内存栅栏（memory fence），当执行加载对象颜色的操作时在写操作之前将会被重排序。如果我们不阻止重排序，那么写屏障观察到对象颜色变灰并释放它（bail out），而工作线程在没有看到新值的情况下标记对象。由 Dijkstra 等人提出的原始写屏障不会检查对象的颜色。他们这么做是为了简单，但是我们这么做则是为了保证程序的正确性。

### Bailout worklist { #bailout-worklist }

某些操作（例如代码打补丁）需要独占访问该对象。在早期，我们决定避免每个对象的锁，因为它们可能导致优先级反转问题，其中主线程必须等待一个持有该对象锁的非调度的工作线程。作为锁定一个对象的替代方案，我们允许工作线程通过访问该对象来避免这些麻烦。工作线程通过将对象推入 bailout worklist 来完成此功能，该工作清单仅由主线程处理：

![图示 7. The bailout worklist](/_img/concurrent-marking/10.svg)

工作线程在优化的代码对象、隐藏类和弱集合上进行处理，因为访问它们需要加锁或高开销的同步协议。

回顾过去，bailout worklist 对增量开发来说是非常有用的。我们开始使用工作线程来处理所有对象类型并逐一添加并发机制。

### 对象布局更改 { #object-layout-changes }

对象的字段可以存储三种值：标记的指针，标记的小整数（也称为 Smi），或未标记的值，如未装箱的浮点数。[指针标记 pointer tagging](https://en.wikipedia.org/wiki/Tagged_pointer) 是一种众所周知的技术，可以有效地表示未装箱的整数。在 V8 中，标记值的最低有效位指示它是指针还是整数。这依赖于指针是字对齐（word-aligned）的事实。有关字段是标记的还是未标记的信息存储在对象的隐藏类中。

通过将对象转换为另一个隐藏类，V8 中的一些操作将对象字段从标记变为未标记（反之亦然）。这种对象布局更改对于并发标记是不安全的。如果在工作线程使用旧的隐藏类同时访问对象时发生更改，则可能会出现两种类型的错误。首先，工作流可能会错过一个指针，认为这是一个没有标记的值。使用写屏障可以防止这种错误。其次，工作流可能会将未标记的值视为指针并将其解引用，这会导致无效的内存访问，通常会导致程序崩溃。为了处理这种情况，我们使用一个在对象标记位上同步的快照协议。该协议涉及两方面：主线程将对象字段从标记变为未标记以及工作线程访问对象。在更改字段之前，主线程会确保该对象被标记为黑色并将其推入 bailout worklist 供以后访问：

```cpp
atomic_color_transition(object, white, grey);
if (atomic_color_transition(object, grey, black)) {
  // The object will be revisited on the main thread during draining
  // of the bailout worklist.
  bailout_worklist.push(object);
}
unsafe_object_layout_change(object);
```

如下面的代码片段所示，工作线程首先加载对象的隐藏类并使用[原子放宽加载操作 atomic relaxed load operations](https://en.cppreference.com/w/cpp/atomic/memory_order#Relaxed_ordering) 来为所有由隐藏类指定的对象的指针字段生成快照。然后它会尝试使用原子比较和交换操作将对象标记为黑色。如果标记成功，则意味着快照必须与隐藏类一致，因为主线程在更改其布局之前会将对象标记为黑色。

```cpp
snapshot = [];
hidden_class = atomic_relaxed_load(&object.hidden_class);
for (field_offset in pointer_field_offsets(hidden_class)) {
  pointer = atomic_relaxed_load(object + field_offset);
  snapshot.add(field_offset, pointer);
}
if (atomic_color_transition(object, grey, black)) {
  visit_pointers(snapshot);
}
```

请注意，必须在主线程上标记那些进行过不安全布局更改的白色对象。不安全的布局变化相对较少，所以这对实际应用程序的性能没有太大的影响。

## 把它们放一起 { #putting-it-all-together }

我们将并发标记整合到现有的增量标记基础设施中。主线程通过扫描 root 并填充标记工作表来启动标记。之后，它会在工作线程中发布并发标记任务。工作线程通过合作排除标记工作表来帮助主线程加快标记进度。偶尔主线程通过处理 bailout worklist 和标记工作表来参与标记。标记工作表变空之后，主线程完成垃圾收集。在最终确定期，主线程重新扫描 root，可能会发现更多的白色对象。这些对象在工作线程的帮助下被并行标记。

![](/_img/concurrent-marking/11.svg)

## 结论 { #results }

我们的[真实世界基准测试框架](/blog/real-world-performance)显示，在移动和桌面上每个垃圾回收周期的主线程标记时间分别减少了 65% 和 70%。

![Time spent in marking on the main thread (lower is better)](/_img/concurrent-marking/12.svg)

并发标记也减少了 Node.js 中的垃圾收集 jank。 这点尤其重要，因为 Node.js 从未实现空闲时间垃圾收集调度，因此永远无法在 non-jank-critical 阶段隐藏标记时间。并发标记在 Node.js v10 中发布。
