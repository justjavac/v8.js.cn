---
title: '优化 V8 内存消耗'
author: 'the V8 Memory Sanitation Engineers Ulan Degenbaev, Michael Lippautz, Hannes Payer, and Toon Verwaest'
avatars:
  - 'ulan-degenbaev'
  - 'michael-lippautz'
  - 'hannes-payer'
date: 2016-10-07 13:33:37
tags:
  - memory
  - benchmarks
description: 'V8 团队分析并显著减少了一些被认为是现代 Web 开发模式代表的网站的内存占用。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
内存消耗是 JavaScript 虚拟机性能折衷空间（trade-off space）中的一个重要方面。在过去的几个月中，V8 团队分析并显著减少了一些被认为是现代 Web 开发模式代表的网站的内存占用。在此博客文章中，我们介绍了我们在分析中使用的工作负载和工具，概述了垃圾回收器中的内存优化，并展示了如何减少 V8 的解析器及其编译器消耗的内存。

## 基准测试 { #benchmarks }

为了分析 V8 并发现对最大数量的用户有影响的优化，至关重要的是定义可重现，有意义的工作负载，并模拟常见的实际 JavaScript 使用场景。这项功能的一个很好的工具是 [Telemetry](https://catapult.gsrc.io/telemetry)，它是一种性能测试框架，可以在 Chrome 中运行脚本化的网站交互，并记录所有服务器响应，以便在我们的测试环境中可预测地重放这些交互。我们选择了一组受欢迎的新闻，社交和媒体网站，并为它们定义了以下常见的用户交互：

浏览新闻和社交网站的工作负载：

1. 打开热门新闻或社交网站，例如 Hacker News。
1. 点击第一个链接。
1. 等到新网站加载完毕。
1. 向下滚动几页。
1. 点击后退按钮。
1. 点击原始网站上的下一个链接，然后重复步骤 3-6 几次。

浏览媒体网站的工作负载：

1. 在热门媒体网站上打开一个项目，例如 YouTube 上的视频。
1. 等待几秒钟来消耗该项目。
1. 点击下一项，然后重复步骤2-3几次。

捕获工作流后，可以根据需要针对开发版本的 Chrome 进行重放，例如，每次有新的 V8 版本。在播放期间，以固定的时间间隔对 V8 的内存使用情况进行采样，以获得有意义的平均值。基准可以在[这里](https://cs.chromium.org/chromium/src/tools/perf/page_sets/system_health/browsing_stories.py?q=browsing+news&sq=package:chromium&dr=CS&l=11)找到。

## 内存可视化 { #memory-visualization }

一般而言，优化性能时的主要挑战之一是清楚地了解内部 VM 状态以跟踪进度或权衡潜在的折衷。为了优化内存消耗，这意味着要在执行过程中准确跟踪 V8 的内存消耗。必须跟踪两类内存：分配给 V8 托管堆（managed heap）的内存和分配给 C++ 堆的内存。**V8 堆统计信息**功能是从事 V8 内部工作的开发人员用来深入了解这两者的一种机制。如果在运行 Chrome（54 或更高版本）或 `d8` 命令行界面时指定了 `--trace-gc-object-stats` 标志，则 V8 会将与内存相关的统计信息转储到控制台。我们构建了一个自定义工具，[V8 堆可视化工具](https://mlippautz.github.io/v8-heap-stats/)，以可视化此输出。该工具显示托管堆和 C++ 堆的基于时间轴的视图。该工具还提供了某些内部数据类型的内存使用情况的详细分类，以及每种类型的基于大小的直方图。

在优化过程中，常见的工作流程包括在时间轴视图中选择一个占用大量堆的实例类型，如图 1 所示。一旦选择了实例类型，该工具就会显示该类型的用途分布。在此示例中，我们选择了 V8 的内部 FixedArray 数据结构，该结构是无类型的类似矢量（vector-like）的容器，在 VM 中的各种位置普遍使用。图 2 显示了一个典型的 FixedArray 分布，其中我们可以看到大部分内存可以归因于特定的 FixedArray 使用场景。在这种情况下，FixedArrays 用作稀疏 JavaScript 数组（我们称为 DICTIONARY_ELEMENTS）的后备存储。利用此信息，可以返回到实际代码，并验证此分布是否确实是预期的行为或是否存在优化机会。我们使用该工具来识别多种内部类型的效率低下的问题。

![图1：托管堆（managed heap）和堆外内存（off-heap memory）的时间线视图](/_img/optimizing-v8-memory/timeline-view.png)

![图2：实例类型的分布](/_img/optimizing-v8-memory/distribution.png)

图 3 显示了 C++ 堆内存消耗，该消耗主要由 zone 内存（V8 在短时间内使用的临时内存区域；下面将详细讨论）组成。由于 V8 解析器和编译器非常广泛地使用了 zone 内存，因此尖峰对应于解析和编译事件。行为良好的执行仅包含尖峰，表示不再需要内存就立即释放。相反，平稳期（即更长的时间段和更高的内存消耗）表明存在优化的空间。

![图3：Zone 内存](/_img/optimizing-v8-memory/zone-memory.png)

早期采用者还可以尝试将其集成到 [Chrome 的 tracing infrastructure](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool) 中。因此，你需要使用 `--track-gc-object-stats` 运行最新的 Chrome Canary，并[捕获](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool/recording-tracing-runs#TOC-Capture-a-trace-on-Chrome-desktop)包括类别 `v8.gc_stats` 的追踪信息。然后，数据将显示在 `V8.GC_Object_Stats` 事件下。

## 减少 JavaScript 堆大小 { #javascript-heap-size-reduction }

在垃圾回收吞吐量，延迟和内存消耗之间存在固有的权衡。例如，可以通过使用更多的内存来避免垃圾回收延迟（这会导致用户可见的 jank），从而避免频繁的垃圾回收调用。对于内存不足的移动设备（例如 RAM 不足 512 MB 的设备），将延迟和吞吐量优先于内存消耗可能会导致内存不足崩溃并导致 Android 上的标签页挂起暂停。

为了更好地平衡这些低内存移动设备的权衡取舍，我们引入了一种特殊的内存减少模式，该模式可以调整几种垃圾回收启发式方法，以降低 JavaScript 垃圾回收堆的内存使用率。

1. 在完整的垃圾回收结束时，V8 的堆增长策略将根据活动对象的数量（带有一些额外的空闲时间）来确定何时进行下一次垃圾回收。在内存减少模式下，V8使用较少的空闲时间，这是由于更频繁的垃圾回收而导致较少的内存使用。
1. 此外，此估计值被视为硬限制，迫使未完成的增量标记工作在主垃圾收集停顿中完成。通常，当不在内存减少模式下时，未完成的增量标记工作可能会导致超过该任意限制，从而仅在标记完成后才触发主垃圾回收停顿。
1. 通过执行更积极的内存压缩，可以进一步减少内存碎片。

图 4 描述了自 Chrome 53 以来低内存设备的一些改进。最明显的是，《纽约时报》移动基准测试的平均 V8 堆内存消耗减少了约 66％。总体而言，在这套基准测试中，我们观察到平均 V8 堆大小减少了50％。

![图 4：自 Chrome 53 以来低内存设备上的 V8 堆内存减少](/_img/optimizing-v8-memory/heap-memory-reduction.png)

最近引入的另一项优化不仅减少了低内存设备的内存，而且还增强了移动和台式机的性能。当不存在太多活动对象时，将 V8 堆页面大小从 1 MB 减小到 512 kB 会导致较小的内存占用，并将总内存碎片降低 2 倍。它还允许 V8 执行更多的压缩工作，因为较小的工作块允许内存压缩线程并行完成更多的工作。

## Zone 内存减少 { #zone-memory-reduction }

除了 JavaScript 堆外，V8 还使用堆外内存（off-heap memory）进行内部 VM 操作。最大的内存块是通过称为 _zones_ 的内存区域分配的。Zones 是一种基于区域（region-based）的内存分配器，可实现快速分配和批量释放，其中在销毁 zone 时立即释放所有 zone 分配的内存。在 V8 的解析器和编译器中都使用 Zones。

Chrome 55 的一项重大改进来自减少后台解析过程中的内存消耗。后台解析允许 V8 在加载页面时解析脚本。内存可视化工具帮助我们发现，后台解析器将在代码已编译很长时间后使整个 zone 保持活动状态。通过在编译后立即释放区域，我们显着减少了区域的生存时间，从而减少了平均和峰值内存使用量。

另一个改进是由解析器生成的 _抽象语法树（abstract syntax tree）_ 节点中字段的更好打包带来的。以前，我们依靠 C++ 编译器在可能的情况下将字段打包在一起。例如，两个布尔仅需要两个位，并且应位于一个字（word）内或前一个字的未使用部分内。 C++ 编译器并不总是找到压缩率最高的压缩包，因此我们改为手动打包位（bits）。这不仅可以减少峰值内存使用量，而且可以提高解析器和编译器的性能。

图 5 显示了自 Chrome 54 以来，峰值 zone 内存消耗的改进，与所测量的网站相比，平均降低了约 40％。

![图5：自桌面版 Chrome 54 以来，峰值 zone 内存减少](/_img/optimizing-v8-memory/peak-zone-memory-reduction.png)

在接下来的几个月中，我们将继续致力于减少 V8 的内存占用。我们为解析器计划了更多的 zone 内存优化，并且我们计划专注于 512 MB – 1 GB 内存的设备。

**更新**：与 Chrome 53 相比，以上讨论的所有改进在 _低内存设备上_ 将 Chrome 55 的整体内存消耗降低了 35％。其它设备段仅受益于 zone 内存的改进。
