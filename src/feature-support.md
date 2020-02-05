---
title: 'Feature support'
permalink: /features/support/
layout: layouts/base.njk
description: 'This document explains the JavaScript and WebAssembly language feature support listings as used on the V8 website.'
---
# JavaScript/Wasm feature support

[我们的 JavaScript 和 WebAssembly 语言新特性解释](/features)经常会包含一个特性支持的列表，如下所示：

<feature-support chrome="71"
                 firefox="65"
                 safari="12"
                 nodejs="12"
                 babel="yes"></feature-support>

如果不支持任何新特性，大概是这样的：

<feature-support chrome="no"
                 firefox="no"
                 safari="no"
                 nodejs="no"
                 babel="no"></feature-support>

对于非常新的特性，一般是不同环境有不同的支持度，想这样：

<feature-support chrome="partial"
                 firefox="yes"
                 safari="yes"
                 nodejs="no"
                 babel="yes"></feature-support>

我们的目标是提供一个特性成熟度的快速概述，不仅仅包含 V8 和 Chrome，同时也包含更广泛的 JavaScript 生态系统。请注意，这不仅限于主动开发的 JavaScript VM（如 V8）中的本机实现，还包括工具支持，使用此处的 [Babel](https://babeljs.io/) 图标表示。

Babel 条目涵盖了各种含义：

- 对于诸如 [class fields](/features/class-fields) 之类的语法特性，它指的是转换支持（transpilation）。
- 对于新 API 等语言功能 [`Promise.allSettled`](/features/promise-combinators#promise.allsettled)，它指的是 polyfill 支持。（Babel 通过 [core-js](https://github.com/zloirock/core-js) 项目提供 polyfill。）

Chrome 图标代表 V8、Chromium 和任何基于 Chromium 的浏览器。
