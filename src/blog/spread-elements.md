---
title: '加速 `[...spread]` 运算'
author: 'Hai Dang & Georg Neis'
date: 2018-12-04 16:57:21
tags:
  - ECMAScript
  - benchmarks
description: 'V8 v7.2 显著地提升了 Array.from(array) 的性能，从而加速了在数组、字符串、Set、Map 上使用 [...spread] 的效率'
tweet: '1070344545685118976'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
Hai Dong 在 V8 团队实习，在这三个月实习期间，他致力于提升 `[...array]`、`[...string]`、`[...set]`、`[...map.keys()]` 和 `[...map.values()]`（当展开的元素位于数组字面量的起始位置）。他甚至让 `Array.from(iterable)` 的速度变得更快。这篇文章解释了他所做工作的一些细节，这些变更会在 V8 7.2 版本发布。

## 元素展开 { #spread-elements }

元素展开是由 `...iterable` 形式的数组字面量组成。作为一种从可迭代对象创建数组的新方式，该特性在 ES2015(ES6) 中提出。比如，数组字面量 `[1, ...arr, 4, ...b]` 会创建一个新数组，该数组第一个元素是 `1`，然后是 `arr` 的各个元素，其次是 `4`，最后是 `b` 的各个元素：

```js
const a = [2, 3];
const b = [5, 6, 7];
const result = [1, ...a, 4, ...b];
// → [1, 2, 3, 4, 5, 6, 7]
```

另一个例子，任何字符串都可以展开为包含其所有字符（Unicode 码位）的数组：

```js
const str = 'こんにちは';
const result = [...str];
// → ['こ', 'ん', 'に', 'ち', 'は']
```

同样，`Set` 也可以展开为数组，里面包含了该集合的所有元素，按照迭代顺序排列：

```js
const s = new Set();
s.add('V8');
s.add('TurboFan');
const result = [...s];
// → ['V8', 'TurboFan']
```

总而言之，数组字面量中的元素展开语法 `...x` 假定 `x` 提供一个迭代器（通过 `x[Symbol.iterator()]` 访问。然后通过该迭代器获取元素插入到结果数组。

将数组展开到一个新的数组，但是前后不能添加其他元素，即 `[...arr]`，这种简单的使用情景被认为是 ES2015 中一种简洁、直接的浅拷贝 `arr` 的方法。不幸的是，在 V8 中，这一操作的性能远低于 ES5 中的其它写法。Hai 的目标就是改变这一现状。

## 为什么元素展开（以前）这么慢？ { #why-is-(or-were!)-spread-elements-slow%3F }

有许多浅拷贝数组 `arr` 的方法。例如，你可以使用 `arr.slice()`，或者 `arr.concat()`，或者 `[...arr]`。或者，你可以自己写一个 `clone` 函数，通过标准的 `for` 循环进行浅拷贝：

```js
function clone(arr) {
  // 预分配恰当的 `result` 数组空间，避免动态增长数组
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    result[i] = arr[i];
  }
  return result;
}
```

理想情况下，无论你选择哪一种方式，都应该具有相近的性能。不幸的是，如果你选择了 `[...arr]`，在 V8 中它将会比 `clone` 函数慢。其原因在于 V8 将 `[...arr]` 转译为类似这样的代码：

```js
function(arr) {
  const result = [];
  const iterator = arr[Symbol.iterator]();
  const next = iterator.next;
  for ( ; ; ) {
    const iteratorResult = next.call(iterator);
    if (iteratorResult.done) break;
    result.push(iteratorResult.value);
  }
  return result;
}
```

这段代码比 `clone` 慢，原有如下：

1. 它需要在一开始通过读取和检查 `Symbol.interator` 属性来创建一个 `iterator`。
1. 它需要在每次循环都创建和查询 `iteratorResult` 对象。
1. 它在每次循环迭代的过程中，通过调用 `push` 来增大 `result` 数组，导致空间的不断重新分配。

我们之所以这样实现，是因为正如之前所提到的，元素展开操作不仅可以被用于数组，还可以用于任何**可迭代**对象，而且必须遵循[迭代规范](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)。不过，V8 应该很聪明地意识到被展开的对象是不是一个数组，从而在更底层提取元素，因此：

1. 避免创建迭代器对象
1. 避免创建迭代器结果对象
1. 避免反复增长并重分配结果数组（我们已经提前知道元素的个数）

针对快速数组，我们使用 [CSA](/blog/csa) 来实现这一简单的想法，例如拥有最常见的六种[元素类型](/blog/elements-kinds)的数组。这一[真实世界情景](/blog/real-world-performance)的优化，适用于在数组字面量开头使用对象展开操作，例如 `[...foo]`。如下图所示，新的 Fast-Path 在展开长度为 100,000 的数组时获得了 3 倍的性能提升，比手写的 `clone` 循环快了 25%。

<figure>
  <img src="/_img/spread-elements/spread-fast-array.png" srcset="/_img/spread-elements/spread-fast-array@2x.png 2x" intrinsicsize="268x243" alt="">
  <figcaption>为快速数组进行元素展开操作的性能提升</figcaption>
</figure>

**注意：**虽然没有在此显示，但是 Fast-Path 同样也适用于展开操作后面由其它元素时（例如 `[...arr, 1, 2, 3]`，但如果前面有其他元素则无效（例如 `[1, 2, 3, ...arr]`）。

## 仔细检查 Fast-Path  { #tread-carefully-down-that-Fast-Path }

该方法是令人激动的速度提升，但是我们必须仔细检查 Fast-Path 是否正确：JavaScript 允许程序员以多种方法修改对象（甚至数组）的迭代行为。由于元素展开使用迭代规范，当原始迭代机制被修改时，我们将不使用 Fast-Path ，以此来确保修改后的迭代行为依然符合规范。例如以下情景：

### 自身的 `Symbol.iterator` 属性 { #own-symbol.iterator-property }

一般而已，数组 `arr` 不会拥有它自己的 [`Symbol.iterator`](https://tc39.github.io/ecma262/#sec-symbol.iterator) 属性，所以当我们查找该 symbol 时会在数组的原型上找到。下面的例子中，通过直接在 `arr` 上定义 `Symbol.iterator` 绕过了原型。在做这样的修改之后，在 `arr` 上查找 `Symbol.iterator` 会得到一个空迭代器，所以展开 `arr` 不会获得元素，展开的数组字面量是一个空数组。

```js
const arr = [1, 2, 3];
arr[Symbol.iterator] = function() {
  return { next: function() { return { done: true }; } };
};
const result = [...arr];
// → []
```

### 修改 `%ArrayIteratorPrototype%` { #modified-%25arrayiteratorprototype%25 }

`next` 方法也可以直接通过 [`%ArrayIteratorPrototype%`](https://tc39.github.io/ecma262/#sec-%arrayiteratorprototype%-object) 来修改，这是数组迭代器的原型（会影响所有数组）。

```js
Object.getPrototypeOf([][Symbol.iterator]()).next = function() {
  return { done: true };
}
const arr = [1, 2, 3];
const result = [...arr];
// → []
```

## 处理_稀疏_数组 { #dealing-with-holey-arrays }

另外需要注意的是复制稀疏数组，例如 `['a', , 'c']` 这种缺失部分元素的数组。展开这样的数组时，根据迭代规范，展开这样的数组不会保留空洞，而是用相应索引处的数组原型中的值填充它们。默认情况下数组的原型中没有元素，意味着空洞将会被 `undefined` 填充。例如，`[...['a', , 'c']]` 将会获得 `['a', undefined, 'c']`。

我们的 Fast-Path 在这种情况下可以很聪明地处理空洞。它不会盲目地复制输入数组的存储空间，而是会观察这些空洞并把它们小心的转换成 `undefined` 值。下图展示了展开 100,000 个元素但只有 600 个整数其它均是空洞的数组的性能。展开这样一个充满空洞的稀疏数组比 `clone` 函数快 4 倍。（它们过去的性能大致相同，但在图中未显示）。

注意，虽然图中包含了 `slice` 方法的结果，但是与它比较是不公平的，因为 `slice` 对稀疏数组拥有不同的语义，它会保留所有的空洞，所以少做了很多工作。

<figure>
  <img src="/_img/spread-elements/spread-holey-smi-array.png" srcset="/_img/spread-elements/spread-holey-smi-array@2x.png 2x" intrinsicsize="284x250" alt="">
  <figcaption>对稀疏整型数组进行元素展开的性能 (<a href="/blog/elements-kinds"><code>HOLEY_SMI_ELEMENTS</code></a>)</figcaption>
</figure>

我们的 Fast-Path 必须把空洞填充为 `undefined`，这个操作并没有听起来这么简单：他可能需要把整个数组转换成另一种元素类型。下图展示了这种情景。初始化和前文一样，不同的是这次的 600 个数组元素是未拆封的 double 类型，数组的元素类型是 `HOLEY_DOUBLE_ELEMENTS`。因为该元素类型无法承载类似 `undefined` 的标记值，展开这样的数组需要执行代价高昂的元素类型转换操作，这就是为什么 `[...a]` 的分数比上一张图低许多。不过，还是比 `clone(a)` 要快许多。

<figure>
  <img src="/_img/spread-elements/spread-holey-double-array.png" srcset="/_img/spread-elements/spread-holey-double-array@2x.png 2x" intrinsicsize="282x242" alt="">
  <figcaption>对稀疏双精度数组进行元素展开的性能 (<a href="/blog/elements-kinds"><code>HOLEY_DOUBLE_ELEMENTS</code></a>)</figcaption>
</figure>

## 展开字符串、`Set` 和 `Map`  { #spreading-strings%2C-sets%2C-and-maps }

跳过迭代器对象并避免增长结果数组的想法同样适用于其他标准数据类型。实际上，我们为原始字符串，Set 和 Map 实现了类似的 Fast-Path ，每当存在修改迭代行为时都要小心地绕过它们。

关于 Set， Fast-Path 不仅支持直接展开 Set（`[...set]`），还支持展开它的键迭代器（`[...set.keys()]`）和它的值迭代器（`[...set.values()]`）。在我们的微基准测试中，这些操作现在比以前快了 18 倍。

对 Map 的 Fast-Path 也是类似的，但是并不支持直接展开 Map（[...map]），因为我们认为这是一个不常用的操作。由于某些原因， Fast-Path 也不支持 `.entries()` 迭代器。在我们的微基准测试中，这些操作现在比以前快了大约 14 倍。

对字符串进行元素展开操作（`[...string]`），我们测得了大约 5 倍的性能提升，在下图中以紫色和绿色折现表示。注意，这甚至比在下图中以蓝色和粉色显示的 TurboFan 优化的 for-of 循环还要快。（TurboFan 可以分析字符串迭代并为其生成优化后的代码）。在每种情况下都有两个图标，因为微基准测试在两个不同的字符串表示法上操作（单字节字符串和双字节字符串）。

<figure>
  <img src="/_img/spread-elements/spread-string.png" srcset="/_img/spread-elements/spread-string@2x.png 2x" alt="">
  <figcaption>对字符串进行元素展开操作</figcaption>
</figure>

<figure>
  <img src="/_img/spread-elements/spread-set.png" srcset="/_img/spread-elements/spread-set@2x.png 2x" alt="">
  <figcaption>对含有 10 万个整数的 Set 进行元素展开（品红色，大概快 18 倍），并且和 <code>for</code>-<code>of</code> 循环进行对比（红色）</figcaption>
</figure>

## 提升 `Array.from` 的性能 { #improving-array.from-performance }

幸运的是，元素展开的 Fast-Path 同样可以用于 `Array.from`，只要传入 `Array.from` 的是一个可迭代对象并且不包含映射函数。（例如 `Array.from([1, 2, 3])`）。之所以可以使用，因为 `Array.from` 的表现与展开操作一致。这显著地提升了性能，下图展示了 100 个双精度数的数组的性能。

<figure>
  <img src="/_img/spread-elements/array-from-array-of-doubles.png" srcset="/_img/spread-elements/array-from-array-of-doubles@2x.png 2x" intrinsicsize="284x242" alt="">
  <figcaption>当 <code>array</code> 包含 100 个双精度数时，<code>Array.from(array)</code> 的性能提升</figcaption>
</figure>

## 结论 { #conclusion }

V8 v7.2 / Chrome 72 大幅提升了元素展开的性能，当他们在数组字面量的最前使用，例如 `[...x]` 或者 `[...x, 1, 2]`。这个提升可用于数组、原始字符串、Map 的键、Map 的值，以及 `Array.from(x)`。
