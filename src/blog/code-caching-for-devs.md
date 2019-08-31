---
title: "给 JavaScript 开发者的代码缓存指南"
description: '(Byte)code caching reduces the start-up time of commonly visited websites by caching the result of JavaScript parsing + compilation.'
author: "[Leszek Swirski](https://twitter.com/leszekswirski), cache smasher"
avatars:
  - leszek-swirski
date: 2019-04-08 13:33:37
tags:
  - internals
tweet: "1115264282675953664"
cn:
  author: "[不良帅帅](https://www.zhihu.com/people/leyayun)，做最不像程序员的程序员 | 公众号：FENews，文章来源 <https://zhuanlan.zhihu.com/p/62530599>"
  avatars:
    - leyayun
---

代码缓存（也被称为字节码缓存）是浏览器的一个重要优化手段。它通过缓存解析+编译后的结果来提升高频访问网站的启动速度。[大多数](https://blog.mozilla.org/javascript/2017/12/12/javascript-startup-bytecode-cache/)的主流[浏览器](https://bugs.webkit.org/show_bug.cgi?id=192782)都实现了代码缓存，Chrome 也不例外。事实上，关于 Chrome 和 V8 缓存编译后代码的实现，之前我们已经写文章（[Code caching](/blog/code-caching、[改进代码缓存](/blog/improved-code-caching)）也做过[演讲](https://www.youtube.com/watch?v=YqHOUy2rYZ8)。

在这篇文章中，我们将为那些想要更好的利用代码缓存来提高网站启动速度的 JS 开发者提供一些建议。这些建议集中在 Chrome/V8 的代码缓存实现上，但是其他大多数浏览器实现原理基本也是这样的。

## 代码缓存回顾 { #code-caching-recap }

虽然其他文章和演讲已经提供代码缓存实现的详细信息，但是我们仍然要快速回顾下它是如何工作的，对于 V8 编译后的代码 Chrome 有两级缓存：一个是由 V8（`Isolate` 缓存）维护的低成本的“尽力而为”内存缓存和一个完整序列化的硬盘缓存。

`Isolate` 缓存操作发生在同一个 V8 Isolate 中编译的脚本（即同一个进程，简单来说就是“在同一个 tab 页中导航的相同页面” ）。它是“尽力而为”，因为它试图尽可能快而小地使用已经可用的数据，以牺牲潜在的低命中率和跨进程的缓存为代价。

1. 当 V8 编译脚本时，编译后的脚本以源码为键被存储在一个 hashtable 中（在 V8 的堆中）。
1. 当 Chrome 要求 V8 变异其他脚本的时候，V8 首先检查脚本的源码是否能匹配 hashtable 中的值。如果是，则返回已经存在的字节码。

Isolate 缓存是快速且高效的，目前我们检测到在真实情况中它的命中率达到 80% 。

硬盘代码缓存是由 Chrome 管理（准确来说是由 Blink ），它填充了 `Isolate` 缓存不能在多个进程或多个 Chrome 会话间共享代码缓存的空白。它利用现有的 HTTP 资源缓存，该缓存管理从 Web 接收的缓存和过期数据。

1. 首次请求 JS 文件（即 _cold run_）时，Chrome 会下载并将其提供给 V8 进行编译。它还将文件存储在浏览器的磁盘缓存中。
1. 当第二次请求 JS 文件（即 _warm run_）时，Chrome 从浏览器缓存中获取文件并再次将其提供给 V8 进行编译。但是，这次编译的代码被序列化，并作为元数据附加到缓存的脚本文件。
1. 第三次（即 _hot run_），Chrome 从缓存中获取文件和文件的元数据，并将两者都交给 V8。V8 反序列化元数据，可以跳过编译。

综上，

<figure>
  <img src="/_img/code-caching-for-devs/overview.svg" width="487" height="280" alt="" loading="lazy">
  <figcaption>代码缓存被分为冷运行、暖运行和热运行，在内存缓存发生在暖运行，硬盘缓存发生在热运行</figcaption>
</figure>

基于这段描述，我们可以提供最好的建议来提高你的网站对代码缓存的利用。

## 提示 1：什么都不要做 { #do-nothing }

理想情况见，做为 JS 开发者为了提高代码的缓存能做的最好的事情就是“什么也不做”。这实际上有两层含义，一是被动的不做，二是主动的不做。

代码缓存终究是浏览器实现的细节。基于启发式的数据与空间的权衡性能优化，它的实现和启发式可能定期变化。做为 V8 工程师，我们会尽我们所能使启发式适用于在不断发展的 Web 中的每一个人，而且对当前代码缓存实现细节的过度的优化可能会在一些版本发布后，当这些细节改变后引起失望。另外，其他的一些 JavaScript 引擎可能使用了不同的启发式实现代码缓存。因此从各方面来说，对于使用代码缓存我们最好的建议是：书写整洁且符合习惯的代码，而且我们会尽可能的优化它。

除了被动不做什么，你应该尽可能地主动不做什么。任何形式的缓存内在都依赖于事物没有改变，因此什么都不做是允许缓存数据保持缓存的最佳方式。这儿有几个你什么都不做的方法。

### 不要改变代码 { #don’t-change-code }

这也许是显而易见的事情，但是仍然值得明确说明———当你上线一份新的代码的时候，代码还没有被缓存。当浏览器通过 HTTP 请求一个脚本 URL 的时候，它包含了上次请求 URL 的时间，如果服务器知道文件没有改变，它返回 304 Not Modified 响应，维持我们的代码缓存热运行状态。否则，返回 200 OK 响应更新缓存资源，并且清除代码缓存，恢复到冷运行状态。

<figure>
  <img src="/_img/code-caching-for-devs/http-200-vs-304.jpg" width="600" height="515" alt="" title="Drake 更加喜欢 HTTP 响应状态码为 304，而不是 HTTP 200" loading="lazy">
</figure>

它总是立即推送你最新的代码更改，特使是如果你想要衡量某次更改的影响的时候，但是对于缓存来说，最好是保留代码或尽可能地减少更新。可以考虑限制每周的上限次数 `≤ x`，`x` 是你调整权衡缓存与陈旧性的滑块。

### 不要改变 URL { #don’t-change-urls }

代码缓存与脚本的 URL 存在关联，这是为了便于检查而无需查看实际的脚本内容。这意味着改变脚本的 URL（包括改变请求查询参数） 会在我们的缓存资源中创建一个新的资源入口，并伴随着一个冷缓存入口。

当然，这可以被用来强制清除缓存，尽管那也是一个实现细节。也许有一天我们会使用源文件内容关联缓存而不是源文件的 URL，那么这个建议将不在有效。

### 不要改变代码执行行为 { #don’t-change-execution-behavior }

对代码缓存实现的最新优化之一是[仅在编译后的代码执行后对其进行序列化](/blog/improved-code-caching#increasing-the-amount-of-code-that-is-cached)。 这是为了尝试捕获延迟编译的函数，这些函数仅在执行期间编译，而不是在初始编译期间编译。

当每次执行脚本执行相同的代码或至少相同的函数时，这个优化最有效。 如果你进行 A/B 测试，且测试取决于运行时决策，这样做可能会有问题：

```js
if (Math.random() > 0.5) {
  A();
} else {
  B();
}
```

在这个例子中，仅 `A()` 或 `B()` 被编译或执行在热运行时，并进入到代码缓存，另外一个可能会在后续的代码运行中被执行。相反，保持运行时的确定性，以保持其在缓存路径上。

## 提示 2: 做一些事情 { #do-something }

当然无论是被动还是主动“什么都不做”的建议都不能让人满意。因此除了“什么都不做”，鉴于我们目前的启发式和实现，你可以做一些事情。请记住，启发式和建议都可能改变，且没有一个代替分析。

<figure>
  <img src="/_img/code-caching-for-devs/with-great-power.jpg" width="500" height="209" alt="" title="Uncle Ben suggests that Peter Parker should be cautious when optimizing his web app’s cache behavior." loading="lazy">
</figure>

### 将库从使用代码中分离 { #split }

代码缓存粗略的在每个脚本上完成，意味着脚本的每一部分改动都会导致整个脚本的缓存失效。如果你将稳定的部分和经常变动的部分放在一个脚本文件中，例如：库和业务逻辑，业务逻辑代码的改变会使库代码的缓存也无效。

因此，你可以分离稳定的库代码到一个单独的脚本，且单独的加载它。这样库代码一旦被缓存，并在业务逻辑代码改变的时候保持缓存。

如果你的库在你网站的不同的页面被共享，这样做还有其他的收益：由于代码缓存附加到脚本，因此库的代码换在也在页面之间共享。

### 合并库文件到使用它们的代码中 { #merge }

代码缓存在每个脚本执行后完成，意味着一个脚本的代码缓存包含了当脚本执行完编译后的那些函数。这对库代码有几个重要意义：

1. 代码缓存不包含早期脚本中的函数。
1. 代码缓存不包含后续脚本调用的延迟编译的函数。

特别是，如果一个库完全由延迟编译的函数组成，那么即使稍后使用他们也不会缓存这些函数。

对此一个解决方案是合并库和使用它们的代码到单个脚本中，以至于代码缓存可以“发现”库的那些部分被使用。不幸的是，这与上一条建议相违背，因为没有银弹。通常来说，我们不建议将所有 JS 脚本合并到一个大的 bundle 中，将其分成多个较小脚本往往更有利于除代码缓存之外的其他原因（如：多个网络请求、流编译、页面交互等）。

### 利用启发式 IIFE { #iife }

只有在代码执行完成时编译的代码才会被加入到代码缓存，因此有许多类型的函数尽管稍后执行，但不会被缓存。事件处理程序（甚至是 `onload`）、promise 链、未使用的库函数和其他一些延迟编译而没有在执行到 `</script>` 之前被调用的，都会保持延迟而不会被执行。

一种方法强制这些函数被缓存就是强制它们被编译，且一个常用的强制编译方法是使用 IIFE 启发式。IIFE（立即执行函数表达式）是一种创建函数后立即点用函数的模式。

```js
(function foo() {
  // …
})();
```

因为 IIFE 表达式会被立即调用，为了避免支付延迟编译的成本，大多数 JavaScript 引擎会尝试探测它们并立即编译，然后进行完全编译。有各种启发式可以尽早探测出 IIFE 表达式（在函数被解析之前），最常用的是通过 `function` 关键字之前的 `(`。

因为这个启发式在早期被应用，所以即使函数实际不是立即执行也会被编译：

```js
const foo = function() {
  // Lazily skipped
};
const bar = function() {
  // Eagerly compiled
};
```

这意味着可以通过将那些应该被缓存的函数包裹在括号里强制加入到缓存中。但是，如果不正确的使用，可能会对网页启动时间产生影响，通常来说这有点滥用启发式，因此除非真的有必要，我们不建议这么做。

### 合并小文件 { #group }

Chrome 有个代码缓存的最小文件大小限制，现在是 [1 Kib](https://cs.chromium.org/chromium/src/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc?l=91&rcl=2f81d000fdb5331121cba7ff81dfaaec25b520a5) 。这意味着小于 1 Kib 的脚本不能被缓存，因为我们认为开销大于收益。

如果你的网站有很多小的脚本，则开销计算可能不在以相同的方式进行。你应该考虑合并小文件使它们超出最小代码大小，并从常规的减少脚本开销的方式受益。

### 避免使用内联脚本 { #avoid-inline-scripts }

HTML 中的内联脚本没有关联外部的源文件，因此不能被上述机制缓存。Chrome 尝试通过将它们附加 HTML 文档资源缓存，但是这些缓存依赖于**整个** HTML 文档没有变化，且不能在页面间共享。

因此，对于可以从代码缓存中受益的脚本，请避免将它们内联到 HTML 中，而是推荐将它们包含在外部文件中。

### 使用 service worker 缓存 { #use-service-worker-caches }

service worker 是一种让你的代码可以拦截你页面中的网络资源请求的一种机制。特别是，它们可以让你构建本地资源缓存，当你发送请求的时候，会从本地缓存提供资源。如果你想构建离线应用这点特别有用，例如：PWA 应用。

一个典型的栗子，网站使用 service worker 在主脚本中注册 service worker：

```js
// main.mjs
navigator.serviceWorker.register("/sw.js");
```

service worker 为安装（创建资源）和获取（从潜在的缓存提供资源）事件添加处理程序。

```js
// sw.js
self.addEventListener("install", event => {
  async function buildCache() {
    const cache = await caches.open(cacheName);
    return cache.addAll(["/main.css", "/main.mjs", "/offline.html"]);
  }
  event.waitUntil(buildCache());
});

self.addEventListener("fetch", event => {
  async function cachedFetch(event) {
    const cache = await caches.open(cacheName);
    let response = await cache.match(event.request);
    if (response) return response;
    response = await fetch(event.request);
    cache.put(event.request, response.clone());
    return response;
  }
  event.respondWith(cachedFetch(event));
});
```

这些缓存包括 JS 资源缓存。然而，因为我们希望 service worker 的缓存主要用于 PWA，所以它与 Chrome 的“自动”缓存的启发式有略微不同。首先，当 JS 资源被添加到缓存的时候，它们立即创建代码缓存，这意味着在第二次加载的时候代码缓存是可用的（而不是像普通缓存一样仅在第三次加载的时可用）。其次，我们为这些脚本生成了“全量”代码缓存，不在有延迟编译，而是全部编译好放到缓存中。这具有快速且可预测的性能的优点，没有执行顺序依赖性，但是以增加的内存使用为代价。请注意，此启发式仅适用于 service worker 缓存，而不适用于 `Cache` API 的其他用途。实际上，当在 service worker 外面使用时，现在的 `Cache` API 不会执行代码缓存。

## Tracing { #tracing }

上面的那些建议都不能保证提升你 web 应用的速度。不幸的是，代码缓存信息现在还没有暴露到 Devtool 中，因此最可靠的方式去查看你 web 应用的脚本缓存是使用 `chrome://tracing`。

`chrome://tracing` 记录了一段时间内的 Chrome 追踪信息，它生成的追踪结果可视化如下：

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-visualization.png" srcset="/_img/code-caching-for-devs/chrome-tracing-visualization@2x.png 2x" width="722" height="672" alt="" loading="lazy">
  <figcaption><code>chrome://tracing</code> UI 记录了一次 warm cache 执行情况</figcaption>
</figure>

Tracing 记录着整个浏览器的行为，包含其他 tab、窗口和扩展程序，因此最好在干净的用户配置——没有其他扩展程序安装且没有其他 tab 页打开的时候，完成分析：

```bash
# 开始一次干净的用户配置的 Chrome 浏览会话
google-chrome --user-data-dir="$(mktemp -d)" --disable-extensions
```

当收集追踪信息时，你需要选中追踪类别。在大多数情况下，你可以简单的选中 "web developer" 这个类别，但你也可以手动选择类别。代码追踪的重要类别是 `v8`。

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-categories-1.png" srcset="/_img/code-caching-for-devs/chrome-tracing-categories-1@2x.png 2x" width="721" height="607" alt="" loading="lazy">
</figure>

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-categories-2.png" srcset="/_img/code-caching-for-devs/chrome-tracing-categories-2@2x.png 2x" width="721" height="607" alt="" loading="lazy">
</figure>

当记录了一次 `v8` 类别的追踪时，在追踪结果中查看 `v8.compile` 片段（或者你可以都搜索框中输入 `v8.compile`）。它会列出编译后的文件，已经编译的元数据。

在脚本 cold run 时，是没有代码缓存是信息的，这就意味着脚本不参与生成或使用缓存数据。

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-cold-run.png" srcset="/_img/code-caching-for-devs/chrome-tracing-cold-run@2x.png 2x" width="405" height="318" alt="" loading="lazy">
</figure>

在 warm run 时，每个脚本有两个 `v8.compile` 入口：一个是实际编译，另一个（在执行后）是为了产生缓存。你可以通过它是否有 `cacheProduceOptions` 和 `producedCacheSize` 两个元数据字段来判断。

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-warm-run.png" srcset="/_img/code-caching-for-devs/chrome-tracing-warm-run@2x.png 2x" width="404" height="386" alt="" loading="lazy">
</figure>

在 hot run 时，你将看到一个用于消费缓存的 `v8.compile` 入口，有 `cacheConsumeOptions` 和 `consumedCacheSize` 两个元数据字段。所有大小都以字节表示。

<figure>
  <img src="/_img/code-caching-for-devs/chrome-tracing-hot-run.png" srcset="/_img/code-caching-for-devs/chrome-tracing-hot-run@2x.png 2x" width="406" height="363" alt="" loading="lazy">
</figure>

## 总结 { #conclusion }

对于大多数开发人员来说，代码缓存应该“正常工作”。当事物保持不变时，它就像任何缓存一样工作得最好，并且它工作在不同版本可以发生变化的启发式方法上。 尽管如此，代码缓存确实具有可以使用的行为，可以避免的限制以及使用 `chrome://tracing` 的仔细分析可以帮助你调整和优化 Web 应用程序对缓存的使用。
