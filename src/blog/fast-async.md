---
title: '更快的异步函数和 Promise'
author: 'Maya Lekova ([@MayaLekova](https://twitter.com/MayaLekova)), always-awaiting anticipator, and Benedikt Meurer ([@bmeurer](https://twitter.com/bmeurer)), professional performance promiser'
avatars:
  - 'maya-lekova'
  - 'benedikt-meurer'
date: 2018-11-12 16:45:07
tags:
  - ECMAScript
  - benchmarks
  - presentations
description: '更快的、更容易调试的 async 异步函数和 Promise 即将随 V8 v7.2 / Chrome 72 发布'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
JavaScript 中的异步处理历来因其不是特别快而闻名（:p）。更糟糕的是，调试实时 JavaScript 应用程序 - 例如 Node.js 服务器 - 并非易事，尤其是涉及到异步编程时更甚。幸运的是，现在有了一个重大的改变。本文探讨了我们如何在 V8（甚至其它 JavaScript 引擎中）中优化异步函数和 promise，并描述了我们如何改进异步代码的调试体验。

**注**：如果您更喜欢观看演示文稿，请欣赏下面的视频！如果没有，请跳过视频并继续阅读。

<figure>
  <iframe src="https://www.youtube.com/embed/DFP5DKDQfOc" width="640" height="360"></iframe>
</figure>

## 一种新的异步编程方法 {#a-new-approach-to-async-programming}

### 从回调到 Promise 到异步函数 {#from-callbacks-to-promises-to-async-functions}

在 promise 被加入到 JavaScript 语言之前，异步代码一般使用基于回调的 API，尤其是在 Node.js 中。这是一个例子：

```js
function handler(done) {
  validateParams((error) => {
    if (error) return done(error);
    dbQuery((error, dbResults) => {
      if (error) return done(error);
      serviceCall(dbResults, (error, serviceResults) => {
        console.log(result);
        done(error, serviceResults);
      });
    });
  });
}
```

当嵌套回调变的越来越深以后，我们称这种模式为“回调地狱”，因为它使代码不易读取且难以维护。

幸运的是，现在 promise 成了 JavaScript 语言的一部分，相同的代码可以以更优雅和可维护的方式编写：

```js
function handler() {
  return validateParams()
    .then(dbQuery)
    .then(serviceCall)
    .then(result => {
      console.log(result);
      return result;
    });
}
```

最近，JavaScript 开始支持了 [异步函数](https://developers.google.com/web/fundamentals/primers/async-functions)。现在可以用与同步代码非常相似的方式编写上述异步代码：

```js
async function handler() {
  await validateParams();
  const dbResults = await dbQuery();
  const results = await serviceCall(dbResults);
  console.log(results);
  return results;
}
```

使用异步函数，代码变得更加简洁，并且数据流更容易控制，尽管执行仍然是异步的。（请注意，JavaScript 执行仍然发生在一个线程中，这意味着异步函数本身不会创建真实的物理线程。）

### 从事件监听回调到异步迭代器 {#from-event-listener-callbacks-to-async-iteration}

另一个在 Node.js 中特别常见的异步范例是 [`ReadableStream`](https://nodejs.org/api/stream.html#stream_readable_streams)。这是一个例子：

```js
const http = require('http');

http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    res.write(body);
    res.end();
  });
}).listen(1337);
```

这段代码有点难以理解：传入的数据只能在回调函数中以 chunks 的方式处理，并且流的结束信号也在回调函数内发生。如果你没有意识到函数其实已经立即终止了，并且必须在回调函数中进行实际处理，那么很容易在这里引入错误。

幸运的是，一个很酷的新的 ES2018 特性[异步迭代器 async iteration](http://2ality.com/2016/10/asynchronous-iteration.html) 可以简化此代码：

```js
const http = require('http');

http.createServer(async (req, res) => {
  try {
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
    }
    res.write(body);
    res.end();
  } catch {
    res.statusCode = 500;
    res.end();
  }
}).listen(1337);
```

现在我们不需要将实际处理的逻辑分别放在两个不同的回调函数中 - `'data'` 和 `'end'`。我们可以把这些都写成一个单一的异步函数来处理，并使用新的 `for await…of` 循环来异步的遍历数据块。我们还添加了 `try-catch` 块来防止出现 'unhandledRejection' 异常[^1]。

[^1]: 感谢 [Matteo Collina](https://twitter.com/matteocollina) 为此提交的 [issue](https://github.com/mcollina/make-promises-safe/blob/master/README.md#the-unhandledrejection-problem).

现在已经可以在生产环境中使用这些新函数了！从 **Node.js 8（V8 v6.2 / Chrome 62）开始已经完全支持**异步函数，并且从 **Node.js 10（V8 v6.8 / Chrome 68）开始已经完全支持**异步迭代器和生成器！

## 异步性能改进 {#async-performance-improvements}

我们已经成功地在 V8 v5.5（Chrome 55 和 Node.js 7）和 V8 v6.8（Chrome 68 和 Node.js 10）之间显着提高了异步代码的性能。我们已经使引擎达到了一定的性能水平，以便开发者可以安全地使用这些新的编程范例，而无需担心速度。

<figure>
  <img src="/_img/fast-async/doxbee-benchmark.svg" alt="">
</figure>

上图是 [doxbee benchmark](https://github.com/v8/promise-performance-tests/blob/master/lib/doxbee-async.js)，它评估了 Promise 的性能。请注意，图表中的执行时间越低意味着性能越好。

[parallel benchmark](https://github.com/v8/promise-performance-tests/blob/master/lib/parallel-async.js) 的结果则更加强调了 [`Promise.all()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) 的性能，更令人兴奋：

<figure>
  <img src="/_img/fast-async/parallel-benchmark.svg" alt="">
</figure>

我们设法将 `Promise.all` 的性能提高了 **8** 倍。

但是，上述基准测试是跑分测试（synthetic micro-benchmarks）。V8 团队对[真实世界的实际用户代码性能](/blog/real-world-performance)更感兴趣。

<figure>
  <img src="/_img/fast-async/http-benchmarks.svg" alt="">
</figure>

上面的图表展示了一些流行的 HTTP 中间件及框架的性能，这些框架大量使用了 Promise 和 `async` 函数。请注意，此图表显示了每秒的请求数（requests/second），因此与之前的图表不同，这个图表中，柱状图越高表示越好。这些框架的性能在 Node.js 7（V8 v5.5）和 Node.js 10（V8 v6.8）之间得到了显着提升。

这些性能改进主要得益于以下三项关键成果：

- [TurboFan](/docs/turbofan)，新的优化编译器 🎉
- [Orinoco](/blog/orinoco)，新的垃圾收集器 🚛
- Node.js 8 的 bug，`await` 跳过 microticks 🐛

当我们在 [Node.js 8](https://medium.com/the-node-js-collection/node-js-8-3-0-is-now-available-shipping-with-the-ignition-turbofan-execution-pipeline-aa5875ad3367) 中[推出TurboFan](/blog/launching-ignition-and-turbofan) 时，全面提升了性能。

我们一直在研究一种新的垃圾收集器，我们称之为 Orinoco，它可以将垃圾收集工作从主线程中移除，从而显着改善了垃圾收集的请求处理。

最后，虽然放在后面但是并非不重要，Node.js 8 中有一个 bug 导致 `await` 在某些情况下跳过 microticks，从而产生更好的性能。这个 bug 的原因是我们违反了 es 的规范，但它后来给了我们关于优化的灵感。让我们从有缺陷的行为开始：

```js
const p = Promise.resolve();

(async () => {
  await p; console.log('after:await');
})();

p.then(() => console.log('tick:a'))
 .then(() => console.log('tick:b'));
```

上面的程序创建了一个状态为 fulfilled 的 Promise：`p`，然后 `await` 取得它的结果，与此同时也将后面的 2 个 `then` 函数处理程序链接到它上面。您希望以哪种顺序执行 `console.log` 调用呢？

既然 `p` 的状态已经是 fulfilled 了，你可能会认为首先打印 `'after:await'` 然后再打印 `'tick'`。实际上，这是 Node.js 8 中的行为：

<figure>
  <img src="/_img/fast-async/await-bug-node-8.svg" alt="">
  <figcaption>Node.js 8 的 <code>await</code> bug</figcaption>
</figure>

虽然这种行为看起来很直观，但根据规范它并不正确。Node.js 10 实现了正确的行为，即首先执行链式处理程序，然后继续使用异步函数。

<figure>
  <img src="/_img/fast-async/await-bug-node-10.svg" alt="">
  <figcaption>Node.js 10 中不再有 <code>await</code> 的 bug</figcaption>
</figure>

可以说，这种“正确的行为”其实并不直观，对 JavaScript 开发者来说实际上是令人惊讶的，所以值得做一些解释。在我们深入了解 Promise 和异步函数的神奇之处前，让我们从一些更加基础的情况开始。

### Tasks vs. microtasks

在高层次上，JavaScript 中有 _task_ 和 _microtask_。task 用于处理 I/O 和计时器等事件，每次执行一个。microtask 为 `async`/`await` 和 Promise 实现延迟执行，并在每个 task 结束时执行。在每一个事件循环之前，microtask 队列总是被清空（执行）。

<figure>
  <img src="/_img/fast-async/microtasks-vs-tasks.svg" alt="">
  <figcaption>微任务和任务之间的区别</figcaption>
</figure>

更多详细信息，请查看 Jake Archibald 对[浏览器中的 tasks、microtasks、queues 与 schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/) （[中文翻译](https://hongfanqie.github.io/tasks-microtasks-queues-and-schedules/)）的解释。Node.js 中的任务模型与此非常相似。

### 异步函数 {#async-functions}

根据 MDN，异步函数是一个使用隐式 Promise 异步操作以返回其结果的函数。异步函数旨在使异步代码看起来像同步代码，为开发者隐藏异步处理的一些复杂性。

最简单的异步函数如下所示：

```js
async function computeAnswer() {
  return 42;
}
```

当这个异步函数被调用时，它返回一个 Promise，你可以像任何其他的 Promise 那样获得它的值。

```js
const p = computeAnswer();
// → Promise

p.then(console.log);
// prints 42 on the next turn
```

只有 `p` 在下次运行 microtask 时才能获得此 Promise 的值。换句话说，上面的程序在语义上等同于对值调用 `Promise.resolve`：

```js
function computeAnswer() {
  return Promise.resolve(42);
}
```

异步函数的真正威力来自 `await` 表达式，它会暂停函数的执行直到 Promise 状态变为 resolved，并在执行后恢复。`await` 的值是 Promise 被 fulfilled 的值。这意味着什么？下面是一个示例：

```js
async function fetchStatus(url) {
  const response = await fetch(url);
  return response.status;
}
```

`await` 暂停了函数 `fetchStatus` 的执行，稍后在 `fetch` 返回的 Promise 状态变为 fulfilled 时恢复了执行。这或多或少等同于将把处理过程写在 `fetch` 返回 Promise 的 `then` 链。

```js
function fetchStatus(url) {
  return fetch(url).then(response => response.status);
}
```

该处理程序在异步函数种包含了 `await` 代码。

通常你会传递 `Promise` 给 `await`，但你实际上可以等待（await）任意的 JavaScript 值。如果 `await` 后面的表达式的值不是 Promise，则将其转换为 Promise。这意味着你可以这样写 `await 42`：

```js
async function foo() {
  const v = await 42;
  return v;
}

const p = foo();
// → Promise

p.then(console.log);
// prints `42` eventually
```

更有趣的是，`await` 可以使用任何 [“thenable”](https://promisesaplus.com)，即任何带有 `then` 方法的对象，即使它不是真正的 Promise。因此，您可以实现有趣的事情，例如测量实际 sleep 时间的异步 sleep 功能：

```js
class Sleep {
  constructor(timeout) {
    this.timeout = timeout;
  }
  then(resolve, reject) {
    const startTime = Date.now();
    setTimeout(() => resolve(Date.now() - startTime),
               this.timeout);
  }
}

(async () => {
  const actualTime = await new Sleep(1000);
  console.log(actualTime);
})();
```

接下来，让我们看看 V8 引擎底层是如何实现 `await` [规范](https://tc39.github.io/ecma262/#await)的。这是一个简单的异步函数 `foo`：

```js
async function foo(v) {
  const w = await v;
  return w;
}
```

当函数调用时，它会将参数 `v` 包装为 Promise 并暂停执行异步函数，直到该 Promise 的状态变为 resolved。一旦发生这种情况，函数的执行将恢复并且这个 fulfilled 的 Promise 的值被赋值给 `w`。然后从异步函数中返回此值。

### 引擎底层的 `await` {#await-under-the-hood}

首先，V8 将此函数标记为可恢复（_resumable_），这意味着可以暂停执行并稍后恢复执行（在 `await` 处）。然后它创建所谓的 `implicit_promise`（隐式 Promise），这是在调用异步函数时返回的 Promise，并最终解析（resolve）为异步函数生成的值。

<figure>
  <img src="/_img/fast-async/await-under-the-hood.svg" alt="">
  <figcaption>简单的异步函数与引擎转换之后的代码之间的比较</figcaption>
</figure>

然后是有趣的一点：实际的 `await`。首先，传递给 `await` 的值被包裹在一个 Promise 中。然后，处理程序附加到这个包装的 Promise，以便在 Promise 变为 fulfilled 后恢复该函数，并且暂停执行异步函数，并将 `implicit_promise` 返回给调用者。一旦 `promise` 变为 fulfilled，恢复异步函数的执行，并将 `promise` 的值赋值给 `w`，而且这个 `w` 也是 `implicit_promise` 被 resolved 后的值。

简而言之，`await v` 的最初的执行步骤是：

1. 将 `v` 转换为 Promise- `v` 代表传递给 `await` 的值。
1. 给 Promise 附加处理程序以便稍后恢复异步函数。
1. 挂起异步函数并返回 `implicit_promise` 给调用者。

让我们一步一步地完成各个操作。假设传递给 `await` 的内容已经是一个 Promise，而它的 fulfilled 的值是 `42`。随后 V8 引擎又创建一个新的 `promise` 并对 `await` 后面的 Promise 执行 resolve 操作从而取出值。这确实推迟了下一轮的 Promise 处理链，这些被定义在规范中的 [`PromiseResolveThenableJob`](https://tc39.github.io/ecma262/#sec-promiseresolvethenablejob)。

<figure>
  <img src="/_img/fast-async/await-step-1.svg" alt="">
</figure>

然后引擎创造了另一个所谓的 `throwaway` Promise。它被称为 *throwaway*，因为它的 `then` 链没有任何处理程序 - 它完全在引擎内部。此 `throwaway` 然后被链接到 `promise`，使用适当的处理程序来恢复异步函数。这个 `performPromiseThen` 操作基本上就是 [`Promise.prototype.then()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then) 的幕后操作。最后，暂停执行异步函数，并且控制权返回给调用者。

<figure>
  <img src="/_img/fast-async/await-step-2.svg" alt="">
</figure>

调用者继续执行，最终调用栈变空。然后 JavaScript 引擎开始运行 microtask：它运行之前安排的计划任务 [`PromiseResolveThenableJob`](https://tc39.github.io/ecma262/#sec-promiseresolvethenablejob)，该计划任务又安排了新的 [`PromiseReactionJob`](https://tc39.github.io/ecma262/#sec-promisereactionjob)，作为 `await` 之后的 Promise 的处理链。然后，引擎返回并处理 microtask 队列，因为在继续主事件循环之前必须清空 microtask 队列。

<figure>
  <img src="/_img/fast-async/await-step-3.svg" alt="">
</figure>

接下来是 [`PromiseReactionJob`](https://tc39.github.io/ecma262/#sec-promisereactionjob)，它将 `promise` 设置为状态 fulfilled，其值是我们正在 `await` 的 Promise 值 - 在这个例子中是 `42` - 并且将计划任务链到 `throwaway` Promise。然后引擎再次返回 microtask 循环，其中包含要处理的最终 microtask。

<figure>
  <img src="/_img/fast-async/await-step-4-final.svg" alt="">
</figure>

现在这第二个 [`PromiseReactionJob`](https://tc39.github.io/ecma262/#sec-promisereactionjob) 将 resove 的值传播到 `throwaway` promise，并恢复异步函数的执行，`await` 的返回值为 `42`。

<figure>
  <img src="/_img/fast-async/await-overhead.svg" alt="">
  <figcaption><code>await</code> 的开销</figcaption>
</figure>

总结一下，每个 `await` 引擎必须创建**两个额外**的 Promise（即使右侧已经是一个 Promis）并且它需要**至少三个** microtask 队列 ticks。谁会意识到仅仅是一个 `await` 表达就导致了如此之多的开销？！

<figure>
  <img src="/_img/fast-async/await-code-before.svg" alt="" width="400" height="191">
</figure>

我们来看看这些开销来自哪里。第一行创建了 Promise 包装器。第二行立即使用 `await` 解析 Promise 包装器 `v` 的值。这两行导致了另外一个额外的 Promise 和三个 microtick 中的两个。如果 `v` 已经是一个 Promise（这是常见的情况，因为应用程序通常会在 Promise 上调用 `await`），这是非常昂贵的。在开发者不常使用的情况下，例如 `await 42`，引擎仍然需要为其创建 Promise 包装器。

事实证明，规范中已经有一个 [`promiseResolve`](https://tc39.github.io/ecma262/#sec-promise-resolve) 操作，此操作只在需要时执行包装器：

<figure>
  <img src="/_img/fast-async/await-code-comparison.svg" alt="">
</figure>

此操作返回没有修改过的 promise，并且只在必要时将其值包装到 promise 中。当传递给 `await` 的值已经是一个 Promise 时，这可以节省其中一个额外的 promise，加上 microtick 队列上的两个 tick。从 V8 v7.1 开始，该行为可以通过 V8 的命令行参数 `--harmony-await-optimization` 开启。我们也提交了对 [proposed this change to the ECMAScript specification](https://github.com/tc39/ecma262/pull/1250) 的变更；一旦我们确定它与 Web 兼容，这个补丁就会合并到提案中。

以下是在引擎底层对 `await` 的改进，其按步执行的工作方式如下：

<figure>
  <img src="/_img/fast-async/await-new-step-1.svg" alt="">
</figure>

让我们再次假设我们 `await` 后面的 Promise 返回了 `42`。感谢 [`promiseResolve`](https://tc39.github.io/ecma262/#sec-promise-resolve) 带来的魔法，现在 `promise` 指向了同一个 Promise `v`，所以这个步骤什么也不需要做。然后引擎继续像以前一样，创建 `throwaway` Promise，安排 [`PromiseReactionJob`](https://tc39.github.io/ecma262/#sec-promisereactionjob) 在 microtask 队列的下一个 tick 上恢复异步函数，暂停执行该函数，然后返回给调用者。

<figure>
  <img src="/_img/fast-async/await-new-step-2.svg" alt="">
</figure>

最终当所有 JavaScript 执行完成时，引擎开始运行 microtask，因此它执行 [`PromiseReactionJob`](https://tc39.github.io/ecma262/#sec-promisereactionjob)。这个过程将 `promise` 传播到 `throwaway`，并恢复异步函数的执行，为 `await` 得到 `42`。

<figure>
  <img src="/_img/fast-async/await-overhead-removed.svg" alt="">
  <figcaption>节省了执行 <code>await</code> 的开销</figcaption>
</figure>

如果传递给 `await` 的值已经是一个 Promise，那么这种优化避免了再次创建 Promise 包装器，在这种情况下，我们从**最少三个** microtick 到**只有一个** microtick。这种行为类似于 Node.js 8 所做的，但是现在它不再是一个 bug - 它现在是一个正在标准化的优化！

虽然 `throwaway` 只是在 V8 引擎内部使用，但引擎必须创造这种 Promise。事实证明，`throwaway` Promise 只是为了满足 `performPromiseThen` 规范中内部操作的 API 约束。

<figure>
  <img src="/_img/fast-async/await-optimized.svg" alt="">
</figure>

最近在 ECMAScript 规范的[编辑性更改](https://github.com/tc39/ecma262/issues/694)中解决了这个问题。引擎不再需要为 `await` 创造 `throwaway` Promise - 在绝大部分时间[^2]。

[^2]: 如果在 Node.js 中使用 [`async_hooks`](https://nodejs.org/api/async_hooks.html)，V8 仍然需要创建 `throwaway`，因为 `before` 和 `after` 钩子需要在 `throwaway` 的 promise *上下文中*运行。

<figure>
  <img src="/_img/fast-async/node-10-vs-node-12.svg" alt="">
  <figcaption><code>await</code> 优化之前和之后的比较</figcaption>
</figure>

同 Node.js 10 的 `await` 对比，在 Node.js 12 中做了更进一步的优化，下图显示了此更改对性能的影响：

<figure>
  <img src="/_img/fast-async/benchmark-optimization.svg" alt="">
</figure>

**`async`/`await` 现在优于手写的 Promise 代码**。这里的关键点是，我们通过修补规范[^3]，大大减少了异步函数的开销 - 不仅在 V8 中，而且在所有 JavaScript 引擎中。

[^3]: 如上所述，[此补丁](https://github.com/tc39/ecma262/pull/1250)尚未合并到 ECMAScript 规范中。一旦我们确保此改变不会破坏网络，我们的计划就是马上执行。

## 改善开发者体验 {#improved-developer-experience}

除了性能之外，JavaScript 开发者还关心诊断和修复 bug 的能力，这在处理异步代码时通常会更加困难。[Chrome DevTools](https://developers.google.com/web/tools/chrome-devtools) 支持异步堆栈跟踪，即堆栈跟踪不仅包括堆栈的当前同步部分，还包括异步部分：

<figure>
  <img src="/_img/fast-async/devtools.png" srcset="/_img/fast-async/devtools@2x.png 2x" alt="">
</figure>

这是本地开发过程中非常有用的功能。但是，一旦部署了应用程序，这种方法并没有真正帮助您。在线上调试期间，您只会在日志文件中看到 `Error#stack` 输出，并且不会告诉您有关异步部分的任何信息。

我们最近一直在研究[零成本的异步堆栈跟踪](https://bit.ly/v8-zero-cost-async-stack-traces)，它为异步函数调用提供了更丰富的 `Error#stack` 属性。“零成本”听起来令人兴奋，不是吗？当 Chrome DevTools 特性带来重大开销时，如何才能实现零成本？考虑这个 `foo` 异步调用 `bar` 的例子，而且 `bar` 在 `await` 的 Promise 之后抛出异常：

```js
async function foo() {
  await bar();
  return 42;
}

async function bar() {
  await Promise.resolve();
  throw new Error('BEEP BEEP');
}

foo().catch(error => console.log(error.stack));
```

在 Node.js 8 或 Node.js 10 中运行此代码会产生以下输出：

```text/2
$ node index.js
Error: BEEP BEEP
    at bar (index.js:8:9)
    at process._tickCallback (internal/process/next_tick.js:68:7)
    at Function.Module.runMain (internal/modules/cjs/loader.js:745:11)
    at startup (internal/bootstrap/node.js:266:19)
    at bootstrapNodeJSCore (internal/bootstrap/node.js:595:3)
```

请注意，虽然调用 `foo()` 导致错误，但 `foo` 根本不是堆栈跟踪的一部分。这使得 JavaScript 开发者执行事后调试变得棘手，无论您的代码是部署在 Web 应用程序中还是部署在云容器内部。

这里有趣的是，引擎知道 `bar` 调用完成时它继续执行的位置：在 `foo` 函数的 `await` 之后。巧合的是，这也是函数 `foo` 暂停的地方。引擎可以使用此信息来重建异步堆栈跟踪的部分，即 `await` 现场。通过此更改，输出变为：

```text/2,7
$ node --async-stack-traces index.js
Error: BEEP BEEP
    at bar (index.js:8:9)
    at process._tickCallback (internal/process/next_tick.js:68:7)
    at Function.Module.runMain (internal/modules/cjs/loader.js:745:11)
    at startup (internal/bootstrap/node.js:266:19)
    at bootstrapNodeJSCore (internal/bootstrap/node.js:595:3)
    at async foo (index.js:2:3)
```

在堆栈跟踪中，最顶层的函数首先出现，然后是同步堆栈跟踪的其余部分，然后是 `bar` 函数的异步调用 `foo`。此更改在 V8 中使用 `--async-stack-traces` 标志开启。

但是，如果将此与上面 Chrome DevTools 中的异步堆栈跟踪进行比较，您会注意到 `foo` 堆栈跟踪的异步部分中缺少实际的调用现场。如前所述，这种方法利用了一个事实，`await` 即恢复和暂停位置是相同的 - 但对于常规 [`Promise#then()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then) 或 [`Promise#catch()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch) 调用，情况并非如此。有关更多背景信息，请参阅 Mathias Bynens 对[why `await` beats `Promise#then()`](https://mathiasbynens.be/notes/async-stack-traces) 的解释。

## 结论 {#conclusion}

由于两个重要的优化，我们使异步函数更快：

- 删除两个额外的 microtick，和
- 去除了 `throwaway` promise。

最重要的是，我们通过[零成本异步堆栈跟踪](https://bit.ly/v8-zero-cost-async-stack-traces)改进了开发体验，这些可以使用在异步函数的 `await` 表达式和异步函数中使用 `Promise.all()`。

我们还为 JavaScript 开发者提供了一些很好的性能建议：

- 使用 `async` 函数和 `await` 替代手写的 Promise 代码，以及
- 坚持 JavaScript 引擎提供的原生 Promise 实现，以避免在 `await` 中使用额外的两个 microtick。
