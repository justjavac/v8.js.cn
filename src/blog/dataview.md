---
title: '在 V8 中 提升 `DataView` 的性能'
author: 'Théotime Grohens, <i lang="fr">le savant de Data-Vue</i>, and Benedikt Meurer ([@bmeurer](https://twitter.com/bmeurer)), professional performance pal'
avatars:
  - 'benedikt-meurer'
date: 2018-09-18 11:20:37
tags:
  - ECMAScript
  - benchmarks
description: 'V8 v6.9 弥补了 DataView 和等效的 TypedArray 代码之间的性能差距，使 DataView 可用于性能敏感的应用程序。'
tweet: '1041981091727466496'
cn:
  author: '嘤嘤 ([@monkingxue](https://www.zhihu.com/people/turbe-xue))，不会写小程序'
  avatars:
    - monkingxue
---
[`DataView`s](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) 是在 JavaScript 中访问底层内存的两种方式之一，另一种方式是使用 [`TypedArray`s](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray)。 在这之前，V8 对 `DataView` 所做的优化远逊于 `TypedArray`，导致在图像处理密集型或解码/编码二进制数据等任务中，使用 `DataView` 的程序性能相对较差。造成这种现象主要是历史原因, 例如 [asm.js](http://asmjs.org/) 在底层实现中选择了 `TypedArray`s 而不是 `DataView`s, 因此 V8 更专注于优化 `TypedArray`s 的性能.

由于会导致性能下降，Google Maps 等团队中的 JavaScript 开发者决定避免使用 `DataView`s，转而使用 `TypedArray`s，但是这样做的会使代码复杂性增加。 在本篇文章中，我们将着重阐述 [V8 v6.9](/blog/v8-release-69) 如何优化 `DataView` 的性能，来让它拥有可以与 `TypedArray` 匹敌的性能，并能够被应用于真实的生产环境中。

## 背景 {#background}

ES2015 推出之后，JavaScript 开始支持在原始二进制缓冲区中读取和写入数据，这个缓冲区被称为 [`ArrayBuffer`s](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer) 。`ArrayBuffer`s 无法通过程序直接访问, 我们需要使用*数组缓冲区视图*对象来间接访问，而 `DataView` 和 `TypedArray` 就是两种数组缓冲区视图对象。

`TypedArray` 允许程序以统一的类型数组的形式访问缓冲区，例如 `Int16Array` 或 `Float32Array` 。

```js
const buffer = new ArrayBuffer(32);
const array = new Int16Array(buffer);

for (let i = 0; i < array.length; i++) {
  array[i] = i * i;
}

console.log(array);
// → [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 196, 225]
```

另一方面，`DataView` 则允许更细粒度的数据访问。 我们可以通过为每种值类型提供专门的 getter 和 setter 来选择从缓冲区读取和写入的值的类型，这使得 `DateView` 可用于序列化数据结构。

```js
const buffer = new ArrayBuffer(32);
const view = new DataView(buffer);

const person = { age: 42, height: 1.76 };

view.setUint8(0, person.age);
view.setFloat64(1, person.height);

console.log(view.getUint8(0)); // 期望输出: 42
console.log(view.getFloat64(1)); // 期望输出: 1.76
```

此外，`DataView` 还允许开发者选择数据存储的字节顺序，这点在从外部源（如网络，文件或 GPU 中）接收数据时非常有用。

```js
const buffer = new ArrayBuffer(32);
const view = new DataView(buffer);

view.setInt32(0, 0x8BADF00D, true); // 小端序写入.
console.log(view.getInt32(0, false)); // 大端序读出.
// 期望输出: 0x0DF0AD8B (233876875)
```

很长时间以来，实现一个高效的 `DataView` 的呼声一直很高（参见5年前的 [bug 报告](https://bugs.chromium.org/p/chromium/issues/detail?id=225811))，今天，我们很高兴地宣布： DataView 的性能现已经得到大幅提升！

## 传统的运行时实现 {#implemention}

在此之前，`DataView` 方法在 V8 中是内置的 C++ 运行时函数。这种函数的调用成本非常高昂，因为每一次跨语言调用，我们都需要在 C++ 和 JavaScript 之间进行信息的转换。

为了研究这个实现实际的性能损耗，我们构建了一个性能基准测试，将原生的 `DataView` getter 实现与模拟 `DataView` 行为的 JavaScript 包装函数进行比较。这个包装函数使用 `Uint8Array` 从底层缓冲区逐字节读取数据，然后利用这些字节计算出返回值。下面是读取小端序32位无符号整数值的函数：

```js
function LittleEndian(buffer) { // 模拟小端序的 DataView 数据读取.
  this.uint8View_ = new Uint8Array(buffer);
}

LittleEndian.prototype.getUint32 = function(byteOffset) {
  return this.uint8View_[byteOffset] |
    (this.uint8View_[byteOffset + 1] << 8) |
    (this.uint8View_[byteOffset + 2] << 16) |
    (this.uint8View_[byteOffset + 3] << 24);
};
```

在 V8 中，我们已经对 `TypedArray` 进行了大量的优化，因此它们的性能就是了我们想要追赶的目标。

<figure>
  <img src="/_img/dataview/dataview-original.svg" alt="">
  <figcaption>原始 <code>DataView</code> 性能</figcaption>
</figure>

我们的基准测试显示，在大端序和小端序的数据存取测试中，原生 `DataView` getter 的性能均比基于 `Uint8Array` 的包装函数低了**4倍**。

## 提升基准性能 {#improving}

想要提高 `DataView` 对象的性能，我们所做的第一步就是将它的实现从 C++ 运行时转移到 [`CodeStubAssembler`（简称CSA）](/blog/csa) 中。CSA 是一种可移植的汇编语言，它允许我们直接在 TurboFan 的机器级中间表示（IR）中编写代码，我们一般使用 CSA 来实现 V8 中 JavaScript 标准库的优化部分。在 CSA 中重写代码可以完全绕过对 C++ 的调用，并利用 TurboFan 的后端来生成高效的机器代码。

然而，手动编写 CSA 代码非常的麻烦。 CSA 中的控制流与汇编一样，使用的是显式的标签和 `goto`s，这使得代码阅读起来诘屈聱牙，晦涩难懂。

为了使开发人员能够更容易地为 V8 JavaScript 标准库的优化做出贡献，并提高代码的可读性和可维护性，我们开始设计一种名为 V8 *Torque* 的新语言，该语言可编译为 CSA 。*Torque* 的目标是抽象出 CSA 代码中难以编写和维护的低层次细节，同时保持相同的性能表现。

重写 `DataView` 的代码是个尝试使用 Torque 的绝佳机会，并且可以向 Torque 的开发者提供许多相关的反馈。下面这个就是用 Torque 编写的 `getUint32()` 函数：

```torque
macro LoadDataViewUint32(buffer: JSArrayBuffer, offset: intptr,
                    requested_little_endian: bool,
                    signed: constexpr bool): Number {
  let data_pointer: RawPtr = buffer.backing_store;

  let b0: uint32 = LoadUint8(data_pointer, offset);
  let b1: uint32 = LoadUint8(data_pointer, offset + 1);
  let b2: uint32 = LoadUint8(data_pointer, offset + 2);
  let b3: uint32 = LoadUint8(data_pointer, offset + 3);
  let result: uint32;

  if (requested_little_endian) {
    result = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
  } else {
    result = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
  }

  return convert<Number>(result);
}
```

将 `DataView` 的方法实现转移到 Torque 上已经在性能上有了**3倍**的提升，但还是无法与基于 `Uint8Array` 的包装函数相媲美。

<figure>
  <img src="/_img/dataview/dataview-torque.svg" alt="">
  <figcaption> Torque 编写的 <code>DataView</code> 性能 </figcaption>
</figure>

## 优化 TurboFan {#optimizing}

当 JavaScript 代码被执行多次后，我们使用 TurboFan 优化编译器对其进行二次编译，以生成高度优化的机器代码，该机器码比解释运行的字节码运行效率更高。

TurboFan 的工作原理是将传入的 JavaScript 代码转换为内部的图表示（更确切地说，这种内部表示叫 [“sea of nodes”](https://darksi.de/d.sea-of-nodes/) ）。它从 JavaScript 操作和语义的高级节点开始，逐渐将高级节点细化为更底层的低级节点，直到最终生成机器代码。

例如，函数调用（例如调用一个 `DataView` 的方法）在 TurboFan 内部表示为 `JSCall` 节点，并最终归约成机器代码中实际的函数调用。

但是，TurboFan 允许我们检查 `JSCall` 节点是否是对已知函数的调用，例如调用内置函数就是其中一种情况。如果是的话，我们可以在 IR 中内联该函数调用。这意味着复杂的 `JSCall` 在编译时被可以被内联展开， TurboFan 在可以在之后的流程中直接在更广泛的上下文中优化这个函数内部的代码。最重要的是，我们可以借此避免昂贵的函数调用开销。

<figure>
  <img src="/_img/dataview/dataview-turbofan-initial.svg" alt="">
  <figcaption> 最初的 TurboFan <code>DataView</code> 性能 </figcaption>
</figure>

实现了 TurboFan 的函数内联优化使 `DataView` 的性能可以与 `Uint8Array` 包装函数掰一掰手腕，并且比最初的 C++ 实现快 **8倍**。

## 进一步的 TurboFan 优化 {#further}

在内联 `DataView` 方法后，我们查看了 TurboFan 生成的机器代码，发现仍然有一些改进的余地。 `DataView` 方法的第一版实现正试图贴近标准规范，并在制定的位置抛出错误（例如，当开发者试图读取或写入超出底层 `ArrayBuffer` 的边界时）。

但是，我们在 TurboFan 中编写的代码主要是为了面对常见的执行情况时，可以尽快进行代码优化 —— 它不需要支持所有可能的边缘情况。因此我们可以删除不必要的错误处理，取而代之的是，在需要抛出错误时只是简单地回退至非优化实现的 Torque 代码（去优化），这样能够将生成的代码的大小减少大约 35％，并显著提升代码执行速度，以及生成更简洁的 TurboFan 代码。

沿着这个在 TurboFan 中尽可能特化的想法，我们还移除了对优化代码中过大（Smi 之外）的索引或偏移的支持。这使得我们能够摆脱对 float64 算法中不合适的 32 位偏移的处理，并避免在堆上存储大整数。

与最初的 TurboFan 实现相比，这项优化使得 `DataView` 基准测试分数翻了一倍还多。`DataView` 目前的性能是 `Uint8Array` 包装函数的 3 倍，更比原始 `DataView` 运行速度的快了 **16 倍**之多！

<figure>
  <img src="/_img/dataview/dataview-turbofan-final.svg" alt="">
  <figcaption> 最终的 TurboFan <code>DataView</code> 性能 </figcaption>
</figure>

## 影响 {#impact}

基于上面的基准测试，我们已经评估了 `DataView` 的新实现在一些真实示例中的性能影响。

`DataView`s 经常被用来解码以二进制格式编码的数据。 例如，有一种二进制格式叫 [FBX](https://en.wikipedia.org/wiki/FBX)，常被用于交换 3D 动画。我们对一个很受欢迎的 3D JavaScript 库 [three.js](https://threejs.org/) 的 FBX 加载程序进行了检测，发现其代码执行时间缩短了10％（约80毫秒）。

我们将 `DataView` 的整体性能与 `TypedArray` 进行了比较，结果发现新的 `DataView` 实现与 `TypedArray` 在性能方面不分伯仲。尤其在访问以原生字节顺序排列的数据（英特尔处理器上的小端）时，新实现弥补上了大多数的性能差距，并使`DataView`成为了 V8 上的实用之选。

<figure>
  <img src="/_img/dataview/dataview-vs-typedarray.svg" alt="">
  <figcaption><code>DataView</code> vs. <code>TypedArray</code> 峰值性能</figcaption>
</figure>

我们诚挚地希望开发者可以尝试使用新的 `DataView`，而不是依赖于用 `TypedArray` 实现的 shim。 请向我们发送有关您使用 `DataView` 的反馈！ 您可以使用我们的 [错误跟踪器](https://crbug.com/v8/new) ，或将邮件发送到<v8-users@googlegroups.com>，或在 Twitter 上 [@ v8js](https：//twitter.com/v8js)。
