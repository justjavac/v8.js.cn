---
title: 'TurboFan'
description: '本文档收集有关 V8 优化编译器 TurboFan 的资源。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
TurboFan 是 V8 的优化编译器之一，它利用了一个称为[“节点之海”](https://darksi.de/d.sea-of-nodes/)的概念。V8 的一篇博客文章提供了 [TurboFan的高级概述](/blog/turbofan-jit)。可以在以下资源中找到更多详细信息。

## 文章与博客 {#articles-and-blog-posts}

- [TurboFan 的故事](https://benediktmeurer.de/2017/03/01/v8-behind-the-scenes-february-edition)
- [Ignition + TurboFan 以及 ES2015](https://benediktmeurer.de/2016/11/25/v8-behind-the-scenes-november-edition)
- [V8 中推测优化机制的介绍](https://ponyfoo.com/articles/an-introduction-to-speculative-optimization-in-v8)

## 会谈 {#talks}

- [CodeStubAssembler: Redux](https://docs.google.com/presentation/d/1u6bsgRBqyVY3RddMfF1ZaJ1hWmqHZiVMuPRw_iKpHlY)
- [TurboFan 编译器概述](https://docs.google.com/presentation/d/1H1lLsbclvzyOF3IUR05ZUaZcqDxo7_-8f4yJoxdMooU/edit)
- [TurboFan IR](https://docs.google.com/presentation/d/1Z9iIHojKDrXvZ27gRX51UxHD-bKf1QcPzSijntpMJBM)
- [TurboFan’s JIT 设计](https://docs.google.com/presentation/d/1sOEF4MlF7LeO7uq-uThJSulJlTh--wgLeaVibsbb3tc)
- [动态语言的快速算法](https://docs.google.com/a/google.com/presentation/d/1wZVIqJMODGFYggueQySdiA3tUYuHNMcyp_PndgXsO1Y)
- [V8 中的反优化](https://docs.google.com/presentation/d/1Z6oCocRASCfTqGq1GCo1jbULDGS-w-nzxkbVF7Up0u0)
- [TurboFan: V8 新的代码生成架构](https://docs.google.com/presentation/d/1_eLlVzcj94_G4r9j9d_Lj5HRKFnq6jgpuPJtnmIBs88) ([视频](https://www.youtube.com/watch?v=M1FBosB5tjM))
- [惰性优化的实习经历](https://docs.google.com/presentation/d/1AVu1wiz6Deyz1MDlhzOWZDRn6g_iFkcqsGce1F23i-M) (+ [博客文章](/blog/lazy-unlinking))

## 设计文档 {#design-documents}

这些主要是与 TurboFan 内部设计有关的文档。

- [函数上下文 specialization](https://docs.google.com/document/d/1CJbBtqzKmQxM1Mo4xU0ENA7KXqb1YzI6HQU8qESZ9Ic)
- [剩余（rest）参数和 arguments 特殊（exotic）对象优化计划](https://docs.google.com/document/d/1DvDx3Xursn1ViV5k4rT4KB8HBfBb2GdUy3wzNfJWcKM)
- [TurboFan 开发人员工具集成](https://docs.google.com/document/d/1zl0IA7dbPffvPPkaCmLVPttq4BYIfAe2Qy8sapkYgRE)
- [TurboFan 内联](https://docs.google.com/document/d/1l-oZOW3uU4kSAHccaMuUMl_RCwuQC526s0hcNVeAM1E)
- [TurboFan 内联启发法](https://docs.google.com/document/d/1VoYBhpDhJC4VlqMXCKvae-8IGuheBGxy32EOgC2LnT8)
- [TurboFan 冗余的边界和范围检查消除设计](https://docs.google.com/document/d/1R7-BIUnIKFzqki0jR4SfEZb3XmLafa04DLDrqhxgZ9U)
- [没有补丁代码的惰性反优化](https://docs.google.com/document/d/1ELgd71B6iBaU6UmZ_lvwxf_OrYYnv0e4nuzZpK05-pg)
- [寄存器分配器](https://docs.google.com/document/d/1aeUugkWCF1biPB4tTZ2KT3mmRSDV785yWZhwzlJe5xY)
- [TurboFan 中的投影（Projection）节点](https://docs.google.com/document/d/1C9P8T98P1T_r2ymuUFz2jFWLUL7gbb6FnAaRjabuOMY/edit)

## 相关设计文档 {#related-design-documents}

这些设计文档也对 TurboFan 产生了重大影响。

- [计算属性名称的（重新）设计文档](https://docs.google.com/document/d/1eH1R6_C3lRrLtXKw0jNqAsqJ3cBecrqqvfRzLpfq7VE)
- [ES2015 及以后的性能改善计划](https://docs.google.com/document/d/1EA9EbfnydAmmU_lM8R_uEMQ-U_v4l9zulePSBkeYWmY)
- [迭代器内置插件设计文档](https://docs.google.com/document/d/13z1fvRVpe_oEroplXEEX0a3WK94fhXorHjcOMsDmR-8)
- [让 ES2015 中的类更快](https://docs.google.com/document/d/1iCdbXuGVV8BK750wmP32eF4sCrnZ8y3Qlz0JiaLh9j8)
- [RegExp 内置插件（重新）设计文档](https://docs.google.com/document/d/1MuqFjsfaRPL2ZqzVoeMRqtcAmcJSwmHljTbRIctVVUk)
- [扩展（Spread）操作调用性能](https://docs.google.com/document/d/1DWPizOSKqHhSJ7bdEI0HIVnner84xToEKUYqgXm3g30)
