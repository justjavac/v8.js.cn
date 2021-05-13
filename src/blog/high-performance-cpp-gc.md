---
title: 'C++ 的高性能垃圾回收（GC）'
author: 'Anton Bikineev, Omer Katz ([@omerktz](https://twitter.com/omerktz)), and Michael Lippautz ([@mlippautz](https://twitter.com/mlippautz)), C++ memory whisperers'
avatars:
  - 'anton-bikineev'
  - 'omer-katz'
  - 'michael-lippautz'
date: 2020-05-26
tags:
  - internals
  - memory
  - cppgc
description: '这篇文章描述了 Oilpan C++ 垃圾回收器，它在 Blink 中的用法以及如何优化清除，即回收无法访问的内存。'
tweet: '1265304883638480899'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---

过去，我们[已经](https://v8.dev/blog/trash-talk)[在](https://v8.dev/blog/concurrent-marking)[写](https://v8.dev/blog/tracing-js-dom)有关 JavaScript 的垃圾回收，文档对象模型（DOM），以及如何在 V8 中实现和优化所有这些内容。不过，并不是 Chromium 中的所有内容都是 JavaScript，因为大多数浏览器及其嵌入 V8 的 Blink 渲染引擎都是用 C++ 编写的。JavaScript 可用于与 DOM 交互，然后由渲染管道（pipeline）对其进行处理。

由于围绕 DOM 的 C++ 对象图（object graph）与 Javascript 对象紧密耦合在一起，因此 Chromium 小组在几年前改用了名为 [Oilpan](https://www.youtube.com/watch?v=_uxmEyd6uxo) 的垃圾回收器（garbage collector，GC）来管理这种内存。Oilpan 是一个用 C++ 编写的垃圾回收器，用于管理 C++ 内存，该内存可以使用[跨组件跟踪](https://research.google/pubs/pub47359/)连接到 V8，该组件将耦合的 C++/JavaScript 对象图视为一个堆（heap）。

这篇文章是有关 Oilpan 博客系列文章中的第一篇，它将概述 Oilpan 的核心概念及其 C++ API。在这篇文章中，我们将介绍一些受支持的功能，解释它们如何与垃圾回收器的各个子系统交互，并深入研究如何同时清除清除器（sweeper）中的对象。

最令人兴奋的是，目前在 Blink 中实现了 Oilpan，但以[垃圾收集库](https://chromium.googlesource.com/v8/v8.git/+/HEAD/include/cppgc/)的形式迁移到了 V8。目标是使所有 V8 嵌入程序和更多的 C++ 开发人员都可以轻松使用 C ++ 垃圾回收。

## 背景 { #background }

Oilpan 实现了[标记-清除（Mark-Sweep）](https://en.wikipedia.org/wiki/Tracing_garbage_collection)垃圾回收器，其中垃圾收集分为两个阶段：*标记（marking）* 在托管堆（managed heap）中扫描后的活动对象（live objects）的位置，以及*清除（sweeping）* 在托管堆中被回收死亡对象（dead objects）的位置。

在 V8 中引入[并发标记](https://v8.dev/blog/concurrent-marking)时，我们已经介绍了标记的基础知识。概括地说，扫描所有对象以获取活动对象可以看作是图形遍历，其中对象是节点，而对象之间的指针是边。遍历始于根，即寄存器，本机执行堆栈（我们将从现在开始将其称为调用栈，call stack）和其它全局变量，如[此处](https://v8.dev/blog/concurrent-marking#background)所述。

在这方面，C ++ 与 JavaScript 并无不同。与 JavaScript 相反，C++ 对象是静态类型的，因此无法在运行时更改其表示形式。使用 Oilpan 管理的 C++ 对象利用了这一事实，并通过访问者模式提供了指向其它对象的指针（图的边）的描述。描述 Oilpan 对象的基本模式如下：

```cpp
class LinkedNode final : public GarbageCollected<LinkedNode> {
 public:
  LinkedNode(LinkedNode* next, int value) : next_(next), value_(value) {}
  void Trace(Visitor* visitor) const {
    visitor->Trace(next_);
  }
 private:
  Member<LinkedNode> next_;
  int value_;
};

LinkedNode* CreateNodes() {
  LinkedNode* first_node = MakeGarbageCollected<LinkedNode>(nullptr, 1);
  LinkedNode* second_node = MakeGarbageCollected<LinkedNode>(first_node, 2);
  return second_node;
}
```

在上面的示例中，`LinkedNode` 由 Oilpan 管理，如继承自 `GarbageCollected<LinkedNode>` 所示。当垃圾回收器处理对象时，它通过调用对象的 `Trace` 方法发现传出的指针。类型 `Member` 是一个智能指针，其语法类似于 `std::shared_ptr`，由 Oilpan 提供，用于在标记过程中遍历图形时保持一致的状态。所有这些使 Oilpan 能够精确地知道指针在其托管对象中的位置。

狂热的读者可能已经注意到，~~并且可能害怕~~在上例中将 `first_node` 和 `second_node` 作为原始 C++ 指针保存在堆栈中。Oilpan 不添加用于堆栈的抽象，而是仅依靠保守的堆栈扫描来在处理根节点时在其托管堆中查找指针。通过逐字迭代堆栈并将这些字解释为指向托管堆的指针来工作。这意味着Oilpan 不会因访问堆栈分配的对象（stack-allocated objects）而对性能造成任何影响。取而代之的是，它将成本转移到垃圾回收时间，在此时间它会保守地扫描堆栈。集成在渲染器中的 Oilpan 会尝试延迟垃圾回收，直到达到确保没有 interesting 堆栈的状态为止。由于 Web 是基于事件的，并且执行是由事件循环中的处理任务来驱动的，因此这种机会很多。

Oilpan 用于 Blink，Blink 是具有大量成熟代码的大型 C++ 代码库，因此还支持：

- 通过 mixin 的多重继承以及对此类 mixin 的引用（内部指针）。
- 在执行构造函数期间触发垃圾回收。
- 通过 `Persistent` 智能指针（被视为根）将对象保留在非托管内存中。
- 顺序集合（例如 vector）和关联容器（例如 set 和 map）的集合，并压缩了集合支持。
- 弱引用，弱回调和 [ephemerons](https://en.wikipedia.org/wiki/Ephemeron)。
- 在回收单个对象之前执行的终结器（Finalizer）回调。

## C++ 清除 { #sweeping-for-c++ }

请继续关注有关 Oilpan 中标记工作的细节的博客文章。对于本文，我们假定标记已完成，并且 Oilpan 借助其 `Trace` 方法发现了所有可到达的对象。标记完所有可到达的对象后，并设置其标记位（mark bit）。

清除（Sweeping）是回收死对象（在标记过程中无法到达的对象）并将其基础内存返回操作系统或使其可用于后续分配的阶段。在下面的内容中，我们将从使用和约束的角度展示 Oilpan 的清除程序（sweeper）如何工作，以及如何实现较高的回收吞吐量。

清除程序通过迭代堆内存并检查标记位来查找死亡对象。为了保留 C++ 语义，清除程序必须在释放其内存之前调用每个死亡对象的析构函数。Non-trivial 析构函数被实现为终结器。

从程序员的角度来看，没有定义执行析构函数的顺序，因为清除程序使用的迭代不考虑构造顺序。这施加了一个限制，即不允许终结器接触其它堆上对象。 这是编写需要终结顺序的用户代码的普遍挑战，因为托管语言通常不支持其终结语义（例如 Java）中的顺序。Oilpan 使用 Clang 插件来静态验证（除其它外）在破坏对象期间没有访问堆对象：

```cpp
class GCed : public GarbageCollected<GCed> {
 public:
  void DoSomething();
  void Trace(Visitor* visitor) {
    visitor->Trace(other_);
  }
  ~GCed() {
    other_->DoSomething();  // error: Finalizer '~GCed' accesses
                            // potentially finalized field 'other_'.
  }
 private:
  Member<GCed> other_;
};
```

出于特殊例外：Oilpan 为需要销毁对象之前要访问堆的复杂用例提供了预完成回调（pre-finalization callbacks）。但是，在每个垃圾回收周期中，此类回调比析构函数引入更多的开销，并且仅在 Blink 中少量使用。
For the curious: Oilpan provides pre-finalization callbacks for complex use cases that require access to the heap before objects are destroyed. Such callbacks impose more overhead than destructors on each garbage collection cycle though and are only used sparingly in Blink.

## 增量和并发清除 { #incremental-and-concurrent-sweeping }

既然我们已经了解了托管 C++ 环境中析构函数的限制，是时候详细了解 Oilpan 如何实现和优化清除阶段了。

在深入研究细节之前，重要的是要回顾一下一般程序是如何在 Web 上执行的。通过在[事件循环](https://en.wikipedia.org/wiki/Event_loop)中分派任务，可以从主线程驱动任何执行（例如 JavaScript 程序以及垃圾回收）。与其它应用程序环境一样，渲染器支持后台任务，这些后台任务与主线程同时运行，以帮助处理任何主线程工作。

从简单的开始，Oilpan 最初实现了全范围（stop-the-world）的清除，它作为垃圾回收完成终结的一部分而运行，中断了主线程上的应用程序的执行：

![全量清除（Stop-the-world sweeping）](/_img/high-performance-cpp-gc/stop-the-world-sweeping.svg)

对于实时性较弱的应用程序，处理垃圾回收时的决定性因素是延迟。全范围（Stop-the-world）清除可能会导致大量的暂停时间，从而导致用户可见的应用程序延迟。为了减少延迟，下一步是逐步进行清除：

![增量清除（Incremental sweeping）](/_img/high-performance-cpp-gc/incremental-sweeping.svg)

使用增量方法，可以将清除工作拆分并委派给其它主线程任务。在最佳情况下，此类任务会在[空闲时间](https://research.google/pubs/pub45361/)完全执行，从而避免干扰任何常规应用程序的执行。 在内部，清扫程序会根据页面（pages）概念将工作划分为多个较小的单元。页面可能处于两种有趣的状态：清除程序仍需要处理的*待清除*页面，以及清除程序已处理的*已清除*页面。内存分配仅考虑已经清扫的页面，并且将从维护可用内存块列表的空闲列表中重新填充本地分配缓冲区（LAB）。为了从空闲列表中获取内存，应用程序将首先尝试在已清除（already-swept）的页面中查找内存，然后尝试通过将清除算法内联到内存分配中来帮助处理待清除（to-be-swept）的页面，并且仅在没有任何东西（none）的情况时才向操作系统请求新的内存： 空无一人。

Oilpan 使用增量清除已经有多年了，但是随着应用程序及其生成的对象图越来越大，清除开始影响应用程序的性能。为了改善增量清除，我们开始利用后台任务来同时回收内存。有两个基本原则用于排除执行清除程序的后台任务与分配新对象的应用程序之间的任何数据争用：

- 清除程序仅处理死亡内存，根据定义死亡内存是应用程序无法访问的。
- 该应用程序仅在已经清除的页面上分配内存，根据定义清除程序将不再处理这些页面。

这两个原则确保对象及其内存不存在竞争者。不幸的是，C++ 严重依赖于作为终结器实现的析构函数。Oilpan 强制终结器（finalizers）在主线程上运行，以帮助开发人员并排除应用程序代码内部的数据争用。为了解决此问题，Oilpan 将对象终结处理推迟到主线程。更具体地讲，每当并发清除程序遇到具有终结器（析构函数）的对象时，它将其推入终结队列（finalization queue），该队列将在单独的终结阶段中进行处理，该队列始终在运行应用程序的主线程上执行。并发清除的总体工作流程如下所示：

![使用后台任务的并发清除（Concurrent sweeping）](/_img/high-performance-cpp-gc/concurrent-sweeping.svg)

由于终结器可能需要访问对象的所有有效负载，因此将相应的内存添加到空闲列表将延迟到执行终结器之后。如果没有可被执行的终结器，则在后台线程上运行的清除程序会立即将回收的内存添加到空闲列表中。

# 结果

Chrome M78 随附了后台清除功能。我们的[实际基准测试框架](https://v8.dev/blog/real-world-performance)显示主线程清除时间减少了 25％-50％（平均为 42％）。请在下面查看一组选定的集合项。

![主线程清除时间（以毫秒为单位）](/_img/high-performance-cpp-gc/results.svg)

在主线程上花费的剩余时间用于执行终结器。目前正在进行有关减少 Blink 中大量实例化对象类型的终结器的工作。这里令人兴奋的部分是所有这些优化都是在应用程序代码中完成的，因为在没有终结器的情况下，清除会自动进行调整。

请继续关注有关 C++ 垃圾回收的更多文章，尤其是随着我们逐渐接近 V8 的所有用户都可以使用的发行版，特别是针对 Oilpan 库的更新。
