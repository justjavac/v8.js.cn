---
title: 'Ignition'
description: '本文档收集有关 V8 解释器 Ignition 的资源。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 具有一个称为 "Ignition" 的解释器。Ignition 是使用 [TurboFan](/docs/turbofan) 的后端编写的基于寄存器的快速底层解释器。V8 博客文章对 Ignition 解释器做了 [高级概述](/blog/ignition-interpreter) 的介绍。可以在以下资源中找到更多详细信息：

## 会谈 {#talks}

- [V8: 连接 Ignition 与 Turbofan](https://docs.google.com/presentation/d/1chhN90uB8yPaIhx_h2M3lPyxPgdPmkADqSNAoXYQiVE/edit)
- [Ignition: 快速启动的 V8 解释器](https://docs.google.com/presentation/d/1HgDDXBYqCJNasBKBDf9szap1j4q4wnSHhOYpaNy5mHU/edit#slide=id.g1357e6d1a4_0_58)
- [Ignition:  V8 解释器](https://docs.google.com/presentation/d/1OqjVqRhtwlKeKfvMdX6HaCIu9wpZsrzqpIVIwQSuiXQ/edit) ([video](https://youtu.be/r5OWCtuKiAk))

## 文章 {#articles}

- [了解 V8 的字节码](https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775)

## 设计文档 {#design-docs}

- [Ignition 设计文档](https://docs.google.com/document/d/11T2CRex9hXxoJwbYqVQ32yIPMh0uouUZLdyrtmMoL44/edit?ts=56f27d9d#heading=h.6jz9dj3bnr8t)
- [寄存器等效性优化](https://docs.google.com/document/d/1wW_VkkIwhAAgAxLYM0wvoTEkq8XykibDIikGpWH7l1I/edit?ts=570d7131#heading=h.6jz9dj3bnr8t)
