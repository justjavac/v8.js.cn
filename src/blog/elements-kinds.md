---
title: 'V8 中的元素种类及性能优化'
author: 'Mathias Bynens ([@mathias](https://twitter.com/mathias))'
avatars:
  - 'mathias-bynens'
date: 2017-09-12 13:33:37
tags:
  - internals
  - presentations
tweet: '907608362191376384'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
注: 如果你正在阅读下面的文章，那么你肯定对这个视频也感兴趣！

<figure>
  <iframe src="https://www.youtube.com/embed/m9cTaYI95Zc" width="640" height="360"></iframe>
</figure>

JavaScript 对象可以具有与它们相关联的任意属性。对象属性的名称可以包含任何字符。JavaScript 引擎可以进行优化的一个有趣的例子是当属性名是纯数字时，一个特例就是[数组索引的属性](https://tc39.github.io/ecma262/#sec-object-type)。

在 V8 中，如果属性名是数字（最常见的形式是 `Array` 构造函数生成的对象）会被特殊处理。尽管在许多情况下，这些数字索引属性的行为与其他属性一样，V8 选择将它们与非数字属性分开存储以进行优化。在引擎内部，V8 甚至给这些属性一个特殊的名称：**元素**。对象具有映射到值的[属性]](/blog/fast-properties)，而数组具有映射到元素的索引。

尽管这些内部结构从未直接暴露给 JavaScript 开发人员，但它们解释了为什么某些代码模式比其他代码模式更快。

## 常见的元素种类 {#common-elements-kinds}

运行 JavaScript 代码时，V8 会跟踪每个数组所包含的元素。这些信息可以帮助 V8 优化数组元素的操作。例如，当您在数组上调用 `reduce`，`map` 或 `forEach` 时，V8 可以根据数组包含哪些元素来优化这些操作。

拿这个数组举例：

```js
const array = [1, 2, 3];
```

它包含什么样的元素？如果你使用 `typeof` 操作符，它会告诉你数组包含 `number`。在语言层面，这就是你所得到的：JavaScript 不区分整数，浮点数和双精度 - 它们只是数字。然而，在引擎级别，我们可以做出更精确的区分。这个数组的元素是 `PACKED_SMI_ELEMENTS`。在 V8
中，术语 Smi 是指用于存储小整数的特定格式。（后面我们会在 `PACKED` 部分中说明。）

稍后在这个数组中添加一个浮点数将其转换为更通用的元素类型：

```js
const array = [1, 2, 3];
// 元素类型: PACKED_SMI_ELEMENTS
array.push(4.56);
// 元素类型: PACKED_DOUBLE_ELEMENTS
```

向数组添加字符串再次改变其元素类型。

```js
const array = [1, 2, 3];
// 元素类型: PACKED_SMI_ELEMENTS
array.push(4.56);
// 元素类型: PACKED_DOUBLE_ELEMENTS
array.push('x');
// 元素类型: PACKED_ELEMENTS
```

到目前为止，我们已经看到三种不同的元素，具有以下基本类型：

- 小整数，又称 Smi（<b>Sm</b>all <b>i</b>ntegers）。
- 双精度浮点数，浮点数和不能表示为 Smi 的整数。
- 常规元素，不能表示为 Smi 或双精度的值。

请注意，双精度浮点数是 Smi 的更为一般的变体，而常规元素是双精度浮点数之上的另一个概括。可以表示为 Smi 的数字集合是可以表示为
double 的数字的子集。

这里重要的一点是，元素种类转换只能从一个方向进行：从特定的（例如 `PACKED_SMI_ELEMENTS`）到更一般的（例如 `PACKED_ELEMENTS`）。例如，一旦数组被标记为 `PACKED_ELEMENTS`，它就不能回到 `PACKED_DOUBLE_ELEMENTS`。

到目前为止，我们已经学到了以下内容：

- V8 为每个数组分配一个元素种类。
- 数组的元素种类并没有被捆绑在一起 - 它可以在运行时改变。在前面的例子中，我们从 `PACKED_SMI_ELEMENTS` 过渡到 `PACKED_ELEMENTS`。
- 元素种类转换只能从特定种类转变为更普遍的种类。

## 密集数组 PACKED 和稀疏数组 HOLEY {#packed-vs.-holey-kinds}

到目前为止，我们只处理密集或打包（PACKED）数组。在数组中创建稀疏数组将元素降级到其 HOLEY 变体：

```js
const array = [1, 2, 3, 4.56, 'x'];
// 元素类型: PACKED_ELEMENTS
array.length; // 5
array[9] = 1; // array[5] until array[8] are now holes
// 元素类型: HOLEY_ELEMENTS
```

V8 之所以做这个区别是因为 `PACKED` 数组的操作比在 `HOLEY` 数组上的操作更利于进行优化。对于 `PACKED` 数组，大多数操作可以有效执行。相比之下， `HOLEY` 数组的操作需要对原型链进行额外的检查和昂贵的查找。

到目前为止，我们看到的每个基本元素（即 Smis，double 和常规元素）有两种：`PACKED` 和 `HOLEY`。我们不仅可以从 `PACKED_SMI_ELEMENTS` 转变为 `PACKED_DOUBLE_ELEMENTS` 我们也可以从任何 `PACKED` 形式转变成 `HOLEY` 形式。

回顾一下：

- 最常见的元素种类 `PACKED` 和 `HOLEY`。
- `PACKED` 数组的操作比在 `HOLEY` 数组上的操作更为有效。
- 元素种类可从过渡 `PACKED` 转变为 `HOLEY`。

## 元素种类的格 {#the-elements-kind-lattice}

V8 将这个变换系统实现为[格 lattice](https://en.wikipedia.org/wiki/Lattice_%28order%29)(数学概念)。这是一个简化的可视化，仅显示最常见的元素种类：

<figure>
  <img src="/_img/elements-kinds/lattice.svg" alt="">
</figure>

只能通过格子向下过渡。一旦将单精度浮点数添加到 Smi 数组中，即使稍后用 Smi 覆盖浮点数，它也会被标记为 DOUBLE。类似地，一旦在数组中创建了一个洞，它将被永久标记为有洞 HOLEY，即使稍后填充它也是如此。

V8 目前有 [21 种不同的元素种类](https://cs.chromium.org/chromium/src/v8/src/elements-kind.h?l=14&rcl=ec37390b2ba2b4051f46f153a8cc179ed4656f5d)，每种元素都有自己的一组可能的优化。

一般来说，更具体的元素种类可以进行更细粒度的优化。元素类型的在格子中越是向下，该对象的操作越慢。为了获得最佳性能，请避免不必要的不具体类型 - 坚持使用符合您情况的最具体的类型。

## 性能提示 {#performance-tips}

在大多数情况下，元素种类的跟踪操作都隐藏在引擎下面，您不需要担心。但是，为了从系统中获得最大的收益，您可以采取以下几方面。再次重申:更具体的元素种类可以进行更细粒度的优化。元素类型的在格子中越是向下，该对象的操作越慢。为了获得最佳性能，请避免不必要的不具体类型 - 坚持使用符合您情况的最具体的类型。

### 避免创建洞(hole) #avoid-creating-holes

假设我们正在尝试创建一个数组，例如：

```js
const array = new Array(3);
// 此时，数组是稀疏的，所以它被标记为 `HOLEY_SMI_ELEMENTS`
// i.e. 给出当前信息的最具体的可能性。
array[0] = 'a';
// 接着，这是一个字符串，而不是一个小整数...所以过渡到`HOLEY_ELEMENTS`。
array[1] = 'b';
array[2] = 'c';
// 这时，数组中的所有三个位置都被填充，所以数组被打包（即不再稀疏）。
// 但是，我们无法转换为更具体的类型，例如 “PACKED_ELEMENTS”。
// 元素类保留为“HOLEY_ELEMENTS”。
```

一旦数组被标记为有洞，它永远是有洞的 - 即使它被打包了！从那时起，数组上的任何操作都可能变慢。如果您计划在数组上执行大量操作，并且希望对这些操作进行优化，请避免在数组中创建空洞。V8 可以更有效地处理密集数组。

创建数组的一种更好的方法是使用字面量：

```js
const array = ['a', 'b', 'c'];
// elements kind: PACKED_ELEMENTS
```

如果您提前不知道元素的所有值，那么可以创建一个空数组，然后再 `push` 值。

```js
const array = [];
// …
array.push(someValue);
// …
array.push(someOtherValue);
```

这种方法确保数组不会被转换为 holey elements。因此，V8 可以更有效地优化数组上的任何操作。

### 避免读取超出数组的长度 {#avoid-reading-beyond-the-length-of-the-array}

当读数超过数组的长度时，例如读取 `array[42]` 时，会发生类似的情况 `array.length === 5`。在这种情况下，数组索引 `42` 超出范围，该属性不存在于数组本身上，因此 JavaScript 引擎必须执行相同的昂贵的原型链查找。

不要这样写你的循环：

```js
// Don’t do this!
for (let i = 0, item; (item = items[i]) != null; i++) {
  doSomething(item);
}
```

该代码读取数组中的所有元素，然后再次读取。直到它找到一个元素为 `undefined` 或 `null` 时停止。（jQuery 在几个地方使用这种模式。）

相反，将你的循环写成老式的方式，只需要一直迭代到最后一个元素。

```js
for (let index = 0; index < items.length; index++) {
  const item = items[index];
  doSomething(item);
}
```

当你循环的集合是可迭代的（数组和 `NodeList`），还有更好的选择：只需要使用 `for-of`。

```js
for (const item of items) {
  doSomething(item);
}
```

对于数组，您可以使用内置的 `forEach`：

```js
items.forEach((item) => {
  doSomething(item);
});
```

如今，两者的性能 `for-of` 和 `forEach` 可以和旧式的 `for` 循环相提并论。

避免读数超出数组的长度！这样做和数组中的洞一样糟糕。在这种情况下，V8 的边界检查失败，检查属性是否存在失败，然后我们需要查找原型链。

### 避免元素种类转换 {#avoid-elements-kind-transitions}

一般来说，如果您需要在数组上执行大量操作，请尝试坚持尽可能具体的元素类型，以便 V8 可以尽可能优化这些操作。

这比看起来更难。例如，只需给数组添加一个 `-0`，一个小整数的数组即可将其转换为 `PACKED_DOUBLE_ELEMENTS`。

```js
const array = [3, 2, 1, +0];
// PACKED_SMI_ELEMENTS
array.push(-0);
// PACKED_DOUBLE_ELEMENTS
```

因此，此数组上的任何操作都将以与 Smi 完全不同的方式进行优化。

避免 `-0`，除非你需要在代码中明确区分 `-0` 和 `+0`。（你可能并不需要）

同样还有 `NaN` 和 `Infinity`。它们被表示为双精度，因此添加一个 `NaN` 或 `Infinity` 会将 `SMI_ELEMENTS` 转换为
`DOUBLE_ELEMENTS`。

```js
const array = [3, 2, 1];
// PACKED_SMI_ELEMENTS
array.push(NaN, Infinity);
// PACKED_DOUBLE_ELEMENTS
```

如果您计划对整数数组执行大量操作，在初始化的时候请考虑规范化 `-0`，并且防止 `NaN` 以及 `Infinity`。这样数组就会保持 `PACKED_SMI_ELEMENTS`。

事实上，如果你对数组进行数学运算，可以考虑使用 `TypedArray`。每个数组都有专门的元素类型。

### 类数组对象 vs 数组 {#prefer-arrays-over-array-like-objects}

JavaScript 中的某些对象 - 特别是在 DOM 中 - 虽然它们不是真正的数组，但是他们看起来像数组。可以自己创建类数组的对象：

```js
const arrayLike = {};
arrayLike[0] = 'a';
arrayLike[1] = 'b';
arrayLike[2] = 'c';
arrayLike.length = 3;
```

This object has a `length` and supports indexed element access (just like an array!) but it lacks array methods such as `forEach` on its prototype. It’s still possible to call array generics on it, though:

```js
Array.prototype.forEach.call(arrayLike, (value, index) => {
  console.log(`${ index }: ${ value }`);
});
// This logs '0: a', then '1: b', and finally '2: c'.
```

这个代码工作原理如下，在类数组对象上调用数组内置的 `Array.prototype.forEach`。但是，这比在真正的数组中调用 `forEach` 慢，引擎数组的 `forEach` 在 V8 中是高度优化的。如果你打算在这个对象上多次使用数组内置函数，可以考虑先把它变成一个真正的数组：

```js
const actualArray = Array.prototype.slice.call(arrayLike, 0);
actualArray.forEach((value, index) => {
  console.log(`${ index }: ${ value }`);
});
// This logs '0: a', then '1: b', and finally '2: c'.
```

为了后续的优化，进行一次性转换的成本是值得的，特别是如果您计划在数组上执行大量操作。

例如，`arguments` 对象是类数组的对象。可以在其上调用数组内置函数，但是这样的操作将不会被完全优化，因为这些优化只针对真正的数组。

```js
const logArgs = function() {
  Array.prototype.forEach.call(arguments, (value, index) => {
    console.log(`${ index }: ${ value }`);
  });
};
logArgs('a', 'b', 'c');
// This logs '0: a', then '1: b', and finally '2: c'.
```

ES2015 的 rest 参数在这里很有帮助。它们产生真正的数组，可以优雅的代替类似数组的对象 `arguments`。

```js
const logArgs = (...args) => {
  args.forEach((value, index) => {
    console.log(`${ index }: ${ value }`);
  });
};
logArgs('a', 'b', 'c');
// This logs '0: a', then '1: b', and finally '2: c'.
```

如今，没有理由直接使用对象 `arguments`。

通常，尽可能避免使用数组类对象，应该使用真正的数组。

### 避免多态 {#avoid-polymorphism}

如果您的代码需要处理包含多种不同元素类型的数组，则可能会比单个元素类型数组要慢，因为你的代码要对不同类型的数组元素进行多态操作。

考虑以下示例，其中使用了各种元素种类调用。（请注意，这不是本机 `Array.prototype.forEach`，它具有自己的一些优化，这些优化不同于本文中讨论的元素种类优化。）

```js
const each = (array, callback) => {
  for (let index = 0; index < array.length; ++index) {
    const item = array[index];
    callback(item);
  }
};
const doSomething = (item) => console.log(item);

each([], () => {});

each(['a', 'b', 'c'], doSomething);
// `each` is called with `PACKED_ELEMENTS`. V8 uses an inline cache
// (or “IC”) to remember that `each` is called with this particular
// elements kind. V8 is optimistic and assumes that the
// `array.length` and `array[index]` accesses inside the `each`
// function are monomorphic (i.e. only ever receive a single kind
// of elements) until proven otherwise. For every future call to
// `each`, V8 checks if the elements kind is `PACKED_ELEMENTS`. If
// so, V8 can re-use the previously-generated code. If not, more work
// is needed.

each([1.1, 2.2, 3.3], doSomething);
// `each` is called with `PACKED_DOUBLE_ELEMENTS`. Because V8 has
// now seen different elements kinds passed to `each` in its IC, the
// `array.length` and `array[index]` accesses inside the `each`
// function get marked as polymorphic. V8 now needs an additional
// check every time `each` gets called: one for `PACKED_ELEMENTS`
// (like before), a new one for `PACKED_DOUBLE_ELEMENTS`, and one for
// any other elements kinds (like before). This incurs a performance
// hit.

each([1, 2, 3], doSomething);
// `each` is called with `PACKED_SMI_ELEMENTS`. This triggers another
// degree of polymorphism. There are now three different elements
// kinds in the IC for `each`. For every `each` call from now on, yet
// another elements kind check is needed to re-use the generated code
// for `PACKED_SMI_ELEMENTS`. This comes at a performance cost.
```

内置方法（如 `Array.prototype.forEach`）可以更有效地处理这种多态性，因此在性能敏感的情况下考虑使用它们而不是用户库函数。

V8 中单态与多态的另一个例子涉及对象形状（object shape），也称为对象的隐藏类。要了解更多，请查看 [Vyacheslav 的文章](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html)。

## 调试元素种类 {#debugging}

找出一个给定的对象的“元素种类”，可以使用一个调试版本 `d8`（参见[“从源代码构建”](/docs/build)），并运行：

```bash
out/x64.debug/d8 --allow-natives-syntax
```

这将打开 `d8` REPL 中的[特殊函数](https://cs.chromium.org/chromium/src/v8/src/runtime/runtime.h?l=20&rcl=05720af2b09a18be5c41bbf224a58f3f0618f6be)，如 `%DebugPrint(object)`。输出中的“元素”字段显示您传递给它的任何对象的“元素种类”。

```js
d8> const array = [1, 2, 3]; %DebugPrint(array);
DebugPrint: 0x1fbbad30fd71: [JSArray]
 - map = 0x10a6f8a038b1 [FastProperties]
 - prototype = 0x1212bb687ec1
 - elements = 0x1fbbad30fd19 <FixedArray[3]> [PACKED_SMI_ELEMENTS (COW)]
 - length = 3
 - properties = 0x219eb0702241 <FixedArray[0]> {
    #length: 0x219eb0764ac9 <AccessorInfo> (const accessor descriptor)
 }
 - elements= 0x1fbbad30fd19 <FixedArray[3]> {
           0: 1
           1: 2
           2: 3
 }
[…]
```

请注意，“COW” 表示[写时复制](https://en.wikipedia.org/wiki/Copy-on-write)，这是另一个内部优化。现在不要担心 - 这是另一个博文的主题！

调试版本中可用的另一个有用的标志是 `--trace-elements-transitions`。启用它让 V8 在任何元素发生类型转换时通知您。

```bash
$ cat my-script.js
const array = [1, 2, 3];
array[3] = 4.56;

$ out/x64.debug/d8 --trace-elements-transitions my-script.js
elements transition [PACKED_SMI_ELEMENTS -> PACKED_DOUBLE_ELEMENTS] in ~+34 at x.js:2 for 0x1df87228c911 <JSArray[3]> from 0x1df87228c889 <FixedArray[3]> to 0x1df87228c941 <FixedDoubleArray[22]>
```
