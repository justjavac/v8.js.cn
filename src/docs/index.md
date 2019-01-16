---
title: 'Documentation'
cn:
  author: 'who who who ([@fsx950223](https://github.com/fsx950223))，good at javascript'
---
V8 是 Google 基于 C++ 编写的开源高性能 Javascript 与 WebAssembly 引擎。用于 Chrome 以及 Node.js 等。

本文档面向希望在其应用程序中使用 V8 的 C++ 开发人员，以及任何对 V8 设计和性能感兴趣的人。本文档向您介绍 V8，其余文档向您展示如何在代码中使用 V8 并描述一些设计细节，以及提供一组用于测量 V8 性能的 JavaScript 基准测试。

## 关于 V8 {#about-v8}

V8 实现了 <a href="https://tc39.github.io/ecma262/">ECMAScript</a> 与 <a href="https://webassembly.github.io/spec/core/">WebAssembly</a>，能够运行在 Windows 7+、macOS 10.12+ 以及使用 x64、IA-32、ARM、MIPS 处理器的 Linux 系统。V8 能独立运行，也能嵌入到任何 C++ 应用当中。

V8 编译并执行 JavaScript 源代码，处理对象的内存分配，垃圾回收不再使用的对象。高效的垃圾收集器是 V8 高性能的关键之一。

JavaScript 通常用于编写浏览器中的客户端脚本，例如用于操作文档对象模型（DOM）对象。但是，DOM 通常不是由 JavaScript 引擎提供，而是由浏览器提供。V8 也是如此 - Google Chrome 提供了 DOM。但是，V8 提供了 ECMA 标准中规定的所有数据类型，运算符，对象和函数。

V8 允许 C++ 应用程序将自己的对象和函数公开给 JavaScript 代码。由您来决定要向 JavaScript 公开的对象和函数。

## 文档概览 {#documentation-overview}

- [由源码构建 V8](/docs/build)
    - [Checking out the V8 source code](/docs/source-code)
    - [Building with GN](/docs/build-gn)
    - [Cross-compiling and debugging for ARM/Android](/docs/cross-compile-arm)
    - [GUI and IDE setup](/docs/ide-setup)
- [Contributing](/docs/contribute)
    - [V8’s public API and its stability](/docs/api)
    - [Becoming a V8 committer](/docs/become-committer)
    - [Committer’s responsibility](/docs/committer-responsibility)
    - [Blink web tests (a.k.a. layout tests)](/docs/blink-layout-tests)
    - [Evaluating code coverage](/docs/evaluate-code-coverage)
    - [Release process](/docs/release-process)
    - [Feature launch process](/docs/feature-launch-process)
    - [Flake bisect](/docs/flake-bisect)
    - [Handling of ports](/docs/ports)
    - [Merging & patching](/docs/merge-patch)
    - [Node.js integration build](/docs/node-integration)
    - [Reporting security bugs](/docs/security-bugs)
    - [Running benchmarks locally](/docs/benchmarks)
    - [Testing](/docs/test)
    - [Triaging issues](/docs/triage-issues)
- Debugging
    - [ARM debugging with the simulator](/docs/debug-arm)
    - [Cross-compiling and debugging for ARM/Android](/docs/cross-compile-arm)
    - [Debugging builtins with GDB](/docs/gdb)
    - [Debugging over the V8 Inspector Protocol](/docs/inspector)
    - [GDB JIT Compilation Interface integration](/docs/gdb-jit)
    - [Investigating memory leaks](/docs/memory-leaks)
    - [Stack trace API](/docs/stack-trace-api)
    - [Using D8](/docs/d8)
- Embedding V8
    - [Guide to embedding V8](/docs/embed)
    - [Version numbers](/docs/version-numbers)
    - [Built-in functions](/docs/builtin-functions)
    - [i18n support](/docs/i18n)
    - [Untrusted code mitigations](/docs/untrusted-code-mitigations)
- Under the hood
    - [Ignition](/docs/ignition)
    - [TurboFan](/docs/turbofan)
    - [Torque user manual](/docs/torque)
    - [Writing Torque built-ins](/docs/torque-builtins)
    - [Writing CSA built-ins](/docs/csa-builtins)
- Writing optimizable JavaScript
    - [Using V8’s sample-based profiler](/docs/profile)
    - [Profiling Chromium with V8](/docs/profile-chromium)
    - [Using Linux `perf` with V8](/docs/linux-perf)
    - [Tracing V8](/docs/trace)
