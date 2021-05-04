---
title: '追踪 V8'
description: '本文档说明了如何利用 V8 的内置追踪支持。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 提供了对追踪（tracing）的支持。[通过 Chrome 追踪系统将 V8 嵌入 Chrome 时，它会自动运行。](/docs/rcs)但是，你也可以在任何独立的 V8 或使用默认平台的嵌入程序中启用它。可以在[此处](https://github.com/catapult-project/catapult/blob/master/tracing/README.md)找到有关追踪查看器（trace-viewer）的更多详细信息。

## 在 `d8` 中追踪 { #tracing-in-d8 }

要开始跟踪，请使用 `--enable-tracing` 选项。V8 会生成一个 `v8_trace.json`，你可以在 Chrome 中打开它。要在Chrome中打开它，请转到 `chrome://tracing`，点击“加载”（Load），然后加载 `v8-trace.json` 文件。

每个追踪事件都与一组类别相关联，你可以根据其类别来启用/禁用追踪事件的记录。仅使用上述标志，我们仅启用默认类别（一组开销较低的类别）。要启用更多类别并更好地控制不同的参数，你需要传递一个配置文件。

这是一个配置文件 `traceconfig.json` 的示例：

```json
{
  "record_mode": "record-continuously",
  "included_categories": ["v8", "disabled-by-default-v8.runtime_stats"]
}
```

使用 traceconfig 文件追踪调用 `d8` 的示例：
An example of calling `d8` with tracing and a traceconfig file:

```bash
d8 --enable-tracing --trace-config=traceconfig.json
```

追踪配置格式与 Chrome 追踪中的一种兼容，但是，我们不支持包含类别列表中的正则表达式，并且 V8 不需要排除类别列表，因此 V8 的追踪配置文件可以在 Chrome 追踪中重复使用 ，但是如果跟踪配置文件包含正则表达式，则无法在 V8 追踪中重用 Chrome 追踪配置文件，此外，V8 会忽略排除的类别列表。

## 在追踪中启用运行时调用统计信息（Runtime Call Statistics） { #enabling-runtime-call-statistics-in-tracing }

要获取运行时调用统计（<abbr>Runtime Call Statistics, RCS</abbr>），请在启用以下两个类别的情况下记录跟踪：`v8` 和 `disabled-by-default-v8.runtime_stats`。每个顶级 V8 追踪事件都包含该事件期间的运行时统计信息。通过在 `trace-viewer` 中选择这些事件中的任何一个，运行时状态表将显示在下部面板中。选择多个事件将创建一个合并视图。

![](/_img/docs/trace/runtime-stats.png)

## 在追踪中启用 GC 对象统计信息（GC Object Statistics） { #enabling-gc-object-statistics-in-tracing }

要在追踪中获取 GC 对象统计信息（GC Object Statistics），你需要收集启用了 `disabled-by-default-v8.gc_stats` 类别的追踪信息，还需要使用以下 `--js-flags`：

```
--track_gc_object_stats --noincremental-marking
```

在 `trace-viewer` 中加载追踪信息后，搜索名为：`V8.GC_Object_Stats` 的片段。统计信息显示在下部面板中。选择多个片段将创建一个合并视图。

![](/_img/docs/trace/gc-stats.png)
