---
title: .wasm 是什么？wasm 反编译简介
author: 'Wouter van Oortmerssen ([@wvo](https://twitter.com/wvo))'
avatars:
  - 'wouter-van-oortmerssen'
date: 2020-04-27
tags:
  - WebAssembly
  - tooling
description: 'WABT gains a new decompilation tool that can make it easier to read the contents of Wasm modules.'
tweet: '1254829913561014272'
cn:
  author: 'Vincent Wang ([@Vincent0700](https://github.com/Vincent0700))。<br/>Blog：[https://vincentstudio.info](https://vincentstudio.info)'
  avatars: 
    - vincent-wang
---
我们有越来越多的生成或操作 `.wasm` 文件的编译器和其他工具，有时你可能想看看里面。也许您是这种工具的开发人员，或更直接地，您是 `Wasm` 程序员，并且出于性能或其他原因，想知道生成的代码是什么样的。

问题是，Wasm相当底层，很像实际的汇编代码。特别是，与JVM不同，所有数据结构都编译成加载/存储操作，而不是方便地命名类和字段。诸如LLVM之类的编译器可以进行大量的转换，使生成的代码看起来像输入的代码一样。

## 反汇编还是..反编译？ {#disassemble-or-decompile}

您可以使用 `wasm2wat`（[WABT](https://github.com/WebAssembly/wabt) 工具包的一部分）之类的工具，将 `.wasm` 转换为 Wasm 的标准文本格式 `.wat`，是非常忠实但不是特别可读的表示形式。

例如，一个简单的计算点积的 C 函数：

```c
typedef struct { float x, y, z; } vec3;

float dot(const vec3 *a, const vec3 *b) {
    return a->x * b->x +
           a->y * b->y +
           a->z * b->z;
}
```

我们使用 `clang dot.c -c -target wasm32 -O2`，然后使用 `wasm2wat -f dot.o` 将其转换为下面这个 `.wat`：

```wasm
(func $dot (type 0) (param i32 i32) (result f32)
  (f32.add
    (f32.add
      (f32.mul
        (f32.load
          (local.get 0))
        (f32.load
          (local.get 1)))
      (f32.mul
        (f32.load offset=4
          (local.get 0))
        (f32.load offset=4
          (local.get 1))))
    (f32.mul
      (f32.load offset=8
        (local.get 0))
      (f32.load offset=8
        (local.get 1))))))
```

那只是一小段代码，但是由于许多原因，阅读起来并不好。除了缺乏基于表达式的语法和冗长之外，还不容易让人理解的内存中的数据结构。现在想象一下如果是大型程序的输出，很容易让人崩溃。

如果替代 `wasm2wat`，运行 `wasm-decompile dot.o`，您将得到：

```c
function dot(a:{ a:float, b:float, c:float },
             b:{ a:float, b:float, c:float }):float {
  return a.a * b.a + a.b * b.b + a.c * b.c
}
```

这看起来要熟悉得多。除了模仿你熟悉的基于表达式语法的编程语言的外，反编译器还会查看函数中的所有加载和存储的数据，并尝试推断其结构。然后，它给每个用作指针的变量添加“内联”的结构声明。它不会创建命名的结构体声明，因为它不一定知道3个浮点数的哪种用法代表相同的概念。

## 反编译成什么？ {#decompile-to-what}

`wasm-decompile` 的输出结果尽可能看起来像“非常普通的编程语言”，但仍十分接近 Wasm 的表达。

它的目标第一是可读性：尽可能用易于理解的代码帮助读者理解 `.wasm` 中的内容。其次是尽可能 1:1 表示 Wasm，以避免失去它作为反汇编程序的实用性。显然，这两个目标并不总是统一的。

这个输出并不意味着是一种实际的编程语言，并且目前无法将其编译回 Wasm。

### 加载和存储 {#loads-and-stores}

如上所示，`wasm-decompile` 会查看特定指针上的所有加载和存储。如果它们形成一个连续的访问集，它将输出这些“内联”结构声明之一。

如果不是所有“字段”都被访问，则无法确定这是固定结构，还是其他无关的内存访问形式。在这种情况下，它会退回到更简单的类型，例如 `float_ptr`（如果类型相同），在最坏的情况下，会输出一个类似 `o[2]：int` 的数组访问，其中 `o` 指向 `int` 值，我们正在访问第三个值。

最后一种情况发生的频率比你想象的要多，因为 Wasm 局部变量的功能更像寄存器而不是变量，因此优化的代码可能会为不相关的对象共享同一个指针。

反编译器尝试在索引方面更加聪明，并检测诸如 `(base + (index << 2))[0]:int` 之类的模式，这些模式是由常规的 C 数组索引操作（如 `base[index]` 其中 `base` 指向4字节类型）导致的。这些在代码中非常常见，因为 Wasm 在加载和存储上只有恒定的偏移量。`wasm-decompile` 的输出结果会将它们转换回 `base[index]:int`。

此外，它还知道绝对地址何时引用数据段。

### 控制流程 {#control-flow}

最常见的是Wasm的if-then结构，它翻译成一个熟悉的 `if (cond) { A } else { B }` 语法，另外在 Wasm 中它实际上可以返回一个值，所以它也可以表示成在某些语言中像这样的三元语法 `cond ? A : B`。

Wasm 其余的控制流基于 `block` 和 `loop` 块，以及 `br`、`br_if` 和 `br_table` 跳转。反编译器会适当地接近这样的结构，而不是试图推断它们可能来自 while/for/switch 的结构，因为这样可以更好地处理优化后的输出。例如，`wasm-decompile` 输出中典型的循环可能如下所示：

```c
loop A {
  // body of the loop here.
  if (cond) continue A;
}
```

这里，`A` 是一个标签，允许嵌套多个。与 while 循环相比，使用 `if` 和 `continue` 来控制循环可能看起来有点陌生，但它直接对应于 Wasm 的 `br_if`。

`block` 类似，但它们不是向后分支，而是向前分支：

```c
block {
  if (cond) break;
  // body goes here.
}
```

这实际上实现了 `if-then`。如果可能的话，未来版本的反编译器可能会将这些代码转换为实际版本。

Wasm 最令人惊讶的控制结构是 `br_table`，它实现了类似 `switch` 的功能，但使用了嵌套的 `block`，这往往很难读取。反编译器会将这些 `block` 展平以使它们更容易理解，例如：

```c
br_table[A, B, C, ..D](a);
label A:
return 0;
label B:
return 1;
label C:
return 2;
label D:
```

这类似于 `switch(a)` 默认返回 `D`。

### 其他有趣的功能 {#other-fun-features}

反编译器:

- 可以从调试或链接信息中提取名称，或生成名称本身。当使用现有名称时，它有特殊的代码来简化C++名称中混乱的符号。
- 已经支持多值提案，这使得表达式和语句的转化有点困难。当返回多个值时，将使用其他变量。
- 它甚至可以从数据段的 _contents_ 生成名称
- 输出所有 Wasm section 类型的漂亮声明，而不仅仅是代码。例如，通过文本输出，使其成为可能。
- 支持运算符优先级（大多数类 C 语言通用）以减少公共表达式上的 `()`。

### 局限性 {#limitations}

反编译 Wasm 比JVM字节码更难。

后者是未优化的，因此相对忠于原始代码的结构，即使名称可能丢失，也引用了唯一的类，而不仅仅是内存位置。

相比之下，大多数 `.wasm` 的输出都经过了 LLVM 的大量优化，因此常常会丢失其大部分原始结构。输出代码与程序员编写的代码非常不同。这使得 Wasm 反编译器将会是一个更大的挑战，但这并不意味着我们不应该尝试！

## 更多内容 {#more}

当然，最好的方法是反编译您自己的 Wasm 项目！

此外，关于 `wasm-decompile` 的更深入的指南，[链接](https://github.com/WebAssembly/wabt/blob/master/docs/decompiler.md)。它的实现在源文件中以 `decompiler` 开头，[链接](https://github.com/WebAssembly/wabt/tree/master/src)（欢迎提PR，使它变得更好）。一些测试用例展示了 `.wat` 和反编译器之间差异的更多示例，[链接](https://github.com/WebAssembly/wabt/tree/master/test/decompile).
