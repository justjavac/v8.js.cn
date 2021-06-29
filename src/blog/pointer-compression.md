---
title: 'V8 中的指针压缩'
author: 'Igor Sheludko and Santiago Aboy Solanes, *the* pointer compressors'
avatars:
  - 'igor-sheludko'
  - 'santiago-aboy-solanes'
date: 2020-03-30
tags:
  - internals
  - memory
description: 'V8 将其堆大小减少了 43%！学习如何在“V8 中进行指针压缩”！'
tweet: '1244653541379182596'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
内存和性能之间一直在战斗。作为用户，我们希望速度快，同时消耗尽可能少的内存。不幸的是，提高性能通常是以消耗内存为代价的（反之亦然）。

早在 2014 年，Chrome 从 32 位进程切换到 64 位进程。这为 Chrome 提供了更好的[安全性、稳定性和性能](https://blog.chromium.org/2014/08/64-bits-of-awesome-64-bit-windows_26.html)，但它带来了内存成本，因为每个指针现在占用 8 个字节而不是 4 个字节。我们接受了在 V8 中减少这种开销的挑战，以尝试尽可能多地回收浪费的 4 个字节。

在深入实施之前，我们需要知道我们所处的位置以正确评估情况。为了衡量我们的内存和性能，我们使用一组反映流行的现实世界网站的[网页](https://v8.dev/blog/optimizing-v8-memory)。数据显示，V8 贡献了桌面上 Chrome [渲染器进程](https://www.chromium.org/developers/design-documents/multi-process-architecture)内存消耗的 60%，平均为 40%。

![Chrome 渲染器内存中的 V8 内存消耗百分比](/_img/pointer-compression/memory-chrome.svg)

指针压缩（Pointer Compression）是 V8 中为减少内存消耗而进行的多项努力之一。这个想法很简单：我们可以存储来自某个“基（base）”地址的 32 位偏移量，而不是存储 64 位指针。有了这样一个简单的想法，我们可以从 V8 中的这种压缩中获得多少收益？

V8 堆包含大量项目，例如浮点值、字符串字符、解释器字节码和标记值（tagged values，有关详细信息，请参阅下一节）。在检查堆后，我们发现在现实世界的网站上，这些标记值占据了 V8 堆的 70% 左右！

让我们仔细看看什么是标记值（tagged values）。

## V8 中的值标记 { #value-tagging-in-v8 }

V8 中的 JavaScript 值表示为对象并分配在 V8 堆上，无论它们是对象、数组、数字还是字符串。这允许我们将任何值表示为指向对象的指针。

许多 JavaScript 程序对整数值执行计算，例如在循环中递增索引。为了避免每次整数递增时我们必须分配一个新的数字对象，V8 使用众所周知的[指针标记（pointer tagging）](https://en.wikipedia.org/wiki/Tagged_pointer)技术在 V8 堆指针中存储额外的或替代的数据。

标签位（ tag bits）有双重用途：它们要么是指向位于 V8 堆中的对象的强/弱指针，要么是一个小整数。因此，整数的值可以直接存储在标记值（tagged value）中，而不必为其分配额外的存储空间。

V8 总是以字对齐（word-aligned）的地址分配堆中的对象，这允许它使用 2（或 3，取决于机器字大小）最低有效位进行标记。在 32 位架构上，V8 使用最低有效位来区分 Smis 和堆对象指针。对于堆指针，它使用第二个最低有效位来区分强引用和弱引用：

<pre>
                        |----- 32 bits -----|
Pointer:                |_____address_____<b>w1</b>|
Smi:                    |___int31_value____<b>0</b>|
</pre>
其中 *w* 是一位（bit）用于区分强指针和弱指针。

请注意，Smi 值只能携带 31 位有效载荷，包括符号位。在指针的情况下，我们有 30 位可用作堆对象地址有效负载。由于字对齐，分配粒度为 4 个字节，这为我们提供了 4 GB 的可寻址空间。

在 64 位架构上，V8 值如下所示：

<pre>
            |----- 32 bits -----|----- 32 bits -----|
Pointer:    |________________address______________<b>w1</b>|
Smi:        |____int32_value____|000000000000000000<b>0</b>|
</pre>
你可能会注意到，与 32 位架构不同，在 64 位架构上，V8 可以将 32 位用于 Smi 值负载。以下部分将讨论 32 位 Smis 对指针压缩的影响。

## 压缩标记值和新堆布局 { #compressed-tagged-values-and-new-heap-layout }

使用指针压缩，我们的目标是在 64 位架构上以某种方式将两种标记值放入 32 位。我们可以通过以下方式将指针放入 32 位：

- 确保所有 V8 对象都在 4-GB 内存范围内分配
- 将指针表示为该范围内的偏移量

有这样的硬限制是不幸的，但 Chrome 中的 V8 已经对 V8 堆的大小有 2-GB 或 4-GB 的限制（取决于底层设备的强大程度），即使在 64 位架构上也是如此。其它 V8 嵌入器，例如 Node.js，可能需要更大的堆。如果我们强加最大 4 GB，则意味着这些嵌入器不能使用指针压缩。

现在的问题是如何更新堆布局以确保 32 位指针唯一标识 V8 对象。

### 简单的堆布局 { #trivial-heap-layout }

简单的压缩方案是在地址空间的前 4 GB 中分配对象。

![简单的堆布局（Trivial heap layout）](/_img/pointer-compression/heap-layout-0.svg)

不幸的是，这不是 V8 的选项，因为 Chrome 的渲染器进程可能需要在同一个渲染器进程中创建多个 V8 实例，例如对于 Web/Service Workers。否则，使用此方案，所有这些 V8 实例都会竞争相同的 4-GB 地址空间，因此所有 V8 实例都受到 4-GB 的内存限制。

### 堆布局，v1 { #heap-layout%2C-v1 }

如果我们将 V8 的堆安排在一个连续的 4 GB 地址空间区域中，那么距基址的 32 位 **无符号** 偏移量将唯一标识该指针。

<figure>
  <img src="/_img/pointer-compression/heap-layout-1.svg" width="827" height="323" alt="" loading="lazy">
  <figcaption>堆布局，基址对齐到开头</figcaption>
</figure>

如果我们还确保基数是 4 GB 对齐的，那么所有指针的高 32 位都是相同的：

```
            |----- 32 bits -----|----- 32 bits -----|
Pointer:    |________base_______|______offset_____w1|
```

我们还可以通过将 Smi 有效载荷限制为 31 位并将其置于较低 32 位来使 Smi 可压缩。基本上，使它们类似于 32 位架构上的 Smis。

```
         |----- 32 bits -----|----- 32 bits -----|
Smi:     |sssssssssssssssssss|____int31_value___0|
```

其中 *s* 是 Smi 有效载荷的符号值。如果我们有一个符号扩展的表示，我们就能够通过 64 位字的一位算术移位来压缩和解压缩 Smis。

现在，我们可以看到指针和 Smis 的上半字完全由下半字定义。然后，我们可以只将后者存储在内存中，将存储标记值所需的内存减少一半：

```
                    |----- 32 bits -----|----- 32 bits -----|
Compressed pointer:                     |______offset_____w1|
Compressed Smi:                         |____int31_value___0|
```

鉴于基址是 4 GB 对齐的，压缩只是一个截断：

```cpp
uint64_t uncompressed_tagged;
uint32_t compressed_tagged = uint32_t(uncompressed_tagged);
```

然而，解压代码稍微复杂一些。我们需要区分符号扩展 Smi 和零扩展指针，以及是否在基址中添加。

```cpp
uint32_t compressed_tagged;

uint64_t uncompressed_tagged;
if (compressed_tagged & 1) {
  // pointer case
  uncompressed_tagged = base + uint64_t(compressed_tagged);
} else {
  // Smi case
  uncompressed_tagged = int64_t(compressed_tagged);
}
```

让我们尝试更改压缩方案以简化解压缩代码。

### 堆布局，v2 { #heap-layout%2C-v2 }

如果不是将基址放在 4 GB 的开头，而是将基址放在中间，我们可以将压缩值视为距基址的 **有符号** 32 位偏移量。请注意，整个预留不再是 4 GB 对齐的，而是基址对齐的。

![堆布局，基址居中](/_img/pointer-compression/heap-layout-2.svg)

在这个新布局中，压缩代码保持不变。

然而，解压代码变得更好。符号扩展现在对于 Smi 和指针情况都很常见，唯一的分支是是否在指针情况下添加基址。

```cpp
int32_t compressed_tagged;

// Common code for both pointer and Smi cases
int64_t uncompressed_tagged = int64_t(compressed_tagged);
if (uncompressed_tagged & 1) {
  // pointer case
  uncompressed_tagged += base;
}
```

代码中分支的性能取决于 CPU 中的分支预测单元（branch prediction unit）。我们认为如果我们以无分支的方式实现解压，我们可以获得更好的性能。使用少量的魔法，我们可以编写上述代码的无分支版本：

```cpp
int32_t compressed_tagged;

// Same code for both pointer and Smi cases
int64_t sign_extended_tagged = int64_t(compressed_tagged);
int64_t selector_mask = -(sign_extended_tagged & 1);
// Mask is 0 in case of Smi or all 1s in case of pointer
int64_t uncompressed_tagged =
    sign_extended_tagged + (base & selector_mask);
```

然后，我们决定从无分支实现开始。

## 性能演变 { #performance-evolution }

### 初始性能  { #initial-performance }

我们在 [Octane](https://v8.dev/blog/retiring-octane#the-genesis-of-octane) 上测量了性能——我们过去使用过的峰值性能基准。尽管我们不再专注于提高日常工作中的峰值性能，但我们也不想回归峰值性能，尤其是对于像所有指针这样对性能敏感的东西。Octane 仍然是这项任务的一个很好的基准。

此图显示了 Octane 在我们优化和完善指针压缩实现时在 x64 架构上的得分。在图中，越高越好。红线是现有的全尺寸指针 x64 版本，而绿线是指针压缩版本。

![Octane 的第一轮改进](/_img/pointer-compression/perf-octane-1.svg)

在第一个工作实现中，我们有大约 35% 的回归差距。

#### Bump (1), +7%

首先，我们通过比较无分支解压缩和有分支的解压缩来验证我们的“无分支更快”假设。结果证明我们的假设是错误的，分支版本在 x64 上快了 7%。那是相当显著的差异！

我们来看看 x64 汇编指令集。

:::table-wrapper
<!-- markdownlint-disable no-space-in-code -->
| Decompression | Branchless              | Branchful                    |
|---------------|-------------------------|------------------------------|
| Code          | ```asm                  | ```asm                       \
|               | movsxlq r11,[…]         | movsxlq r11,[…]              \
|               | movl r10,r11            | testb r11,0x1                \
|               | andl r10,0x1            | jz done                      \
|               | negq r10                | addq r11,r13                 \
|               | andq r10,r13            | done:                        \
|               | addq r11,r10            |                              | \
|               | ```                     | ```                          |
| Summary       | 20 bytes                | 13 bytes                     |
| ^^            | 6 instructions executed | 3 or 4 instructions executed |
| ^^            | no branches             | 1 branch                     |
| ^^            | 1 additional register   |                              |
<!-- markdownlint-enable no-space-in-code -->
:::

这里的 **r13** 是用于基址值的专用寄存器。请注意无分支代码如何更大，并且需要更多寄存器。

在 Arm64 上，我们观察到同样的情况——分支版本在强大的 CPU 上明显更快（尽管两种情况的代码大小相同）。

:::table-wrapper
<!-- markdownlint-disable no-space-in-code -->
| Decompression | Branchless              | Branchful                    |
|---------------|-------------------------|------------------------------|
| Code          | ```asm                  | ```asm                       \
|               | ldur w6, […]            | ldur w6, […]                 \
|               | sbfx x16, x6, #0, #1    | sxtw x6, w6                  \
|               | and x16, x16, x26       | tbz w6, #0, #done            \
|               | add x6, x16, w6, sxtw   | add x6, x26, x6              \
|               |                         | done:                        \
|               | ```                     | ```                          |
| Summary       | 16 bytes                | 16 bytes                     |
| ^^            | 4 instructions executed | 3 or 4 instructions executed |
| ^^            | no branches             | 1 branch                     |
| ^^            | 1 additional register   |                              |
<!-- markdownlint-enable no-space-in-code -->
:::

在低端 Arm64 设备上，我们观察到几乎没有任何方向的性能差异。

我们的结论是：现代 CPU 中的分支预测器非常好，代码大小（尤其是执行路径长度）对性能的影响更大。

#### Bump (2), +2%

[TurboFan](https://v8.dev/docs/turbofan) 是 V8 的优化编译器，围绕着一个名为 “Sea of Nodes” 的概念构建。简而言之，每个操作都表示为图中的一个节点（请参阅[此博客文章中](https://v8.dev/blog/turbofan-jit)的更详细版本）。这些节点具有各种依赖关系，包括数据流和控制流。

有两个操作对指针压缩至关重要：加载和存储，因为它们将 V8 堆与管道的其余部分连接起来。如果我们每次从堆加载压缩值时都进行解压缩，并在存储之前对其进行压缩，那么管道可以像在全指针模式下一样继续工作。因此，我们在节点图中添加了新的显式值操作 - 解压缩和压缩。

有些情况下实际上不需要j解压。例如，如果从某处加载压缩值只是为了将其存储到新位置。

为了优化不必要的操作，我们在 TurboFan 中实施了一个新的“减压消除（Decompression Elimination）”阶段。它的工作是在压缩之后直接消除解压。由于这些节点可能不会直接相邻，因此它还会尝试通过图传播解压缩，以期遇到压缩并消除它们。这使我们的 Octane 分数提高了 2%。

#### Bump (3), +2%

当我们查看生成的代码时，我们注意到对刚刚加载的值进行解压缩会产生一些过于冗长的代码：

```asm
movl rax, <mem>   // load
movlsxlq rax, rax // sign extend
```

一旦我们修复了对直接从内存加载的值进行签名扩展：

```asm
movlsxlq rax, <mem>
```

所以又得到了 2% 的改进。

#### Bump (4), +11%

TurboFan 优化阶段通过在图上使用模式匹配来工作：一旦子图匹配某个模式，它就会被语义上等效（但更好）的子图或指令替换。

寻找匹配项的失败尝试并不是显式失败。图中显式解/压缩操作的存在导致先前成功的模式匹配尝试不再成功，从而导致优化无声无息地失败。

“破坏”优化的一个例子是 [allocation preternuring](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43823.pdf)。一旦我们更新了模式匹配以了解新的压缩/解压缩节点，我们又获得了 11% 的改进。

### 进一步改进 { #further-improvements }

![Octane 的第二轮改进](/_img/pointer-compression/perf-octane-2.svg)

#### Bump (5), +0.5%

在 TurboFan 中实现解压消除（Decompression Elimination）时，我们学到了很多。显式解/压缩节点方法具有以下属性：

优点：

- 此类操作的明确性使我们能够通过对子图进行规范模式匹配来优化不必要的解压缩。

但是，随着我们继续实施，我们发现了缺点：

- 由于新的内部值表示，可能的转换操作的组合爆炸变得难以管理。除了现有的表示集（标记 Smi、标记指针、标记 any、word8、word16、word32、 word64、float32、float64、simd128），我们现在可以压缩指针、压缩 Smi 和压缩 any（是指针或 Smi 的压缩值）。
- 一些现有的基于图模式匹配的优化没有启动，这导致了这里和那里的回归。尽管我们发现并修复了其中的一些问题，但 TurboFan 的复杂性仍在不断增加。
- 寄存器分配器对图中的节点数量越来越不满意，并且经常生成糟糕的代码。
- 较大的节点图减慢了 TurboFan 优化阶段，并增加了编译期间的内存消耗。

我们决定退后一步，想出一种更简单的方法来支持 TurboFan 中的指针压缩。新方法是删除 Compressed Pointer / Smi / Any 表示，并使所有显式 Compressed / Decompression 节点隐含在 Stores 和 Loads 中，假设我们总是在加载之前解压缩并在存储之前压缩。

我们还在 TurboFan 中添加了一个新阶段，以取代“解压消除”阶段。这个新阶段将识别何时我们实际上不需要压缩或解压缩并相应地更新 Loads  和 Stores。这种方法显著降低了 TurboFan 中指针压缩支持的复杂性，并提高了生成代码的质量。

新的实现与初始版本一样有效，并提供了 0.5% 的改进。

#### Bump (6), +2.5%

我们已经接近性能均值，但差距仍然存在。我们不得不提出更新鲜的想法。其中之一是：如果我们确保任何处理 Smi 值的代码永远不会“查看（looks）”高 32 位会怎样？

让我们记住解压实现：

```cpp
// Old decompression implementation
int64_t uncompressed_tagged = int64_t(compressed_tagged);
if (uncompressed_tagged & 1) {
  // pointer case
  uncompressed_tagged += base;
}
```

如果忽略 Smi 的高 32 位，我们可以假设它们是未定义的。然后，我们可以避免指针和 Smi 情况之间的特殊情况，并在解压缩时无条件地添加基址，即使对于 Smis！我们称这种方法为 “Smi-corrupting”。

```cpp
// New decompression implementation
int64_t uncompressed_tagged = base + int64_t(compressed_tagged);
```

此外，由于我们不再关心扩展 Smi 的符号，因此此更改允许我们返回堆布局 v1。这是基数指向 4GB 预留开头的那个。

<figure>
  <img src="/_img/pointer-compression/heap-layout-1.svg" width="827" height="323" alt="" loading="lazy">
  <figcaption>堆布局，基址对齐到开头</figcaption>
</figure>

就解压代码而言，它将符号扩展（sign-extension）操作更改为零扩展（zero-extension），这同样便宜。但是，这简化了运行时 (C++) 方面的事情。例如，地址空间区域预留代码（参见[一些实现细节](#some-implementation-details)部分）。

这是用于比较的汇编代码：

:::table-wrapper
<!-- markdownlint-disable no-space-in-code -->
| Decompression | Branchful                    | Smi-corrupting               |
|---------------|------------------------------|------------------------------|
| Code          | ```asm                       | ```asm                       \
|               | movsxlq r11,[…]              | movl r11,[rax+0x13]          \
|               | testb r11,0x1                | addq r11,r13                 \
|               | jz done                      |                              | \
|               | addq r11,r13                 |                              | \
|               | done:                        |                              | \
|               | ```                          | ```                          |
| Summary       | 13 bytes                     | 7 bytes                      |
| ^^            | 3 or 4 instructions executed | 2 instructions executed      |
| ^^            | 1 branch                     | no branches                  |
<!-- markdownlint-enable no-space-in-code -->
:::

因此，我们将 V8 中所有使用 Smi 的代码段调整为新的压缩方案，这又带给了我们 2.5% 的改进。

### 剩余缺口 { #remaining-gap }

剩余的性能差距可以通过针对 64 位构建的两项优化来解释，由于与指针压缩的根本不兼容，我们不得不禁用这些优化。

![Octane 的最后一轮改进](/_img/pointer-compression/perf-octane-3.svg)

#### 32-bit Smi optimization (7), -1%

让我们回想一下 Smis 在 64 位架构上的全指针模式下的样子。

```
        |----- 32 bits -----|----- 32 bits -----|
Smi:    |____int32_value____|0000000000000000000|
```

32 位 Smi 具有以下优点：

- 它可以表示更大范围的整数，而无需将它们装箱成数字对象；和
- 这种形状在读/写时提供对 32 位值的直接访问。

这种优化不能用指针压缩来完成，因为 32 位压缩指针中没有空间，因为有区分指针和 Smis 的位。如果我们在全指针 64 位版本中禁用 32 位 smis，我们会看到 Octane 分数下降 1%。

#### Double field unboxing (8), -3%

这种优化尝试在某些假设下将浮点值直接存储在对象的字段中。这样做的目的是减少数字对象分配的数量，甚至比 Smis 单独做的还要多。

想象一下以下 JavaScript 代码：

```js
function Point(x, y) {
  this.x = x;
  this.y = y;
}
const p = new Point(3.1, 5.3);
```

一般来说，如果我们看看对象 p 在内存中的样子，我们会看到这样的：

![内存中的对象 `p`](/_img/pointer-compression/heap-point-1.svg)

你可以在[本文](https://v8.dev/blog/fast-properties)中阅读有关隐藏类和属性以及元素后备存储的更多信息。

在 64 位体系结构上，双精度值与指针的大小相同。所以，如果我们假设 Point 的字段总是包含数字值，我们可以将它们直接存储在对象字段中。

![](/_img/pointer-compression/heap-point-2.svg)

如果某些字段的假设不成立，请在执行此行后说：

```js
const q = new Point(2, 'ab');
```

那么 y 属性的数值必须以装箱方式存储。此外，如果某处存在依赖于该假设的推测优化代码，则不得再使用它并且必须将其丢弃（去优化）。这种“字段类型”泛化的原因是为了最大限度地减少由同一构造函数创建的对象形状的数量，这反过来又是更稳定的性能所必需的。

![内存中的对象 `p` 和 `q`](/_img/pointer-compression/heap-point-3.svg)

如果应用，双字段拆箱有以下好处：

- 通过对象指针提供对浮点数据的直接访问，避免通过数字对象进行额外的解引用（dereference）；和
- 允许我们为执行大量双字段访问的紧密循环生成更小、更快的优化代码（例如在数字处理应用程序中）

启用指针压缩后，双精度值不再适合压缩字段。但是，将来我们可能会针对指针压缩调整此优化。

请注意，即使没有这种双字段拆箱优化（以与指针压缩兼容的方式），通过将数据存储在 Float64 TypedArrays 中，甚至使用 [Wasm](https://webassembly.github.io/spec/core/)，也可以以可优化的方式重写需要高吞吐量的数字处理代码。

#### 更多改进 (9), 1% { #more-improvements-(9)%2C-1%25 }

最后，对 TurboFan 中的解压消除优化进行了一些微调，性能又提高了 1%。

## 一些实现细节 { #some-implementation-details }

为了简化指针压缩与现有代码的集成，我们决定在每次加载时解压缩值并在每次存储时压缩它们。因此只改变标记值的存储格式，同时保持执行格式不变。

### Native 代码端 { #native-code-side }

为了能够在需要解压缩时生成高效代码，基址值必须始终可用。幸运的是，V8 已经有一个专用寄存器，始终指向一个“根表（roots table）”，其中包含对 JavaScript 和 V8 内部对象的引用，这些对象必须始终可用（例如，undefined、null、true、false 等等）。该寄存器称为“根寄存器”，用于生成较小且[可共享的内置代码](https://v8.dev/blog/embedded-builtins)。

So, we put the roots table into the V8 heap reservation area and thus the root register became usable for both purposes - as a root pointer and as a base value for decompression.

### C++ 端 { #c%2B%2B-side }

V8 运行时通过 C++ 类访问 V8 堆中的对象，为存储在堆中的数据提供方便的视图。请注意，V8 对象是类似于 [POD](https://en.wikipedia.org/wiki/Passive_data_structure) 的结构，而不是 C++ 对象。helper “视图（view）”类仅包含一个带有相应标记值的 uintptr_t 字段。由于视图类是字大小的，我们可以零开销地按值传递它们（非常感谢现代 C++ 编译器）。

下面是一个 helper 类的伪示例：

```cpp
// Hidden class
class Map {
 public:
  …
  inline DescriptorArray instance_descriptors() const;
  …
  // The actual tagged pointer value stored in the Map view object.
  const uintptr_t ptr_;
};

DescriptorArray Map::instance_descriptors() const {
  uintptr_t field_address =
      FieldAddress(ptr_, kInstanceDescriptorsOffset);

  uintptr_t da = *reinterpret_cast<uintptr_t*>(field_address);
  return DescriptorArray(da);
}
```

为了最大限度地减少指针压缩版本第一次运行所需的更改次数，我们将解压所需的基址值的计算集成到 getter 中。

```cpp
inline uintptr_t GetBaseForPointerCompression(uintptr_t address) {
  // Round address down to 4 GB
  const uintptr_t kBaseAlignment = 1 << 32;
  return address & -kBaseAlignment;
}

DescriptorArray Map::instance_descriptors() const {
  uintptr_t field_address =
      FieldAddress(ptr_, kInstanceDescriptorsOffset);

  uint32_t compressed_da = *reinterpret_cast<uint32_t*>(field_address);

  uintptr_t base = GetBaseForPointerCompression(ptr_);
  uintptr_t da = base + compressed_da;
  return DescriptorArray(da);
}
```

性能测量证实，在每个负载中计算基址会损害性能。原因是 C++ 编译器不知道 GetBaseForPointerCompression() 调用的结果对于 V8 堆中的任何地址都是相同的，因此编译器无法合并基址值的计算。鉴于代码由若干条指令和一个 64 位常量组成，这会导致明显的代码膨胀。

为了解决这个问题，我们重用了 V8 实例指针作为解压的基础（记住堆布局中的 V8 实例数据）。这个指针通常在运行时函数中可用，所以我们通过需要一个 V8 实例指针来简化 getter 代码，它恢复了回归：

```cpp
DescriptorArray Map::instance_descriptors(const Isolate* isolate) const {
  uintptr_t field_address =
      FieldAddress(ptr_, kInstanceDescriptorsOffset);

  uint32_t compressed_da = *reinterpret_cast<uint32_t*>(field_address);

  // No rounding is needed since the Isolate pointer is already the base.
  uintptr_t base = reinterpret_cast<uintptr_t>(isolate);
  uintptr_t da = DecompressTagged(base, compressed_value);
  return DescriptorArray(da);
}
```

## 结果 { #results }

让我们来看看指针压缩的最终数字！对于这些结果，我们使用了在本博文开头介绍的相同浏览测试。提醒一下，它们正在浏览我们发现代表真实世界网站使用情况的用户故事。

在其中，我们观察到指针压缩将 **V8 堆大小减少了 43%**！反过来，它在桌面上将 **Chrome 的渲染器进程内存减少了 20%**。

![在 Windows 10 中浏览时节省内存](/_img/pointer-compression/v8-heap-memory.svg)

另一个需要注意的重要事项是，并非每个网站的改进量都相同。例如，Facebook 上的 V8 堆内存曾经比纽约时报更大，但对于指针压缩，它实际上是相反的。这种差异可以通过以下事实来解释：某些网站比其它网站具有更多的标记值。

除了这些内存改进之外，我们还看到了实际性能的改进。在真实网站上，我们使用更少的 CPU 和垃圾回收器时间！

![CPU 和垃圾回收时间的改进](/_img/pointer-compression/performance-improvements.svg)

## 结论 { #conclusion }

到达这里的旅程并不美好，但值得我们花时间。[300+ 次提交](https://github.com/v8/v8/search?o=desc&q=repo%3Av8%2Fv8+%22%5Bptr-compr%5D%22&s=committer-date&type=Commits)之后，带有指针压缩的 V8 使用的内存与我们运行 32 位应用程序一样多，同时具有 64 位应用程序的性能。

我们一直期待改进，并在我们的管道中有以下相关任务：

- 提高生成的汇编代码的质量。我们知道在某些情况下我们可以生成更少的代码来提高性能。
- 解决相关的性能回归问题，包括一种允许以指针压缩友好的方式再次取消装箱双字段的机制。
- 探索支持 8 到 16 GB 范围内更大堆的想法。
