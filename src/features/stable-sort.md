---
title: '稳定的数组排序 `Array.prototype.sort`'
author: 'Mathias Bynens ([@mathias](https://twitter.com/mathias))'
avatars:
  - 'mathias-bynens'
date: 2019-07-02
tags:
  - ECMAScript
  - ES2019
  - io19
tweet: '1146067251302244353'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---
假设你有一个存储狗的数组 `doggos`，每只狗都有一个名字和评级。（如果这个例子听起来有些奇怪，你可能不知道有一个专门针对这个的 Twitter 账户...所以，不要问！）

```js
// 注意未排序的数组是按 `name` 排序的
const doggos = [
  { name: 'Abby',   rating: 12 },
  { name: 'Bandit', rating: 13 },
  { name: 'Choco',  rating: 14 },
  { name: 'Daisy',  rating: 12 },
  { name: 'Elmo',   rating: 12 },
  { name: 'Falco',  rating: 13 },
  { name: 'Ghost',  rating: 14 },
];
// 根据 `rating` 降序排列
// (这将会更改 `doggos` 本身)
doggos.sort((a, b) => b.rating - a.rating);
```

数组根据名字(`name`)按字母顺序预排序。要通过评级(`rating`)来排序（这样我们就可以获得评分最高的狗），我们使用 `Array#sort`，传入一个比较评级的自定义回调函数。这是您期望的结果：

```js
[
  { name: 'Choco',  rating: 14 },
  { name: 'Ghost',  rating: 14 },
  { name: 'Bandit', rating: 13 },
  { name: 'Falco',  rating: 13 },
  { name: 'Abby',   rating: 12 },
  { name: 'Daisy',  rating: 12 },
  { name: 'Elmo',   rating: 12 },
]
```

狗按等级排序，但在每个评级中，它们仍然根据名字按字母顺序排序。例如，Choco 和 Ghost 具有相同的等级 14，但 Choco 在排序结果中出现在 Ghost 之前，因为这也是他们在原始数组中的顺序。

然而，为了得到这个结果，JavaScript 引擎不能随意使用排序算法 - 它必须是所谓的“稳定排序”。很长一段时间，JavaScript 规范 `Array#sort` 不需要排序稳定性，而是将其留给实现。而且由于这种行为未指定，你也可能会得到这种结果：Ghost 现在突然出现在 Choco 之前：

```js
[
  { name: 'Ghost',  rating: 14 }, // 😢
  { name: 'Choco',  rating: 14 }, // 😢
  { name: 'Bandit', rating: 13 },
  { name: 'Falco',  rating: 13 },
  { name: 'Abby',   rating: 12 },
  { name: 'Daisy',  rating: 12 },
  { name: 'Elmo',   rating: 12 },
]
```

换句话说，JavaScript 开发人员不能依赖排序稳定性。在实践中，情况更令人愤怒，因为一些 JavaScript 引擎会对短数组使用稳定排序，对较大数组使用不稳定排序。这真的令人困惑，因为开发人员会测试他们的代码，看到稳定的结果，但是当数组稍微大一点时，突然会在生产环境中获得不稳定的结果。

但是有一些好消息。我们提出了一个 `Array#sort` 稳定性的[规范变化](https://github.com/tc39/ecma262/pull/1340)，它被接受了。现在所有主流的 JavaScript 引擎都实现了稳定 `Array#sort`。这是作为 JavaScript 开发人员一直担心的一件事。太帮了！

（哦，[我们为 `TypedArray` 做了同样的事情](https://github.com/tc39/ecma262/pull/1433)：它们的排序现在也稳定了。）

:::note
**注意:** 虽然现在规范要求排序必须具有稳定性，但 JavaScript 引擎仍然可以自由地实现他们喜欢的任何排序算法。例如，[V8 使用 Timsort](/blog/array-sort#timsort)。该规范并未强制要求任何特定的排序算法。
:::

## Feature support { #support }

### Stable `Array.prototype.sort` { #support-stable-array-sort }

<feature-support chrome="70 /blog/v8-release-70#javascript-language-features"
                 firefox="yes"
                 safari="yes"
                 nodejs="12 https://twitter.com/mathias/status/1120700101637353473"
                 babel="no"></feature-support>

### Stable `%TypedArray%.prototype.sort` { #support-stable-typedarray-sort }

<feature-support chrome="74 https://bugs.chromium.org/p/v8/issues/detail?id=8567"
                 firefox="67 https://bugzilla.mozilla.org/show_bug.cgi?id=1290554"
                 safari="yes"
                 nodejs="12 https://twitter.com/mathias/status/1120700101637353473"
                 babel="no"></feature-support>
