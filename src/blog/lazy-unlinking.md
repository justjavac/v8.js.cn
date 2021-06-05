---
title: '关于懒惰（laziness）机制的实习经历：去优化函数的延迟取消链接'
author: 'Juliana Franco ([@jupvfranco](https://twitter.com/jupvfranco)), Laziness Expert'
date: 2017-10-04 13:33:37
tags:
  - memory
  - internals
description: '该技术深入介绍了 V8 如何取消链接去优化的函数，以及我们最近如何更改它以提高性能。'
tweet: '915473224187760640'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
大约三个月前，我作为实习生加入了 V8 团队（谷歌慕尼黑），从那时起我一直在研究 VM 的 _去优化（Deoptimizer）_ ——对我来说这是一个全新的东西，它被证明是一个有趣且具有挑战性的项目。我实习的第一部分侧重于[提高 VM 安全性](https://docs.google.com/document/d/1ELgd71B6iBaU6UmZ_lvwxf_OrYYnv0e4nuzZpK05-pg/edit)。第二部分侧重于性能改进。即，删除用于取消链接先前去优化的函数（deoptimized functions）的数据结构，这是垃圾回收期间的性能瓶颈。这篇博文描述了我实习经历的第二部分。我将解释 V8 过去如何取消链接去优化的函数，我们如何改变它，以及获得了哪些性能改进。

让我们（非常）简要回顾一下 JavaScript 函数的 V8 管道（pipeline ）：V8 的解释器 Ignition 在解释该函数时收集有关该函数的分析信息。一旦函数变热（hot，译注：即被频繁调用），这个信息就会传递给 V8 的编译器 TurboFan，它生成优化的机器代码。当分析信息不再有效时——例如因为其中一个被分析的对象在运行时获得了不同的类型——优化的机器代码可能会变得无效。在这种情况下，V8 需要对其进行去优化（deoptimize ）。

![V8 概述，如 [JavaScript 启动性能](https://medium.com/reloading/javascript-start-up-performance-69200f43b201)中所见](/_img/lazy-unlinking/v8-overview.png)

优化后，TurboFan 会为优化中的函数生成代码对象，即优化后的机器码。下次调用此函数时，V8 会依据对该函数优化代码的链接并执行它。在对这个函数进行去优化后，我们需要取消链接的代码对象，以确保它不会再次被执行。怎么会这样？

例如，在下面的代码中，函数 `f1` 将被多次调用（始终传递一个整数作为参数）。TurboFan 然后为该特定情况生成机器代码。

```js
function g() {
  return (i) => i;
}

// Create a closure.
const f1 = g();
// Optimize f1.
for (var i = 0; i < 1000; i++) f1(0);
```

每个函数还有一个指向解释器的 trampoline ——更多细节在这些[幻灯片](https://docs.google.com/presentation/d/1Z6oCocRASCfTqGq1GCo1jbULDGS-w-nzxkbVF7Up0u0/edit#slide=id.p)中——并将在其 `SharedFunctionInfo` (SFI) 中保留一个指向这个 trampoline 的指针。每当 V8 需要返回未优化的代码时，就会使用此 trampoline。因此，在去优化时，例如通过传递不同类型的参数触发，去优化器可以简单地将 JavaScript 函数的代码字段设置为这个 trampoline。

![V8 概述，如 [JavaScript 启动性能](https://medium.com/reloading/javascript-start-up-performance-69200f43b201)中所见](/_img/lazy-unlinking/v8-overview.png)

虽然这看起来很简单，但它迫使 V8 保留优化的 JavaScript 函数的弱列表。这是因为可能有不同的函数指向相同的优化代码对象。我们可以如下扩展我们的示例，函数 `f1` 和 `f2` 都指向相同的优化代码。

```js
const f2 = g();
f2(0);
```

如果函数 `f1` 被取消优化（例如通过使用不同类型的对象 `{x: 0}` 调用它），我们需要确保不会通过调用 `f2` 再次执行无效代码。

因此，在去优化时，V8 会迭代所有优化过的 JavaScript 函数，并且会取消那些指向被去优化的代码对象的链接。具有许多优化 JavaScript 函数的应用程序中的这种迭代成为性能瓶颈。此外，除了减慢去优化速度之外，V8 过去常常在垃圾回收的 stop-the-world 周期中迭代这些列表，这使得情况变得更糟。

为了了解这种数据结构对 V8 性能的影响，我们编写了一个[微基准测试](https://github.com/v8/v8/blob/master/test/js-perf-test/ManyClosures/create-many-closures.js)，通过在创建许多 JavaScript 函数后触发许多清理周期来加强其使用频率。

```js
function g() {
  return (i) => i + 1;
}

// Create an initial closure and optimize.
var f = g();

f(0);
f(0);
%OptimizeFunctionOnNextCall(f);
f(0);

// Create 2M closures; those will get the previously optimized code.
var a = [];
for (var i = 0; i < 2000000; i++) {
  var h = g();
  h();
  a.push(h);
}

// Now cause scavenges; all of them are slow.
for (var i = 0; i < 1000; i++) {
  new Array(50000);
}
```

运行此基准测试时，我们可以观察到 V8 将大约 98% 的执行时间用于垃圾回收。然后我们删除了这个数据结构，而是使用了一种 _延迟取消链接（lazy unlinking）_ 的方法，这就是我们在 x64 上观察到的：

![](/_img/lazy-unlinking/microbenchmark-results.png)

虽然这只是一个创建许多 JavaScript 函数并触发许多垃圾回收周期的微基准测试，但它让我们对这种数据结构引入的开销有所了解。我们看到一些开销并推动这项工作的其它更现实的应用程序是在 Node.js 中实现的[路由器基准测试](https://github.com/delvedor/router-benchmark)和 [ARES-6 基准测试套件](http://browserbench.org/ARES-6/)。

## 延迟取消链接 { #lazy-unlinking }

V8 不会在去优化时从 JavaScript 函数中取消优化代码的链接，而是将其推迟到下次调用此类函数时使用。当这些函数被调用时，V8 会检查它们是否已经被取消优化，取消它们的链接，然后继续它们的延迟编译（lazy compilation）。如果这些函数不再被调用，那么它们将永远不会被取消链接并且不会回收去优化的代码对象。然而，考虑到在去优化过程中，我们使代码对象的所有嵌入字段无效，我们只保持该代码对象处于活动状态。

删除此优化 JavaScript 函数列表的[提交](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690)需要在 VM 的几个部分进行更改，但基本思想如下。在汇编优化后的代码对象时，我们会检查这是否是 JavaScript 函数的代码。如果是这样，在它的 prologue 中，如果代码对象已被取消优化，我们将汇编机器代码以摆脱困境。在去优化时，我们不会修改去优化的代码——代码补丁消失了。因此，再次调用该函数时，仍然设置它的位标记 `marked_for_deoptimization`。 TurboFan 生成代码来检查它，如果设置了它，那么 V8 会跳转到一个新的内置函数 `CompileLazyDeoptimizedCode`，它将去优化的代码与 JavaScript 函数断开链接，然后继续进行延迟编译。

更详细地说，第一步是生成加载当前汇编代码地址的指令。我们可以在 x64 中做到这一点，代码如下：

```cpp
Label current;
// Load effective address of current instruction into rcx.
__ leaq(rcx, Operand(&current));
__ bind(&current);
```

之后，我们需要获取标记的 `marked_for_deoptimization` 位在代码对象中的位置。

```cpp
int pc = __ pc_offset();
int offset = Code::kKindSpecificFlags1Offset - (Code::kHeaderSize + pc);
```

然后我们可以测试这个位，如果它被设置，我们跳转到内置的 `CompileLazyDeoptimizedCode`。

```cpp
// Test if the bit is set, that is, if the code is marked for deoptimization.
__ testl(Operand(rcx, offset),
         Immediate(1 << Code::kMarkedForDeoptimizationBit));
// Jump to builtin if it is.
__ j(not_zero, /* handle to builtin code here */, RelocInfo::CODE_TARGET);
```

在这个 `CompileLazyDeoptimizedCode` 内置函数的一侧，剩下要做的就是从 JavaScript 函数中取消代码字段的链接，并将其设置为 trampoline 到解释器入口点（entry）。因此，考虑到 JavaScript 函数的地址在寄存器 `rdi` 中，我们可以通过以下方式获取指向 `SharedFunctionInfo` 的指针：

```cpp
// Field read to obtain the SharedFunctionInfo.
__ movq(rcx, FieldOperand(rdi, JSFunction::kSharedFunctionInfoOffset));
```

……还有类似的 trampoline：

```cpp
// Field read to obtain the code object.
__ movq(rcx, FieldOperand(rcx, SharedFunctionInfo::kCodeOffset));
```

然后我们可以用它来更新代码指针的函数槽（slot）：

```cpp
// Update the code field of the function with the trampoline.
__ movq(FieldOperand(rdi, JSFunction::kCodeOffset), rcx);
// Write barrier to protect the field.
__ RecordWriteField(rdi, JSFunction::kCodeOffset, rcx, r15,
                    kDontSaveFPRegs, OMIT_REMEMBERED_SET, OMIT_SMI_CHECK);
```

这会产生与之前相同的结果。然而，不仅在去优化器中处理取消链接，我们还需要在代码生成期间担心它。因此，手写汇编程序。

以上是它[在 x64 架构中的工作方式](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-0920a0f56f95b36cdd43120466ec7ccd)。我们也为 [ia32](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-10985b50f31627688e9399a768d9ec21)、[arm](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-0f5515e80dd0139244a4ae48ce56a139)、[arm64](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-1bbe32f45000ec9157f4997a6c95f1b1)、[mips](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-73f690ee13a5465909ae9fc1a70d8c41) 和 [mips64](https://github.com/v8/v8/commit/f0acede9bb05155c25ee87e81b4b587e8a76f690#diff-b1de25cbfd2d02b81962797bfdf807df) 实现了它。

这种新技术已经集成在 V8 中，正如我们稍后将讨论的那样，它可以提高性能。但是，它有一个小缺点：以前，V8 只会在去优化时才考虑取消链接。现在，它必须在激活所有优化函数时这样做。此外，考虑到我们需要做一些工作来获取代码对象的地址，检查 `marked_for_deoptimization` 位的方法并不像它应有的那样有效。请注意，在输入每个优化函数时会发生这种情况。此问题的一个可能解决方案是在代码对象中保留一个指向自身的指针。V8 不会在函数被调用时查找代码对象的地址，而是只在构造之后执行一次。

## 结果 { #results }

我们现在看看通过这个项目获得的性能提升（performance gains）和倒退（regressions）。

### x64 的一般改进 { #general-improvements-on-x64 }

下图向我们展示了相对于先前提交的一些改进和回归。请注意，越高越好。

![](/_img/lazy-unlinking/x64.png)

`promises` 基准是我们看到更大改进的基准，观察到 `bluebird-parallel`  基准提高了近 33%，`wikipedia` 提高了 22.40%。我们还在一些基准测试中观察到了一些性能倒退（regressions ）。这与上面解释的问题有关，检查代码是否被标记为去优化。

我们还看到了 ARES-6 基准测试套件的改进。请注意，在此图表中，越高越好。这些程序过去常常在与 GC 相关的活动中花费大量时间。 通过延迟取消链接（lazy unlinking），我们将整体性能提高了 1.9%。最显着的例子是 `Air steadyState`，我们得到了大约 5.36% 的改进。

![](/_img/lazy-unlinking/ares6.png)

### AreWeFastYet  结果 { #arewefastyet-results }

Octane 和 ARES-6 基准测试套件的性能结果也显示在 AreWeFastYet 跟踪器上。我们在 2017 年 9 月 5 日使用提供的默认机器（macOS 10.10 64 位、Mac Pro、shell）查看了这些性能结果。

![在 AreWeFastYet 上看到的 Octane 上的跨浏览器结果](/_img/lazy-unlinking/awfy-octane.png)

![在 AreWeFastYet 上看到的 ARES-6 上的跨浏览器结果](/_img/lazy-unlinking/awfy-ares6.png)

### 对 Node.js 的影响 { #impact-on-node.js }

我们还可以在 `router-benchmark` 中看到性能改进。以下两个图显示了每个测试路由器每秒的操作数。因此越高越好。 我们已经用这个基准套件进行了两种实验。首先，我们单独运行每个测试，以便我们可以独立于其余测试看到性能改进。其次，我们一次运行所有测试，无需切换 VM，从而模拟每个测试与其它功能集成的环境。

对于第一个实验，我们看到 `router` 和 `express` 测试在相同的时间内执行了大约两倍于以前的操作。对于第二个实验，我们看到了更大的改进。在某些情况下，例如 `routr`、`server-router` 和 `router`，基准测试分别执行大约 3.80 倍、3 倍和 2 倍以上的操作。出现这种情况是因为 V8 积累了更多优化的 JavaScript 函数，一个又一个的测试。因此，每当执行给定的测试时，如果触发了垃圾回收周期，V8 必须访问当前测试和之前测试中的优化函数。

![](/_img/lazy-unlinking/router.png)

![](/_img/lazy-unlinking/router-integrated.png)

### 进一步优化 { #further-optimization }

现在 V8 没有在上下文中保留 JavaScript 函数的链表，我们可以从 JSFunction 类中删除 `next` 字段。虽然这是一个简单的修改，但它允许我们为每个函数节省一个指针的大小，这在几个网页中显示了显著的内存节省：

:::table-wrapper
| Benchmark    | Kind                              | Memory savings (absolute) | Memory savings (relative) |
| ------------ | --------------------------------- | ------------------------- | ------------------------- |
| facebook.com | Average effective size            | 170 KB                    | 3.70%                     |
| twitter.com  | Average size of allocated objects | 284 KB                    | 1.20%                     |
| cnn.com      | Average size of allocated objects | 788 KB                    | 1.53%                     |
| youtube.com  | Average size of allocated objects | 129 KB                    | 0.79%                     |
:::

## 致谢 { #acknowledgments }

在整个实习期间，我得到了很多人的帮助，他们总是可以回答我的许多问题。因此，我要感谢以下人员：Benedikt Meurer、Jaroslav Sevcik 和 Michael Starzinger 就编译器和去优化器的工作原理进行了讨论，Ulan Degenbaev 在我克服垃圾回收器问题时提供了帮助，还有 Mathias Bynens、Peter Marshall， Camillo Bruni 和 Maya Armyanova 校对本文。

最后，这篇文章是我作为 Google 实习生的最后一次贡献，我想借此机会感谢 V8 团队中的每个人，特别是我的导师 Benedikt Meurer，感谢他接待我并给我机会在这样一个项目上工作。有趣的项目——我确实学到了很多东西，并且很享受在 Google 的时光！
