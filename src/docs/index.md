---
title: 'Documentation'
cn:
  author: 'who who who ([@fsx950223](https://github.com/fsx950223))，good at javascript'
---
V8 是 Google 基于 C++ 编写的开源高性能 Javascript 与 WebAssembly 引擎。用于 Google Chrome（Google 的开源浏览器） 以及 Node.js 等。

本文档面向希望在其应用程序中使用 V8 的 C++ 开发人员，以及任何对 V8 设计和性能感兴趣的人。本文档向您介绍 V8，其余文档向您展示如何在代码中使用 V8 并描述一些设计细节，以及提供一组用于测量 V8 性能的 JavaScript 基准测试。

## 关于 V8 {#about-v8}

V8 实现了 <a href="https://tc39.github.io/ecma262/">ECMAScript</a> 与 <a href="https://webassembly.github.io/spec/core/">WebAssembly</a>，能够运行在 Windows 7+、macOS 10.12+ 以及使用 x64、IA-32、ARM、MIPS 处理器的 Linux 系统。V8 能独立运行，也能嵌入到任何 C++ 应用当中。

V8 编译并执行 JavaScript 源代码，处理对象的内存分配，垃圾回收不再使用的对象。高效的垃圾收集器是 V8 高性能的关键之一。

JavaScript 通常用于编写浏览器中的客户端脚本，例如用于操作文档对象模型（DOM）对象。但是，DOM 通常不是由 JavaScript 引擎提供，而是由浏览器提供。V8 也是如此 - Google Chrome 提供了 DOM。但是，V8 提供了 ECMA 标准中规定的所有数据类型，运算符，对象和函数。

V8 允许 C++ 应用程序将自己的对象和函数公开给 JavaScript 代码。由您来决定要向 JavaScript 公开的对象和函数。

## 文档概览 {#documentation-overview}

- [构建 V8 源码](/docs/build)
    - [检出 V8 源码](/docs/source-code)
    - [使用 GN 构建](/docs/build-gn)
    - [ARM 跨平台编译](/docs/cross-compile-arm)
    - [GUI and IDE setup](/docs/ide-setup)
- [贡献](/docs/contribute)
    - [V8 的公共 API 与稳定性](/docs/api)
    - [成为 V8 提交者](/docs/become-committer)
    - [提交者职责](/docs/committer-responsibility)
    - [Blink 布局测试](/docs/blink-layout-tests)
    - [评估代码覆盖率](/docs/evaluate-code-coverage)
    - [发布过程](/docs/release-process)
    - [功能启动过程](/docs/feature-launch-process)
    - [片状平分](/docs/flake-bisect)
    - [处理端口](/docs/ports)
    - [合并与派发](/docs/merge-patch)
    - [Node.js 集成构建](/docs/node-integration)
    - [报告安全 bugs](/docs/security-bugs)
    - [测试](/docs/test)
    - [分类问题](/docs/triage-issues)
- 调试
    - [ARM 调试](/docs/debug-arm)
    - [使用 GDB 调试内置函数](/docs/gdb)
    - [通过 V8 Inspector 协议调试](/docs/inspector)
    - [GDB JIT 编译接口集成](/docs/gdb-jit)
    - [调查内存泄漏](/docs/memory-leaks)
    - [栈追踪 API](/docs/stack-trace-api)
    - [使用 D8](/docs/d8)
- 嵌入 V8
    - [嵌入 V8 向导](/docs/embed)
    - [版本号](/docs/version-numbers)
    - [内建函数](/docs/builtin-functions)
    - [i18n 支持](/docs/i18n)
    - [不受信任的代码缓解](/docs/untrusted-code-mitigations)
- 引擎之下
    - [Ignition](/docs/ignition)
    - [TurboFan](/docs/turbofan)
    - [Torque](/docs/torque)
    - [CodeStubAssembler 内置插件](/docs/csa-builtins)
- 优化 JavaScript
    - [使用 V8 基本示例分析](/docs/profile)
    - [分析 Chromium](/docs/profile-chromium)
    - [使用 Linux `perf`](/docs/linux-perf)
    - [追踪 V8](/docs/trace)
