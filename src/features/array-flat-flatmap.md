---
title: '`Array.prototype.flat` 和 `Array.prototype.flatMap`'
author: 'Mathias Bynens ([@mathias](https://twitter.com/mathias))'
avatars:
  - 'mathias-bynens'
date: 2019-06-11
tags:
  - ECMAScript
  - ES2019
  - io19
description: 'Array.prototype.flat flattens an array up to the specified depth. Array.prototype.flatMap is equivalent to doing a map followed by a flat separately.'
tweet: '1138457106380709891'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，[v8.js.cn](https://v8.js.cn) 站长'
  avatars:
    - justjavac
---
## `Array.prototype.flat` { #flat }

此示例是一个深度嵌套数组：它包含一个数组，该数组又包含另一个数组。

```js
const array = [1, [2, [3]]];
//            ^^^^^^^^^^^^^ 外层数组
//                ^^^^^^^^  内层数组
//                    ^^^   更内层数组
```

`Array#flat` 将一个数组展平，并返回展平后的数组。

```js
array.flat();
// → [1, 2, [3]]

// …is equivalent to:
array.flat(1);
// → [1, 2, [3]]
```

默认深度为 `1`，但您可以传递任何数字以递归展平到该深度。如果想要递归展平一个数组，直到结果不再包含嵌套数组，可以传递 `Infinity`。

```js
// 递归展平数组，直到结果不再包含嵌套数组:
array.flat(Infinity);
// → [1, 2, 3]
```

为什么这个函数名字是 `Array.prototype.flat` 不是 `Array.prototype.flatten`？[阅读我们的 #SmooshGate 文章，了解相关信息！](https://developers.google.com/web/updates/2018/03/smooshgate)([中文版](https://zhuanlan.zhihu.com/p/34741293))

## `Array.prototype.flatMap` { #flatMap }

这是另一个例子。我们有一个 `duplicate`函数，它接受一个值作为参数，并返回一个包含该值两次的数组。如果我们对数组中的每个值调用 `duplicate` ，我们最终会得到一个嵌套数组。

```js
const duplicate = (x) => [x, x];

[2, 3, 4].map(duplicate);
// → [[2, 2], [3, 3], [4, 4]]
```

然后，您可以对结果调用 `flat` 来展平数组：

```js
[2, 3, 4].map(duplicate).flat(); // 🐌
// → [2, 2, 3, 3, 4, 4]
```

由于这种模式在函数式编程中非常常见，现在有一个专门的 `flatMap` 函数。

```js
[2, 3, 4].flatMap(duplicate); // 🚀
// → [2, 2, 3, 3, 4, 4]
```

`flatMap` 与单独执行 `flat` 并执行 `map` 相比，效率更高一些。

如果对 `flatMap` 感兴趣？查看 [Axel Rauschmayer 的解释](https://exploringjs.com/impatient-js/ch_arrays.html#flatmap-mapping-to-zero-or-more-values)。

## `Array#{flat,flatMap}` support { #support }

<feature-support chrome="69 /blog/v8-release-69#javascript-language-features"
                 firefox="62"
                 safari="12"
                 nodejs="11"
                 babel="yes https://github.com/zloirock/core-js#ecmascript-array"></feature-support>
