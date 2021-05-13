---
title: '更快的 JavaScript 调用'
author: 'Victor Gomes, the frame shredder'
avatars:
  - 'victor-gomes'
date: 2021-02-15
tags:
  - internals
description: '通过删除参数 adaptor frame 来加快 JavaScript 调用'
tweet: '1361337569057865735'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---

JavaScript 允许使用与预期的参数数量不同的参数数量来调用函数，即，与所声明的形式参数相比，可以传递更少或更多的参数。前者称为 under-application，后者称为 over-application。

在 under-application 的情况下，将为其余参数分配未定义（undefined）的值。在 over-application 的情况下，可以使用剩余（rest）参数和 `arguments` 属性访问其余参数，或者它们只是多余的，可以忽略。如今，许多 Web/Node.js 框架都使用此 JS 特性来接受可选参数并创建更灵活的 API。

直到最近，V8 都有一种特殊的机制来处理参数大小不匹配的情况：arguments adaptor frame。不幸的是，参数自适应（argument adaption）是以性能为代价的，但是在现代的前端和中间件框架中通常是必需的。事实证明，通过一个巧妙的技巧，我们可以删除此多余的帧（frame），简化 V8 代码库，并消除几乎所有的开销。

我们可以通过微基准测试（micro-benchmark）计算删除 arguments adaptor frame 对性能的影响。

```js
console.time();
function f(x, y, z) {}
for (let i = 0; i <  N; i++) {
  f(1, 2, 3, 4, 5);
}
console.timeEnd();
```

![通过微基准测试，测量删除 arguments adaptor frame 的性能影响。](/_img/v8-release-89/perf.svg)

该图显示，在 [JIT-less 模式](https://v8.dev/blog/jitless)（Ignition）下运行时，不再有开销，并且性能提高了 11.2％。使用 [TurboFan](https://v8.dev/docs/turbofan) 时，我们的速度提高了 40％。

这个微基准测试自然是为了最大程度地提高 arguments adaptor frame 的影响而设计的。但是，我们已经看到许多基准测试都有相当大的改进，例如[我们的 内部 JSTests/Array 基准测试](https://chromium.googlesource.com/v8/v8/+/b7aa85fe00c521a704ca83cc8789354e86482a60/test/js-perf-test/JSTests.json)（7％）和 [Octane2](https://github.com/chromium/octane)（Richards 为 4.6％，EarleyBoyer 为 6.1％）中。

## TL;DR: 颠倒参数顺序 { #tl;dr:-reverse-the-arguments }

该项目的重点是删除 arguments adaptor frame，该帧为被调用者（callee）在访问堆栈中的参数时提供了一致的接口。为此，我们需要颠倒堆栈中的参数顺序，并在被调用者帧（callee frame）中添加一个包含实际参数数量的新插槽（slot）。下图显示了更改前后的典型帧（typical frame）示例。

![删除  arguments adaptor frame 之前和之后的典型 JavaScript 栈帧（stack frame）。](/_img/adaptor-frame/frame-diff.svg)

## 使 JavaScript 调用更快 { #making-javascript-calls-faster }

为了理解为加快调用速度所做的工作，我们来看看 V8 如何执行调用以及 arguments adaptor frame 如何工作。

当我们在 JS 中执行函数调用时，在 V8 内部会发生什么？让我们假设有以下 JS 脚本：

```js
function add42(x) {
  return x + 42;
}
add42(3);
```

![V8 内部在函数调用期间的执行流程。](/_img/adaptor-frame/flow.svg)

## Ignition { #ignition }

V8 是多层 VM。它的第一层称为 [Ignition](https://v8.dev/docs/ignition)，它是一个带有累加器寄存器（register）的字节码（bytecode）堆栈机。V8 首先将代码编译为 [Ignition 字节码](https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775)。上面的调用被编译为以下内容：

```
0d              LdaUndefined              ;; Load undefined into the accumulator
26 f9           Star r2                   ;; Store it in register r2
13 01 00        LdaGlobal [1]             ;; Load global pointed by const 1 (add42)
26 fa           Star r1                   ;; Store it in register r1
0c 03           LdaSmi [3]                ;; Load small integer 3 into the accumulator
26 f8           Star r3                   ;; Store it in register r3
5f fa f9 02     CallNoFeedback r1, r2-r3  ;; Invoke call
```

调用的第一个参数通常称为接收者（receiver）。接收者是 JS 函数（JSFunction）中的 `this` 对象，并且每个 JS 函数调用都必须有一个。`CallNoFeedback` 的字节码处理程序需要使用寄存器列表 `r2-r3` 中的参数调用对象 `r1`。

在深入字节码处理程序之前，请注意寄存器是如何在字节码中编码的。它们是负的单字节整数：`r1` 编码为 `fa`，`r2` 编码为 `f9`，`r3` 编码为 `f8`。我们可以将任何寄存器 ri 称为 `fb - i`，实际上，正如我们将看到的，正确的编码是 `- 2 - kFixedFrameHeaderSize - i`。寄存器列表使用第一个寄存器和列表的大小进行编码，因此 `r2-r3` 为 `f9 02`。

Ignition 中有许多字节码调用处理程序。你可以在[此处](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/interpreter/bytecodes.h;drc=3965dcd5cb1141c90f32706ac7c965dc5c1c55b3;l=184)查看它们的列表。它们彼此之间略有不同。对于使用 `undefined` 的接收者的调用，对于属性调用，对于具有固定数量的参数的调用或对于通用调用，存在优化的字节码。在这里，我们分析 `CallNoFeedback`，这是一个通用调用，在该调用中，我们不累加执行过程中的反馈。

该字节码的处理程序非常简单。它是用 [`CodeStubAssembler`](https://v8.dev/docs/csa-builtins) 编写的，你可以在[此处](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/interpreter/interpreter-generator.cc;drc=6cdb24a4ce9d4151035c1f133833137d2e2881d1;l=1467)查看。本质上，它是对依赖于架构（architecture-dependent）的内置 [`InterpreterPushArgsThenCall`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/builtins/x64/builtins-x64.cc;drc=8665f09771c6b8220d6020fe9b1ad60a4b0b6591;l=1277) 的尾调用。

内置函数实际上将返回地址（return address）弹出到临时寄存器中，推入所有参数（包括接收者（receiver）），然后推回返回地址。在这一点上，我们不知道被调用者是否是可调用对象，也不知道被调用者期望多少个参数，即它的形式参数数量。

![内置 `InterpreterPushArgsThenCall` 执行后的帧状态。](/_img/adaptor-frame/normal-push.svg)

最终，对内置 [`Call`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/builtins/x64/builtins-x64.cc;drc=8665f09771c6b8220d6020fe9b1ad60a4b0b6591;l=2256) 执行尾调用。在那里，它检查目标是否是适当的函数，构造函数或任何可调用对象。它还读取 `shared function info` 结构以获取其形式参数数量。

如果被调用者（callee）是一个函数对象，它将对内置的 [`CallFunction`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/builtins/x64/builtins-x64.cc;drc=8665f09771c6b8220d6020fe9b1ad60a4b0b6591;l=2038) 进行尾调用，在其中进行一堆检查，包括是否有 `undefined` 的对象作为接收者。 如果我们有一个 `undefined` 或 `null` 的对象作为接收者，则应根据 [ECMA 规范](https://262.ecma-international.org/11.0/#sec-ordinarycallbindthis)对其进行修正，以引用全局代理对象。

然后执行对内置 [`InvokeFunctionCode`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/codegen/x64/macro-assembler-x64.cc;drc=a723767935dec385818d1134ea729a4c3a3ddcfb;l=2781) 的尾调用，在没有参数不匹配的情况下，InvokeFunctionCode 将仅调用被调用对象（callee object）中字段 `Code` 所指向的内容。这可以是优化的函数，也可以是内置的 [`InterpreterEntryTrampoline`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/builtins/x64/builtins-x64.cc;drc=8665f09771c6b8220d6020fe9b1ad60a4b0b6591;l=1037)。

如果我们假设要调用的函数尚未进行优化，则 Ignition trampoline 将设置一个 `IntepreterFrame`。你可以在[此处](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/execution/frame-constants.h;drc=574ac5d62686c3de8d782dc798337ce1355dc066;l=14)查看 V8 中帧类型的简短摘要。

无需过多讨论接下来发生的事情细节，我们可以在被调用者（callee）执行期间看到解释器帧（interpreter frame）的快照。

![调用 `add42(3)` 的 `InterpreterFrame`。](/_img/adaptor-frame/normal-frame.svg)

我们看到帧中有固定数量的插槽（slots）：返回地址（return address），前一个帧指针（previous frame pointer），上下文（context），我们正在执行的当前函数对象，该函数的字节码数组（bytecode array）以及我们当前正在执行的字节码的偏移量（bytecode offset）。最后，我们有一个专用于此函数的寄存器列表（你可以将它们视为函数局部变量）。`add42` 函数实际上没有任何寄存器，但调用者（caller）具有类似的帧，其中包含 3 个寄存器。

如预期的那样，add42 是一个简单的函数：

```
25 02             Ldar a0          ;; Load the first argument to the accumulator
40 2a 00          AddSmi [42]      ;; Add 42 to it
ab                Return           ;; Return the accumulator
```

请注意我们如何在 `Ldar`_（Load Accumulator Register，负载累加器寄存器）_ 字节码中对参数进行编码：参数 `1`（`a0`）的编码为数字 `02`。实际上，任何参数的编码都是 `[ai] = 2 + parameter_count - i - 1`，接收者（receiver）的编码都是 `[this] = 2 + parameter_count`，或者说在本例中为 `[this] = 3`。此处的参数数量不包括接收者。

现在，我们能够理解为什么我们用这种方式对寄存器和参数进行编码。它们只是表示与帧指针（frame pointer）的偏移量。然后，我们可以用相同的方式理解参数/寄存器的加载和存储。帧指针的最后一个参数的偏移量为 `2`（先前的帧指针和返回地址）。这就解释了编码中的 `2`。 解释器帧（interpreter frame）的固定部分是 `6` 个插槽（距帧指针 `4` 个），因此寄存器零位于偏移量 `-5` 处，即 `fb`，寄存器 `1` 位于 `fa` 处。聪明吧？

但是请注意，为了能够访问参数，该函数必须知道堆栈中有多少个参数！ 索引 `2` 指向最后一个参数，而不管有多少个参数！

`Return` 的字节码处理程序将通过调用内置的 `LeaveInterpreterFrame` 来完成。该内置函数本质上是从帧中读取函数对象以获取参数数量，弹出当前帧，恢复帧指针（frame pointer），将返回地址保存在暂存器（scratch register）中，根据参数数量弹出参数并跳转到暂存器中的地址。

所有这一切都很棒！但是，当我们调用一个带有少于或多于其参数数量的参数的函数时，会发生什么呢？聪明的参数/寄存器访问将失败，并且如何在调用结束时清理参数？

## Arguments adaptor frame { #arguments-adaptor-frame }

现在，使用更少和更多的参数调用 `add42`：

```js
add42();
add42(1, 2, 3);
```

我们 JS 开发人员将知道，在第一种情况下，`x` 将被赋值为 `undefined`，并且该函数将返回 `undefined + 42 = NaN`。在第二种情况下，`x` 将被分配为 `1`，函数将返回 `43`，其余参数将被忽略。请注意，调用者（caller）不知道是否会发生这种情况。即使调用者检查了参数数量，被调用者（callee）也可以使用剩余（rest）参数或 arguments 对象访问所有其他参数。 实际上，在非严格模式（sloppy mode）下甚至可以在 `add42` 外部访问 arguments 对象。

如果我们执行与之前相同的步骤，则将首先调用内置的 `InterpreterPushArgsThenCall`。它会将参数推入堆栈，如下所示：

![内置 `InterpreterPushArgsThenCall` 执行后的帧状态。](/_img/adaptor-frame/adaptor-push.svg)

继续与之前相同的过程，我们检查被调用者（callee）是否为函数对象，获取其参数数量，并将接收者修正到全局代理（global proxy）。最终，我们到达了 `InvokeFunctionCode` 。

在这里，而不是跳转到被调用者（callee）对象中的 `Code`。我们检查参数个数（argument size）和参数数量之间是否不匹配，然后跳转到 `ArgumentsAdaptorTrampoline`。

在此内置函数中，我们构建了一个额外的帧，即臭名昭著的 arguments adaptor frame。在不解释内置函数内部实现的情况下，我将向你介绍内置函数调用被调用者的 `Code` 之前的帧状态。请注意，这是一个恰当的 `x64 调用`（不是 `jmp`），在执行被调用者之后，我们将返回到 `ArgumentsAdaptorTrampoline`。这与尾调用的 `InvokeFunctionCode` 形成对比。

![带有参数自适应（arguments adaptation）的堆栈帧（Stack frames）。](/_img/adaptor-frame/adaptor-frames.svg)

你可以看到，我们创建了另一个帧，该帧复制了所有必需的参数，以使 arguments 的参数数量精确地位于被调用者帧（callee frame）的顶部。它创建了被调用者（callee）函数的接口，因此后者无需知道参数的数量。被调用者（callee）将始终能够使用与以前相同的计算来访问其参数，即 `[ai] = 2 + parameter_count - i - 1`。

V8 具有特殊的内置函数，它们在需要通过剩余（rest）参数或 arguments 对象访问其余参数时就了解适配器帧（adaptor frame）。它们将始终需要检查被调用者帧（callee’s frame）上方的适配器帧类型（adaptor frame type），然后采取相应措施。

如你所见，我们解决了参数/寄存器访问问题，但是却造成了很多复杂性。每个需要访问所有参数的内置函数都需要了解并检查适配器帧（adaptor frame）的存在。不仅如此，我们还需要注意不要访问陈旧的旧数据。考虑对 `add42` 的以下更改：

```js
function add42(x) {
  x += 42;
  return x;
}
```

现在，字节码数组为：

```
25 02             Ldar a0       ;; Load the first argument to the accumulator
40 2a 00          AddSmi [42]   ;; Add 42 to it
26 02             Star a0       ;; Store accumulator in the first argument slot
ab                Return        ;; Return the accumulator
```

如你所见，我们现在修改 `a0`。因此，在调用 `add42(1, 2, 3)` 的情况下，arguments adaptor frame 中的插槽（slot）将被修改，但调用者帧（caller frame）仍将包含数字 `1`。我们需要注意，参数对象正在访问修改后的值，而不是陈旧的值。

从函数返回很简单，尽管很慢。还记得 `LeaveInterpreterFrame` 做什么吗？它基本上会弹出被调用者帧（callee frame）和逐个弹出参数直到参数个数的数量为止。因此，当我们返回 arguments adaptor stub 时，堆栈如下所示：

![`add42`执行被调用者（callee）之后的帧状态。State of the frames after the execution of the callee `add42`.](/_img/adaptor-frame/adaptor-frames-cleanup.svg)

我们只需要弹出参数数量，弹出 adaptor frame，根据实际参数数量弹出所有参数，然后返回到调用者（caller）执行即可。

TL;DR: arguments adaptor 机制不仅复杂，而且成本很高。

## 移除 arguments adaptor frame { #removing-the-arguments-adaptor-frame }

我们可以做得更好吗？我们可以移除 adaptor frame 吗？ 事实证明，我们确实可以。

让我们回顾一下我们的要求：

1. 我们需要能够像以前一样无缝访问参数和寄存器。访问它们时不进行检查。因为那样的成本太昂贵了。
2. 我们需要能够从堆栈中构造剩余（rest）参数和 arguments 对象。
3. 从调用返回时，我们需要能够轻松清理未知数量的参数。
4. 而且，当然我们希望没有额外的帧！

如果要消除多余的帧，则需要确定将参数放在哪里：在被调用者帧（callee frame）中还是在调用者帧（caller frame）中。

### Arguments 在 callee frame 中 { #arguments-in-the-callee-frame }

假设我们将参数（arguments）放在被调用者帧（callee frame）中。这实际上似乎是一个好主意，因为无论何时弹出帧，我们也会立即弹出所有参数！

参数必须位于保存的帧指针（frame pointer）和帧末尾之间的某个位置。这就要求帧的大小不会被静态地知道。访问参数仍然很容易，这是与帧指针的简单偏移量。但是现在访问寄存器要复杂得多，因为它根据参数的数量而有所不同。

堆栈指针（stack pointer）始终指向最后一个寄存器（register），然后我们可以使用它来访问寄存器而无需知道参数数。这种方法实际上可能有效，但是它有一个主要缺点。那将需要复制所有可以访问寄存器和参数的字节码。我们需要一个 `LdaArgument` 和一个 `LdaRegister` 来代替 `Ldar`。当然，我们还可以检查是否正在访问参数或寄存器（正或负偏移量），但这将需要检查每个参数并进行寄存器访问。显然成本太昂贵了！

### Arguments in the caller frame { #arguments-in-the-caller-frame }

好吧……如果我们坚持将参数（arguments）放在调用者帧（caller frame）中，该怎么办？

记住如何计算一帧中参数 `i` 的偏移量：`[ai] = 2 + parameter_count - i - 1`。如果我们拥有所有 arguments（不仅是 parameters），则偏移量将为 `[ai] = 2 + argument_count - i - 1`。也就是说，对于每次参数（argument）访问，我们都需要加载实际的参数计数（argument count）。

但是，如果我们颠倒参数的顺序会发生什么呢？现在可以简单地将偏移量计算为 `[ai] = 2 + i`。我们不需要知道堆栈中有多少个参数，但是如果我们可以保证至少在堆栈中至少有参数个数（parameter count of arguments），那么我们就可以始终使用此方案来计算偏移量。

换句话说，压入堆栈的参数数量将始终是参数数量（number of arguments）与形式参数数量（formal parameter count）之间的最大值，并且在需要时将使用 undefined 对象进行填充。

这还有另一个好处！对于任何 JS 函数，接收者（receiver）始终位于相同的偏移量处，位于返回地址（return address）的正上方：`[this] = 2`。

对于我们的第 `1` 号和第 `4` 号要求，这是一个干净的解决方案。其他两个要求又如何呢？我们如何构造剩余（rest）参数和 arguments 对象？返回调用者（caller）时如何清理堆栈中的参数？为此，我们仅缺少参数计数（argument count）。我们需要将其保存在某个地方。只要可以轻松访问此信息，此处的选择就有些随意。有两个基本选择：将其推入到调用者帧（caller frame）中的接收者（receiver）之后，或作为固定标头（fixed header）部分中的被呼叫者帧（callee frame）的一部分。我们实现了后者，因为它合并了 Interpreter 和 Optimized frames 的固定标头部分。

如果在 V8 v8.9 中运行示例，则在 `InterpreterArgsThenPush` 之后将看到以下堆栈（请注意，现在参数已颠倒）：

![内置 `InterpreterPushArgsThenCall` 执行后的帧状态。](/_img/adaptor-frame/no-adaptor-push.svg)

所有执行都遵循相似的路径，直到我们到达 InvokeFunctionCode。在这里，我们在 under-application 情况下处理参数，根据需要推送尽可能多的 undefined 对象。请注意，在 over-application 情况下，我们不会进行任何更改。最后，我们通过寄存器将参数数量（number of arguments）传递给被调用者（callee）的 `Code`。 在 `x64` 的情况下，我们使用寄存器 `rax`。

如果被调用者（callee）尚未进行优化，我们将到达 `InterpreterEntryTrampoline`，它会构建以下堆栈帧（stack frame）。

![没有 arguments adaptors 的堆栈帧（Stack frames）。](/_img/adaptor-frame/no-adaptor-frames.svg)

被调用者帧（callee frame）有一个额外的插槽（slot），其中包含可用于构造剩余（rest）参数或 arguments 对象的参数数量（number of arguments），并可以在返回调用者（caller）之前清除堆栈中的参数。

作为返回，我们修改 `LeaveInterpreterFrame` 以读取堆栈中的参数计数（arguments count），并弹出参数计数（argument count）和形式参数计数（formal parameter count）之间的最大数目。

## TurboFan { #turbofan }

那么优化代码呢？让我们稍微更改一下初始脚本，以强制 V8 使用 TurboFan 对其进行编译：

```js
function add42(x) { return x + 42; }
function callAdd42() { add42(3); }
%PrepareFunctionForOptimization(callAdd42);
callAdd42();
%OptimizeFunctionOnNextCall(callAdd42);
callAdd42();
```

在这里，我们使用 V8 内部机制（intrinsics）来强制 V8 优化调用，否则 V8 仅在我们的小函数变得热门（经常使用）时才对其进行优化。在优化之前，我们将其称为一次（once），以收集一些可用于指导编译的类型信息。在[此处](https://v8.dev/docs/turbofan)阅读有关 TurboFan 的更多信息。

在这里，我仅向你显示与我们相关的部分生成代码。

```nasm
movq rdi,0x1a8e082126ad    ;; Load the function object <JSFunction add42>
push 0x6                   ;; Push SMI 3 as argument
movq rcx,0x1a8e082030d1    ;; <JSGlobal Object>
push rcx                   ;; Push receiver (the global proxy object)
movl rax,0x1               ;; Save the arguments count in rax
movl rcx,[rdi+0x17]        ;; Load function object {Code} field in rcx
call rcx                   ;; Finally, call the code object!
```

尽管使用汇编程序编写，但是如果你参考我的注释，那么此代码段应该不难理解。本质上，在编译调用时，TF需要完成 `InterpreterPushArgsThenCall`，`Call`，`CallFunction` 和 `InvokeFunctionCall` 内置函数中的所有工作。希望它有更多的静态信息来执行此操作，并发出更少的计算机指令。

### 带 arguments adaptor frame 的 TurboFan { #turbofan-with-the-arguments-adaptor-frame }

现在，让我们来看看参数数量（number of arguments）和参数计数（parameter count）不匹配的情况。考虑调用 `add42(1, 2, 3)`。编译为：

```nasm
movq rdi,0x4250820fff1    ;; Load the function object <JSFunction add42>
;; Push receiver and arguments SMIs 1, 2 and 3
movq rcx,0x42508080dd5    ;; <JSGlobal Object>
push rcx
push 0x2
push 0x4
push 0x6
movl rax,0x3              ;; Save the arguments count in rax
movl rbx,0x1              ;; Save the formal parameters count in rbx
movq r10,0x564ed7fdf840   ;; <ArgumentsAdaptorTrampoline>
call r10                  ;; Call the ArgumentsAdaptorTrampoline
```

如你所见，不难为 TF 添加对参数（argument）和参数计数（parameter count）不匹配的支持。只需调用 arguments adaptor trampoline！

然而，这是昂贵的。对于每个优化的调用，我们现在都需要输入 arguments adaptor trampoline，并像未优化的代码一样对帧进行处理。这就解释了为什么在优化的代码中删除 adaptor frame 的性能收益比在 Ignition 上要大得多。

但是，生成的代码非常简单。从中返回非常容易（结尾）：

```nasm
movq rsp,rbp   ;; Clean callee frame
pop rbp
ret 0x8        ;; Pops a single argument (the receiver)
```

我们弹出帧，并根据参数计数（parameter count）发出返回指令。如果我们在参数数量（number of arguments）和参数计数（parameter count）上不匹配，则 adaptor frame trampoline 将对其进行处理。

### 没有 arguments adaptor frame 的 TurboFan { #turbofan-without-the-arguments-adaptor-frame }

生成的代码本质上与参数数量（number of arguments）匹配的调用中的代码相同。考虑调用 `add42(1, 2, 3)`。这将生成：

```nasm
movq rdi,0x35ac082126ad    ;; Load the function object <JSFunction add42>
;; Push receiver and arguments 1, 2 and 3 (reversed)
push 0x6
push 0x4
push 0x2
movq rcx,0x35ac082030d1    ;; <JSGlobal Object>
push rcx
movl rax,0x3               ;; Save the arguments count in rax
movl rcx,[rdi+0x17]        ;; Load function object {Code} field in rcx
call rcx                   ;; Finally, call the code object!
```

该函数的结尾如何？我们不再返回到 rguments adaptor trampoline，因此结尾确实比以前复杂了一些。

```nasm
movq rcx,[rbp-0x18]        ;; Load the argument count (from callee frame) to rcx
movq rsp,rbp               ;; Pop out callee frame
pop rbp
cmpq rcx,0x0               ;; Compare arguments count with formal parameter count
jg 0x35ac000840c6  <+0x86>
;; If arguments count is smaller (or equal) than the formal parameter count:
ret 0x8                    ;; Return as usual (parameter count is statically known)
;; If we have more arguments in the stack than formal parameters:
pop r10                    ;; Save the return address
leaq rsp,[rsp+rcx*8+0x8]   ;; Pop all arguments according to rcx
push r10                   ;; Recover the return address
retl
```

# 结论

Arguments adaptor frame 是一个临时解决方案，用于参数（arguments）和形式参数（formal parameters）数量不匹配的调用。这是一个简单的解决方案，但它带来了很高的性能成本，并增加了代码库的复杂性。如今，许多 Web 框架使用此功能创建更灵活的 API 都会加剧性能成本。颠倒堆栈中参数顺序的简单想法可以大大降低实现复杂性，并消除了此类调用的几乎所有开销。
