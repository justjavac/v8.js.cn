---
title: '使用 V8 的基于样本的分析器'
description: '本文档说明了如何使用 V8 的基于样本的分析器。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 具有内置的基于样本的性能分析器。 默认情况下，性能分析是关闭的，但可以通过 `--prof` 命令行选项启用。 采样器记录 JavaScript 和 C/C++ 代码的堆栈。

## 构建 { #build }

按照 [用 GN 构建](/docs/build-gn) 中的说明构建 `d8` shell。

## 命令行 { #command-line }

要开始分析，请使用 `--prof` 选项。分析时，V8 会生成一个 `v8.log` 文件，其中包含分析数据。

Windows:

```bash
build\Release\d8 --prof script.js
```

其它平台（如果要分析 `x64` 构建，请用 `x64` 替换 `ia32`）：

```bash
out/ia32.release/d8 --prof script.js
```

## 处理生成的输出 { #process-the-generated-output }

日志文件的处理是使用 d8 shell 运行的 JS 脚本完成的。为此，`d8` 二进制文件（或在 Windows 上为 symlink 或 `d8.exe`）必须位于 V8 检出的根目录中，或位于环境变量 `D8_PATH` 指定的路径中。注意：此二进制文件仅用于处理日志，而不用于实际的性能分析，因此它的版本无关紧要。

**确保用于分析的 `d8` 不是使用 `is_component_build` 构建的！**

Windows:

```bash
tools\windows-tick-processor.bat v8.log
```

Linux:

```bash
tools/linux-tick-processor v8.log
```

macOS:

```bash
tools/mac-tick-processor v8.log
```

## `--prof`的 Web UI  { #web-ui-for---prof }

用 `--preprocess` 预处理日志（以解析 C++ 符号等）。

```bash
$V8_PATH/tools/linux-tick-processor --preprocess > v8.json
```

在浏览器中打开 [`tools/profview/index.html`](https://v8.dev/tools/head/profview)，然后在其中选择 `v8.json` 文件。

## 输出示例 { #example-output }

```
Statistical profiling result from benchmarks\v8.log, (4192 ticks, 0 unaccounted, 0 excluded).

 [Shared libraries]:
   ticks  total  nonlib   name
      9    0.2%    0.0%  C:\WINDOWS\system32\ntdll.dll
      2    0.0%    0.0%  C:\WINDOWS\system32\kernel32.dll

 [JavaScript]:
   ticks  total  nonlib   name
    741   17.7%   17.7%  LazyCompile: am3 crypto.js:108
    113    2.7%    2.7%  LazyCompile: Scheduler.schedule richards.js:188
    103    2.5%    2.5%  LazyCompile: rewrite_nboyer earley-boyer.js:3604
    103    2.5%    2.5%  LazyCompile: TaskControlBlock.run richards.js:324
     96    2.3%    2.3%  Builtin: JSConstructCall
    ...

 [C++]:
   ticks  total  nonlib   name
     94    2.2%    2.2%  v8::internal::ScavengeVisitor::VisitPointers
     33    0.8%    0.8%  v8::internal::SweepSpace
     32    0.8%    0.8%  v8::internal::Heap::MigrateObject
     30    0.7%    0.7%  v8::internal::Heap::AllocateArgumentsObject
    ...


 [GC]:
   ticks  total  nonlib   name
    458   10.9%

 [Bottom up (heavy) profile]:
  Note: percentage shows a share of a particular caller in the total
  amount of its parent calls.
  Callers occupying less than 2.0% are not shown.

   ticks parent  name
    741   17.7%  LazyCompile: am3 crypto.js:108
    449   60.6%    LazyCompile: montReduce crypto.js:583
    393   87.5%      LazyCompile: montSqrTo crypto.js:603
    212   53.9%        LazyCompile: bnpExp crypto.js:621
    212  100.0%          LazyCompile: bnModPowInt crypto.js:634
    212  100.0%            LazyCompile: RSADoPublic crypto.js:1521
    181   46.1%        LazyCompile: bnModPow crypto.js:1098
    181  100.0%          LazyCompile: RSADoPrivate crypto.js:1628
    ...
```

## 分析 Web 应用程序 { #profiling-web-applications }

当今高度优化的虚拟机可以以惊人的速度运行 Web 应用程序。但是，一个人不应该仅仅依靠它们来获得出色的性能：精心优化的算法或较低开销的函数通常可以在所有浏览器上实现许多倍的速度提升。[Chrome DevTools](https://developers.google.com/web/tools/chrome-devtools/) 的 [CPU Profiler](https://developers.google.com/web/tools/chrome-devtools/evaluate-performance/reference) 可帮助你分析代码的瓶颈。但是有时候，你需要更深入、更细致：这就是 V8 的内部分析器派上用场的地方。

让我们使用该分析器检查 Microsoft 与 IE10 一起[发布](https://blogs.msdn.microsoft.com/ie/2012/11/13/ie10-fast-fluid-perfect-for-touch-and-available-now-for-windows-7/)的 [Mandelbrot explorer 演示程序](https://web.archive.org/web/20130313064141/http://ie.microsoft.com/testdrive/performance/mandelbrotexplorer/)。演示版本发布后，V8 修复了一个错误，该错误会不必要地减慢计算速度（因此，该演示博客中的 Chrome 性能不佳），并进一步优化了引擎，实现了比标准系统库提供的更快的 `exp()` 近似值。进行了这些更改之后，**该演示程序的运行速度比以前在 Chrome 中测得的快 8 倍**。

但是，如果你希望代码在所有浏览器上运行得更快呢？ 首先，你应该要**分析导致 CPU 繁忙的原因**。使用以下命令行参数运行 Chrome（Windows 和 Linux [Canary](https://tools.google.com/dlpage/chromesxs)），这将让它输出指定 URL 的分析器的 tick 信息（在 `v8.log` 文件中），在我们的示例中，是没有 web workers 的 Mandelbrot 演示程序的本地版本：

```bash
./chrome --js-flags='--prof' --no-sandbox 'http://localhost:8080/'
```

在准备测试用例时，请确保它在加载后立即开始工作，并在计算完成后关闭 Chrome（按 Alt+F4 键），以便在日志文件中仅保留你关心的 ticks。另请注意，使用此技术尚未正确配置 web workers。

然后，使用 V8（或新的实用 Web 版本）附带的 `tick-processor` 脚本处理 `v8.log` 文件：

```bash
v8/tools/linux-tick-processor v8.log
```

以下是经过处理的输出的有趣片段，应引起你的注意：

```
Statistical profiling result from null, (14306 ticks, 0 unaccounted, 0 excluded).
 [Shared libraries]:
   ticks  total  nonlib   name
   6326   44.2%    0.0%  /lib/x86_64-linux-gnu/libm-2.15.so
   3258   22.8%    0.0%  /.../chrome/src/out/Release/lib/libv8.so
   1411    9.9%    0.0%  /lib/x86_64-linux-gnu/libpthread-2.15.so
     27    0.2%    0.0%  /.../chrome/src/out/Release/lib/libwebkit.so
```

顶部显示 V8 在特定于 OS 的系统库中花费的时间比在其自己的代码中花费的时间更多。让我们通过检查 "bottom up" 的输出部分来了解其原因，在该部分中，你可以理解缩进的行是“被...所调用”（以 `*` 开头的行表示该函数已被 TurboFan 优化）：

```
[Bottom up (heavy) profile]:
  Note: percentage shows a share of a particular caller in the total
  amount of its parent calls.
  Callers occupying less than 2.0% are not shown.

   ticks parent  name
   6326   44.2%  /lib/x86_64-linux-gnu/libm-2.15.so
   6325  100.0%    LazyCompile: *exp native math.js:91
   6314   99.8%      LazyCompile: *calculateMandelbrot http://localhost:8080/Demo.js:215
```

**在系统库中执行 `exp()` 函数花费的总时间超过了44％**！为调用系统库增加了一些开销，这意味着约有三分之二的总时间花费在评估 `Math.exp()` 上。

如果你查看 JavaScript 代码，将会看到  `exp()` 仅用于生成平滑的灰度调色板。产生平滑灰度调色板的方法有很多，但让我们假设你真的很喜欢指数渐变。这是算法优化发挥作用的地方。

你会注意到，调用 `exp()` 的范围是 `-4 < x < 0`，因此我们可以用该范围的[泰勒近似值](https://en.wikipedia.org/wiki/Taylor_series)安全地替换它，从而提供相同的平滑梯度，并且只需要一次乘法和几次除法：

```
exp(x) ≈ 1 / ( 1 - x + x * x / 2) for -4 < x < 0
```

以这种方式对算法进行调整，与最新的 Canary 版本相比可将性能提高 30％，与 Chrome Canary 上基于 `Math.exp()` 的系统库相比，性能提高了 5 倍。

![](/_img/docs/profile/mandelbrot.png)

此示例说明了 V8 的内部分析器如何帮助你更深入地了解代码瓶颈，以及更智能的算法可以进一步提高性能。

要了解有关什么样的基准代表当今复杂而苛刻的 Web 应用程序的更多信息，请阅读 [V8 如何衡量实际性能](/blog/real-world-performance)。
