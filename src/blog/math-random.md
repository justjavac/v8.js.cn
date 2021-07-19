---
title: '已有的 `Math.random()`，后来的 `Math.random()`'
author: 'Yang Guo ([@hashseed](https://twitter.com/hashseed)), software engineer and dice designer'
avatars:
  - 'yang-guo'
date: 2015-12-17 13:33:37
tags:
  - ECMAScript
  - internals
description: 'V8 的 Math.random 实现现在使用称为 xorshift128+ 的算法，与旧的 MWC1616 实现相比，提高了随机性。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
> `Math.random()` 返回一个带有正号的 `Number` 值，大于或等于 `0` 但小于 `1`，使用依赖于实现的算法或策略随机或伪随机选择并在该范围内近似均匀分布。这个函数没有参数。

— _[ES 2015, section 20.2.2.27](http://tc39.es/ecma262/#sec-math.random)_

`Math.random()` 是 Javascript 中最著名和最常用的随机源。在 V8 和大多数其他 Javascript 引擎中，它是使用[伪随机数生成器](https://en.wikipedia.org/wiki/Pseudorandom_number_generator) (pseudo-random number generator，PRNG) 实现的。与所有 PRNG 一样，随机数源自内部状态，对于每个新随机数，该状态由固定算法更改。所以对于给定的初始状态，随机数序列是确定性的。由于内部状态的位大小 n 是有限的，因此 PRNG 生成的数字最终会重复。这个[置换循环（permutation cycle）](https://en.wikipedia.org/wiki/Cyclic_permutation)周期长度的上限是 2<sup>n</sup>。

有许多不同的 PRNG 算法；其中最著名的是 [Mersenne-Twister](https://en.wikipedia.org/wiki/Mersenne_Twister) 和 [LCG](https://en.wikipedia.org/wiki/Linear_congruential_generator)。每个都有其特定的特点、优点和缺点。理想情况下，它会为初始状态使用尽可能少的内存，执行速度快，周期长度大，并提供高质量的随机分布。虽然可以轻松测量或计算内存使用、性能和周期长度，但质量更难确定。统计测试背后有很多数学运算来检查随机数的质量。事实上的标准 PRNG 测试套件 [TestU01](http://simul.iro.umontreal.ca/testu01/tu01.html) 实现了其中的许多测试。

直到[最近](https://github.com/v8/v8/blob/ceade6cf239e0773213d53d55c36b19231c820b5/src/js/math.js#L143)（直到版本 4.9.40），V8 选择的 PRNG 还是 MWC1616（乘以进位，结合两个 16 位部分）。它使用 64 位内部状态，大致如下所示：

```cpp
uint32_t state0 = 1;
uint32_t state1 = 2;
uint32_t mwc1616() {
  state0 = 18030 * (state0 & 0xFFFF) + (state0 >> 16);
  state1 = 30903 * (state1 & 0xFFFF) + (state1 >> 16);
  return state0 << 16 + (state1 & 0xFFFF);
}
```

然后根据规范将 32 位值转换为介于 0 和 1 之间的浮点数。

MWC1616 使用很少的内存并且计算速度非常快，但不幸的是提供低于标准的质量：

- 它可以生成的随机值的数量限制为 2<sup>32</sup> 个，而双精度浮点数可以表示 0 到 1 之间的 2<sup>52</sup> 个数字。
- 结果的更重要的上半部分几乎完全取决于 state0 的值。周期长度最多为 2<sup>32</sup>，但不是几个大的置换周期，而是许多短的置换周期。如果初始状态选择不当，周期长度可能小于 4000 万。
- 它未能通过 TestU01 套件中的许多统计测试。

已经向我们[指出](https://medium.com/@betable/tifu-by-using-math-random-f1c308c4fd9d)了这一点，并且了解了问题并经过一些研究后，我们决定基于称为 [xorshift128+](http://vigna.di.unimi.it/ftp/papers/xorshiftplus.pdf) 的算法重新实现 `Math.random`。它使用 128 位内部状态，周期长度为 2<sup>128</sup> - 1，并通过了 TestU01 套件的所有测试。

```cpp
uint64_t state0 = 1;
uint64_t state1 = 2;
uint64_t xorshift128plus() {
  uint64_t s1 = state0;
  uint64_t s0 = state1;
  state0 = s0;
  s1 ^= s1 << 23;
  s1 ^= s1 >> 17;
  s1 ^= s0;
  s1 ^= s0 >> 26;
  state1 = s1;
  return state0 + state1;
}
```

在我们意识到这个问题的几天内，新的实现[就登陆了 V8 v4.9.41.0](https://github.com/v8/v8/blob/085fed0fb5c3b0136827b5d7c190b4bd1c23a23e/src/base/utils/random-number-generator.h#L102)。它将在 Chrome 49 中可用。[Firefox](https://bugzilla.mozilla.org/show_bug.cgi?id=322529#c99) 和 [Safari](https://bugs.webkit.org/show_bug.cgi?id=151641) 也都切换到 xorshift128+。

但是请不要误会：尽管 xorshift128+ 是对 MWC1616 的巨大改进，但它仍然不是[加密安全的](https://en.wikipedia.org/wiki/Cryptographically_secure_pseudorandom_number_generator)。对于散列、签名生成和加密/解密等用例，普通的 PRNG 是不合适的。Web Cryptography API 引入了 [`window.crypto.getRandomValues`](https://developer.mozilla.org/en-US/docs/Web/API/RandomSource/getRandomValues)，这是一种以性能为代价返回加密安全随机值的方法。

请记住，如果你发现 V8 和 Chrome 有改进的地方，即使是像这个这样的地方，也不会直接影响规范合规性、稳定性或安全性，请在[我们的错误跟踪器上提交问题](https://bugs.chromium.org/p/v8/issues/entry?template=Defect%20report%20from%20user)。
