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

将 `DataView` 的方法实现转移到 Torque 上已经在性能上有了**3倍**的改进，但是还是无法与基于 `Uint8Array` 的包装函数相媲美。

<figure>
  <img src="/_img/dataview/dataview-torque.svg" alt="">
  <figcaption>Torque <code>DataView</code> performance</figcaption>
</figure>

## Optimizing for TurboFan

When JavaScript code gets hot, we compile it using our TurboFan optimizing compiler, in order to generate highly-optimized machine code that runs more efficiently than interpreted bytecode.

TurboFan works by translating the incoming JavaScript code into an internal graph representation (more precisely, [a “sea of nodes”](https://darksi.de/d.sea-of-nodes/)). It starts with high-level nodes that match the JavaScript operations and semantics, and gradually refines them into lower and lower level nodes, until it finally generates machine code.

In particular, a function call, such as calling one of the `DataView` methods, is internally represented as a `JSCall` node, which eventually boils down to an actual function call in the generated machine code.

However, TurboFan allows us to check whether the `JSCall` node is actually a call to a known function, for example one of the builtin functions, and inline this node in the IR. This means that the complicated `JSCall` gets replaced at compile-time by a subgraph that represents the function. This allows TurboFan to optimize the inside of the function in subsequent passes as part of a broader context, instead of on its own, and most importantly to get rid of the costly function call.

<figure>
  <img src="/_img/dataview/dataview-turbofan-initial.svg" alt="">
  <figcaption>Initial TurboFan <code>DataView</code> performance</figcaption>
</figure>

Implementing TurboFan inlining finally allowed us to match, and even exceed, the performance of our `Uint8Array` wrapper, and be **8 times** as fast as the former C++ implementation.

## Further TurboFan optimizations

Looking at the machine code generated by TurboFan after inlining the `DataView` methods, there was still room for some improvement. The first implementation of those methods tried to follow the standard pretty closely, and threw errors when the spec indicates so (for example, when trying to read or write out of the bounds of the underlying `ArrayBuffer`).

However, the code that we write in TurboFan is meant to be optimized to be as fast as possible for the common, hot cases — it doesn’t need to support every possible edge case. By removing all the intricate handling of those errors, and just deoptimizing back to the baseline Torque implementation when we need to throw, we were able to reduce the size of the generated code by around 35%, generating a quite noticeable speedup, as well as considerably simpler TurboFan code.

Following up on this idea of being as specialized as possible in TurboFan, we also removed support for indices or offsets that are too large (outside of Smi range) inside the TurboFan-optimized code. This allowed us to get rid of handling of the float64 arithmetic that is needed for offsets that do not fit into a 32-bit value, and to avoid storing large integers on the heap.

Compared to the initial TurboFan implementation, this more than doubled the `DataView` benchmark score. `DataView`s are now up to 3 times as fast as the `Uint8Array` wrapper, and around **16 times as fast** as our original `DataView` implementation!

<figure>
  <img src="/_img/dataview/dataview-turbofan-final.svg" alt="">
  <figcaption>Final TurboFan <code>DataView</code> performance</figcaption>
</figure>

## Impact

We’ve evaluated the performance impact of the new implementation on some real-world examples, on top of our own benchmark.

`DataView`s are often used when decoding data encoded in binary formats from JavaScript. One such binary format is [FBX](https://en.wikipedia.org/wiki/FBX), a format that is used for exchanging 3D animations. We’ve instrumented the FBX loader of the popular [three.js](https://threejs.org/) JavaScript 3D library, and measured a 10% (around 80 ms) reduction in its execution time.

We compared the overall performance of `DataView`s against `TypedArray`s. We found that our new `DataView` implementation provides almost the same performance as `TypedArray`s when accessing data aligned in the native endianness (little-endian on Intel processors), bridging much of the performance gap and making `DataView`s a practical choice in V8.

<figure>
  <img src="/_img/dataview/dataview-vs-typedarray.svg" alt="">
  <figcaption><code>DataView</code> vs. <code>TypedArray</code> peak performance</figcaption>
</figure>

We hope that you’re now able to start using `DataView`s where it makes sense, instead of relying on `TypedArray` shims. Please send us feedback on your `DataView` uses! You can reach us [via our bug tracker](https://crbug.com/v8/new), via mail to <v8-users@googlegroups.com>, or via [@v8js on Twitter](https://twitter.com/v8js).
