---
title: '更轻量的 V8'
author: 'Mythri Alle, Dan Elphick, and [Ross McIlroy](https://twitter.com/rossmcilroy), V8 weight-watchers'
avatars:
  - 'mythri-alle'
  - 'dan-elphick'
  - 'ross-mcilroy'
date: 2019-09-12 12:44:37
tags:
  - internals
  - memory
  - presentations
description: 'V8 Lite 项目极大地减少了 V8 在典型网站上的内存开销，我们就是这样做的。'
tweet: '1172155403343298561'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
2018 年底，我们启动了一个名为 V8 Lite 的项目，旨在大幅降低 V8 的内存使用量。最初，这个项目被设想为 V8 的一个单独的 *Lite 模式*，专门针对低内存移动设备或嵌入器用例，这些用例更关心减少内存使用而不是吞吐量、执行速度。然而，在这项工作的过程中，我们意识到我们为这种 *Lite 模式* 所做的许多内存优化可以带到常规 V8 中，从而使 V8 的所有用户受益。

在这篇博文中，我们重点介绍了我们开发的一些关键优化以及它们在实际工作负载中提供的内存节省。

:::note

**注意：** 如果你更喜欢观看演示而不是阅读文章，请欣赏下面的视频！如果没有，请跳过视频并继续阅读。
:::

<figure>
  <div class="video video-16:9">
    <iframe width="560" height="315" src="https://www.youtube.com/embed/56ogP8-eRqA" allow="picture-in-picture" allowfullscreen loading="lazy"></iframe>
  </div>
  <figcaption><a href="https://www.youtube.com/watch?v=56ogP8-eRqA">“V8 Lite  ⁠— 减少 JavaScript 内存”</a> 正如 Ross McIlroy 在 BlinkOn 10 上提出的那样。</figcaption>
</figure>

## Lite 模式 { #lite-mode }

为了优化 V8 的内存使用，我们首先需要了解 V8 如何使用内存以及哪些对象类型占 V8 的堆大小的大部分。我们使用 V8 的[内存可视化](/blog/optimizing-v8-memory#memory-visualization)工具来跟踪许多典型网页中的堆组成。

<figure>
  <img src="/_img/v8-lite/memory-categorization.svg" width="950" height="440" alt="" loading="lazy">
  <figcaption>加载 Times of India 时不同对象类型使用的 V8 堆的百分比。</figcaption>
</figure>

在这样做的过程中，我们确定 V8 堆的很大一部分专用于对 JavaScript 执行不是必需的对象，但用于优化 JavaScript 执行和处理异常情况。示例包括：优化的代码（optimized code）； 用于确定如何优化代码的类型反馈（type feedback）；C++ 和 JavaScript 对象之间绑定的冗余元数据（metadata）；元数据仅在特殊情况下才需要，例如堆栈跟踪符号化；以及在页面加载期间只执行几次的函数的字节码。

因此，我们开始研究 V8 的 *Lite 模式*，该模式通过大大减少这些可选对象的内存分配来平衡 JavaScript 执行速度与改进的内存节省。

![](/_img/v8-lite/v8-lite.png){ .no-darkening }

可以通过配置现有的 V8 设置来进行许多 *Lite 模式* 更改，例如，禁用 V8 的 TurboFan 优化编译器。但是，其他人需要对 V8 进行更多的更改。

特别是，我们决定由于 *Lite 模式* 不优化代码，我们可以避免优化编译器所需的类型反馈的收集。在 Ignition 解释器中执行代码时，V8 会收集有关传递给各种操作（例如 `+` 或 `o.foo`）的操作数类型的反馈，以便针对这些类型进行后期优化。此信息存储在 *反馈向量（feedback vectors）* 中，这些向量占 V8 堆内存使用量的很大一部分。*Lite 模式* 可以避免分配这些反馈向量，但是解释器和 V8 的内联缓存（inline-cache）基础设施的一部分期望反馈向量可用，因此需要大量重构才能支持这种无反馈（feedback-free）执行。

*Lite 模式* 在 V8 v7.3 中启动，与 V8 v7.1 相比，通过禁用代码优化、不分配反馈向量和执行很少执行的字节码的老化（如下所述），典型网页堆大小减少了 22%。对于那些明确希望牺牲性能以更好地使用内存的应用程序来说，这是一个很好的结果。然而，在做这项工作的过程中，我们意识到我们可以通过让 V8 变得更加懒惰来实现 *Lite 模式* 的大部分内存节省，而不会影响性能。

## 延迟反馈分配 { #lazy-feedback-allocation }

完全禁用反馈向量分配不仅会阻止 V8 的 TurboFan 编译器优化代码，还会阻止 V8 执行常见操作的[内联缓存](https://mathiasbynens.be/notes/shapes-ics#ics)，例如 Ignition 解释器中的对象属性加载。因此，这样做会导致 V8 的执行时间显着回归，在典型的交互式网页场景中，页面加载时间减少了 12%，V8 使用的 CPU 时间增加了 120%。

为了在没有这些回归的情况下为常规 V8 带来大部分节省，我们转而采用一种方法，即在函数执行一定数量的字节码（当前为 1KB）后延迟地分配反馈向量。由于大多数函数不会经常执行，因此在大多数情况下我们避免了反馈向量分配，而是在需要时快速分配它们以避免性能回归并仍然允许优化代码。

这种方法的另一个复杂之处在于反馈向量形成一棵树，内部函数的反馈向量作为外部函数反馈向量中的条目。这是必要的，以便新创建的函数闭包接收与为同一函数创建的所有其它闭包相同的反馈向量数组。使用反馈向量的延迟分配，我们不能使用反馈向量来形成这棵树，因为不能保证外部函数在内部函数这样做时已经分配了它的反馈向量。为了解决这个问题，我们创建了一个新的 `ClosureFeedbackCellArray` 来维护这棵树，然后在函数变热时用完整的 `FeedbackVector` 替换它的 `ClosureFeedbackCellArray`。

![延迟反馈分配前后的反馈向量（Feedback vector）树。](/_img/v8-lite/lazy-feedback.svg)

我们的实验室实验和现场测试显示桌面上的延迟反馈没有性能回归，而在移动平台上，由于垃圾收集的减少，我们实际上看到了低端设备的性能改进。因此，我们在 V8 的所有版本中都启用了延迟反馈分配（lazy feedback allocation），包括 *Lite 模式*，在这种模式下，与我们最初的无反馈分配方法相比，内存中的轻微回归可以通过实际性能的改进得到更多的补偿。

## 延迟源位置 { #lazy-source-positions }

从 JavaScript 编译字节码时，会生成源位置表（source position tables），将字节码序列与 JavaScript 源代码中的字符位置联系起来。但是，仅在符号化异常或执行开发人员任务（例如调试）时才需要此信息，因此很少使用。

为了避免这种浪费，我们现在编译字节码而不收集源位置（假设没有附加调试器或分析器）。源位置仅在实际生成堆栈跟踪时收集，例如在调用 `Error.stack` 或将异常的堆栈跟踪打印到控制台时。这确实有一些成本，因为生成源位置需要重新解析和编译该函数，但是大多数网站在生产中不符号化堆栈跟踪，因此看不到任何可观察到的性能影响。

我们在这项工作中必须解决的一个问题是需要可重复的字节码生成，这在以前是无法保证的。如果与原始代码相比，V8 在收集源位置时生成不同的字节码，则源位置不会对齐，堆栈跟踪可能指向源代码中的错误位置。

在某些情况下，V8 可能会根据函数是[立即地（eagerly）还是延迟编译](/blog/preparser#skipping-inner-functions)而生成不同的字节码，因为在函数的初始立即解析（initial eager parse）和后来的延迟编译之间丢失了一些解析器信息。这些不匹配大多是良性的，例如忘记了变量不可变的事实，因此无法对其进行优化。然而，这项工作发现的一些不匹配确实有可能在某些情况下导致错误的代码执行。因此，我们修复了这些不匹配并添加了检查和 stress  模式，以确保函数的立即解析（eager）和延迟编译始终产生一致的输出，让我们对 V8 解析器和预解析器的正确性和一致性更有信心。

## 字节码刷新 { #bytecode-flushing }

从 JavaScript 源代码编译的字节码（Bytecode）占用了大量 V8 堆空间，通常约为 15%，包括相关的元数据（metadata）。有很多函数只在初始化时执行，或者编译后很少使用。

因此，我们添加了对在垃圾回收期间从函数中刷新（flushing）已编译字节码（如果它们最近没有被执行）的支持。为了做到这一点，我们跟踪函数字节码的 *年代（age）*，在每次[主要（标记-压缩）](/blog/trash-talk#major-gc)垃圾回收时递增年代，并在执行函数时将其重置为零。任何超过老化（aging ）阈值的字节码都有资格被下一次垃圾回收回收。如果它被回收然后再次执行，它会被重新编译。

确保字节码仅在不再需要时才刷新存在技术挑战。例如，如果函数 `A` 调用另一个长时间运行的函数 `B`，则函数 `A` 可能会在它仍在堆栈上时老化。即使函数 `A` 达到其老化阈值，我们也不希望刷新它的字节码，因为我们需要在长时间运行的函数 `B` 返回时返回它。因此，当字节码从函数中达到其老化阈值时，我们将字节码视为弱保留（weakly held），但由堆栈或其它地方对其的任何引用视为强保留（strongly held）。我们只在没有强链接（strong links）时刷新代码。

除了刷新字节码，我们还刷新与这些刷新的函数相关的反馈向量。然而，我们不能在与字节码相同的 GC 周期中刷新反馈向量，因为它们不由同一个对象保留 - 字节码由独立于本地上下文的 `SharedFunctionInfo` 保存，而反馈向量由与本地上下文（native-context）相关的 `JSFunction` 保留。 因此，我们在随后的 GC 周期中刷新反馈向量。

![两个 GC 周期后老化函数（aged function）的对象布局。](/_img/v8-lite/bytecode-flushing.svg)

## 额外的优化 { #additional-optimizations }

除了这些较大的项目之外，我们还发现并解决了一些效率低下的问题。

第一个是减少 `FunctionTemplateInfo` 对象的大小。这些对象存储有关 [`FunctionTemplate`s](/docs/embed#templates) 的内部元数据，这些元数据用于启用嵌入器（例如 Chrome）以提供可由 JavaScript 代码调用的函数的 C++ 回调实现。Chrome 引入了很多 FunctionTemplates 来实现 DOM Web API，因此 `FunctionTemplateInfo` 对象影响了 V8 的堆大小。在分析了 FunctionTemplates 的典型用法后，我们发现在 `FunctionTemplateInfo` 对象上的 11 个字段中，通常只有三个字段设置为非默认值。因此，我们拆分 `FunctionTemplateInfo` 对象，以便将稀有字段（rare fields）存储在侧表中，该侧表仅在需要时按需分配。

第二个优化与我们如何从 TurboFan 优化代码中去优化有关。由于 TurboFan 执行推测性优化，如果某些条件不再成立，它可能需要回退到解释器（去优化）。每个 deopt 点都有一个 id，它使运行时能够确定它应该将执行返回到解释器中的字节码中的哪个位置。以前，这个 id 是通过让优化后的代码跳转到一个大跳转表中的特定偏移量来计算的，该表将正确的 id 加载到寄存器中，然后跳转到运行时执行去优化。这具有在优化代码中为每个 deopt 点仅需要单个跳转指令的优点。然而，去优化跳转表是预先分配的，并且必须足够大以支持整个去优化 id 范围。我们改为修改 TurboFan，以便优化代码中的 deopt 点在调用运行时之前直接加载 deopt id。这使我们能够以优化代码大小略有增加为代价，完全删除这个大型跳转表。

## 结果 { #results }

我们已经在 V8 的最后七个版本中发布了上述优化。通常，它们首先进入 *Lite 模式*，然后被带到 V8 的默认配置。

![Android 设备上一组典型网页的平均 V8 堆大小。](/_img/v8-lite/savings-by-release.svg)

![V8 v7.8 (Chrome 78) 与 v7.1 (Chrome 71) 内存节省的每页细分。](/_img/v8-lite/breakdown-by-page.svg)

在这段时间里，我们在一系列典型网站上平均减少了 18% 的 V8 堆大小，这对应于低端 AndroidGo 移动设备平均减少 1.5 MB。无论是在基准测试中还是在现实世界的网页交互中进行测量，这都不会对 JavaScript 性能产生任何重大影响。

*Lite 模式* 可以通过禁用函数优化以一定的 JavaScript 执行吞吐量为代价提供进一步的内存节省。平均而言，*Lite 模式* 可节省 22% 的内存，某些页面最多可减少 32%。这对应于 AndroidGo 设备上 V8 堆大小减少 1.8 MB。

![与 v7.1 (Chrome 71) 相比，V8 v7.8 (Chrome 78) 的内存节省明细。](/_img/v8-lite/breakdown-by-optimization.svg)

当按每个单独优化的影响划分时，很明显不同的页面从这些优化中的每一个中获得不同比例的收益。展望未来，我们将继续确定潜在的优化，这些优化可以进一步减少 V8 的内存使用，同时在 JavaScript 执行时仍然保持极快的速度。
