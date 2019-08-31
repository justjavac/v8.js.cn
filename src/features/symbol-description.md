---
title: '`Symbol.prototype.description`'
author: 'Mathias Bynens ([@mathias](https://twitter.com/mathias))'
avatars:
  - 'mathias-bynens'
date: 2019-06-25
tags:
  - ECMAScript
  - ES2019
description: 'Symbol.prototype.description provides an ergonomic way of accessing the description of a Symbol.'
tweet: '1143432835665211394'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，[v8.js.cn](https://v8.js.cn) 站长'
  avatars:
    - justjavac
---
JavaScript 的 `Symbol` 可以在创建时给出描述：

```js
const symbol = Symbol('foo');
//                    ^^^^^
```

以前，访问此描述的唯一方法是以编程方式间接通过 `Symbol.prototype.toString()`：

```js
const symbol = Symbol('foo');
//                    ^^^^^
symbol.toString();
// → 'Symbol(foo)'
//           ^^^
symbol.toString().slice(7, -1); // 🤔
// → 'foo'
```

但是，代码看起来有些神奇，不是很明显，并且违反了“明确意图，而非实现”的原则。上述技术也不允许您区分没有描述的符号（即 `Symbol()`）和空字符串作为描述的符号（即 `Symbol('')`）。

[The new `Symbol.prototype.description` getter](https://tc39.es/ecma262/#sec-symbol.prototype.description) 提供了一种更符合人体工程学的方式来访问Symbol：

```js
const symbol = Symbol('foo');
//                    ^^^^^
symbol.description;
// → 'foo'
```

对于没有描述的 `Symbol`，getter 方法返回 `undefined`：

```js
const symbol = Symbol();
symbol.description;
// → undefined
```

## `Symbol.prototype.description` support { #support }

<feature-support chrome="70 /blog/v8-release-70#javascript-language-features"
                 firefox="63"
                 safari="12.1"
                 nodejs="12 https://twitter.com/mathias/status/1120700101637353473"
                 babel="yes"></feature-support>
