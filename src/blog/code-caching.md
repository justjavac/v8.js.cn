---
title: '代码缓存'
author: 'Yang Guo ([@hashseed](https://twitter.com/hashseed)), Software Engineer'
avatars:
  - 'yang-guo'
date: 2015-07-27 13:33:37
tags:
  - internals
description: 'V8 现在支持（字节）代码缓存，即缓存 JavaScript 解析+编译的结果。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 使用[即时编译](https://en.wikipedia.org/wiki/Just-in-time_compilation)（JIT）来执行 JavaScript 代码。这意味着在运行脚本之前，必须先对其进行解析和编译，这可能会导致相当大的开销。正如我们[最近宣布](https://blog.chromium.org/2015/03/new-javascript-techniques-for-rapid.html)的那样，代码缓存（code caching）是一种减少这种开销的技术。首次编译脚本时，将生成并存储缓存数据。下次 V8 需要编译相同的脚本时，即使在不同的 V8 实例中，它也可以使用缓存数据来重新创建编译结果，而不是从头开始编译。结果，脚本执行得更快。

从 V8 4.2 版开始，就可以使用代码缓存，而不仅限于 Chrome。它通过 V8 的 API 公开，因此每个 V8 嵌入程序都可以利用它。用于测试此功能的[测试用例](https://chromium.googlesource.com/v8/v8.git/+/4.5.56/test/cctest/test-api.cc#21090)用作如何使用此 API 的示例。

当 V8 编译脚本时，可以通过传递 `v8::ScriptCompiler::kProduceCodeCache` 作为选项来生成缓存数据，以加快以后的编译速度。如果编译成功，则缓存数据将附加到源对象，并且可以通过 `v8::ScriptCompiler::Source::GetCachedData` 进行检索。然后可以将其持久化，以备以后使用，例如，将其写入磁盘。

在以后的编译期间，可以将先前生成的缓存数据附加到源对象，并作为选项传递 `v8::ScriptCompiler::kConsumeCodeCache`。这次，由于 V8 绕过了编译代码并从提供的缓存数据中反序列化代码，因此代码的生成速度将大大提高。

生产缓存数据需要一定的计算和内存成本。因此，Chrome 仅在两天内至少两次看到相同脚本时才会生成缓存数据。通过这种方式，Chrome 可以平均将脚本文件转换为可执行代码的速度提高两倍，从而节省了用户在每次后续页面加载时的宝贵时间。
