---
title: '超快的 `super` 属性访问'
author: '[Marja Hölttä](https://twitter.com/marjakh), super optimizer'
avatars:
  - marja-holtta
date: 2021-02-18
tags:
  - JavaScript
description: 'Faster super property access in V8 v9.0'
tweet: '1362465295848333316'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---

[`super` 关键字](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/super)可用于访问对象的父对象的属性和函数。

以前，访问 super 属性（如 `super.x`）是通过运行时调用实现的。 从 V8 v9.0 开始，我们在未优化的代码中重用了[内联缓存 (IC) 系统](https://mathiasbynens.be/notes/shapes-ics)，并生成了用于 super 属性访问的应有的优化代码，而不必跳到运行时。

从下图中可以看到，由于运行时调用，super 属性访问曾经比普通属性访问慢一个数量级。现在，我们已经接近同等水平。

![将 super 属性访问与常规属性访问进行比较（已优化）](/_img/fast-super/super-opt.svg)

![将 super 属性访问与常规属性访问进行比较（未优化）](/_img/fast-super/super-no-opt.svg)

Super 属性访问很难进行基准测试，因为它必须发生在函数内部。我们无法对单个属性访问进行基准测试，而只能针对更大范围的工作。因此，函数调用开销包含在测量中。上面的图表在某种程度上低估了 super 属性访问和普通属性访问之间的区别，但它们的准确性足以说明新旧 super 属性访问之间的区别。

在未优化（解释）模式下，super 属性访问将总是比普通属性访问慢，因为我们需要做更多的工作（从上下文读取主对象，并从主对象读取 `__proto__`）。在优化的代码中，我们已经尽可能将主对象（home object）作为常量嵌入。也可以通过将其 `__proto__` 嵌入为常量来进一步改进。

### 原型继承和 `super` { #prototypal-inheritance-and-super }

让我们从基础开始 - super 属性访问真正意味着什么？

```javascript
class A { }
A.prototype.x = 100;

class B extends A {
  m() {
    return super.x;
  }
}
const b = new B();
b.m();
```

现在，`A` 是 `B` 的超类，`b.m()` 会按预期返回 `100`。

![类继承图](/_img/fast-super/inheritance-1.svg)

现实是 [JavaScript 的原型继承](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)更加复杂：

![原型继承图](/_img/fast-super/inheritance-2.svg)

我们需要仔细区分 `__proto__` 和 `prototype` 属性 - 它们并不代表同样的含义！让人更困惑的是，对象 `b.__proto__` 通常被称为“`b` 的原型”。

`b.__proto__` 对象是 `b` 的继承属性。`B.prototype` 作为使用 `new B()` 创建的对象的 `__proto__` 对象，即 `b.__proto__ === B.prototype`。

反过来，`B.prototype` 具有自己的 `__proto__` 属性，该属性等于 `A.prototype`。这些共同构成了所谓的原型链：

```
b ->
 b.__proto__ === B.prototype ->
  B.prototype.__proto__ === A.prototype ->
   A.prototype.__proto__ === Object.prototype ->
    Object.prototype.__proto__ === null
```

通过该链，`b` 可以访问在任何这些对象中定义的所有属性。方法 `m` 是 `B.prototype`的属性（即 `B.prototype.m`），这就是 `b.m()` 起作用的原因。

现在，我们可以将 `m` 内的 `super.x` 定义为属性查找（property lookup），在该属性查找中，我们开始在*主对象（home object）* 的 `__proto__` 中查找属性 `x`，并沿着原型链向上移动直到找到它。

主对象（home object）是定义方法的对象 - 在这种情况下，`m` 的主对象是 `B.prototype`。它的 `__proto__` 是 `A.prototype`，因此我们从这里开始寻找属性 `x`。 我们将 `A.prototype` 称为*查找起始对象（lookup start object）*。在这种情况下，我们可以在查找起始对象中立即找到属性 `x`，但通常它也可能位于原型链的更远处。

如果 `B.prototype` 具有一个名为 `x` 的属性，我们将忽略它，因为我们开始在原型链中的上方寻找它。另外，在这种情况下，超级属性查询不依赖于*接收者（receiver）*，即调用该方法时 `this` 值指向的对象。

```javascript
B.prototype.m.call(some_other_object); // still returns 100
```

如果该属性具有读取器（getter），则接收者（receiver）将作为 `this` 值传递给读取器。

总结一下：在 super 属性访问 `super.x` 中，查找起始对象是主对象的 `__proto__`，接收者是发生 super 属性访问的方法的接收者。

在普通的属性访问 `o.x` 中，我们开始在 `o` 中寻找属性 `x`，然后到原型链上。如果 `x` 恰好有一个读取器，我们还将使用 `o` 作为接收者 - 查找起始对象和接收者是同一对象（`o`）。

*Super 属性访问就像常规属性访问一样，其中查找起始对象（lookup start object）和接收者（receiver）不同。*

### 实现更快的 `super` { #implementing-faster-super }

以上的分析结论也是实现快速 super 属性访问的关键。V8 已经过设计，可以快速进行属性访问 - 现在，我们针对接收者和查找起始对象不同的情况将其通用化。

V8 的数据驱动的内联缓存系统是实现快速属性访问的核心部分。你可以在[高级介绍](https://mathiasbynens.be/notes/shapes-ics)中阅读相关内容，也可以了解 [V8 的对象表示](https://v8.dev/blog/fast-properties)以及 [V8 的数据驱动的内联缓存系统是如何实现的](https://docs.google.com/document/d/1mEhMn7dbaJv68lTAvzJRCQpImQoO6NZa61qRimVeA-k/edit?usp=sharing) 更多的细节描述。

为了提高 `super` 性能，我们添加了一个新的 [Ignition](https://v8.dev/docs/ignition) 节代码 `LdaNamedPropertyFromSuper`，它使我们能够以解释模式插入 IC 系统，并生成用于 super 属性访问的优化代码。

使用新的字节码，我们可以添加新的 IC，`LoadSuperIC`，以加速 super 属性加载。与处理正常属性加载的 `LoadIC` 相似，`LoadSuperIC` 会跟踪已看到的查找起始对象的形状（shapes），并记住如何从具有这些形状之一的对象中加载属性。

`LoadSuperIC` 将现有的 IC 机制重新用于属性加载，只是具有不同的查找起始对象。由于 IC 层已经在查找起始对象和接收者之间进行了区分，因此实现起来应该很容易。但是，由于查找起始对象和接收者始终是相同的，因此即使我们指的是接收者，也存在一些使用查找起始对象的错误，反之亦然。这些错误已得到修复，现在我们可以正确的支持查找起始对象和接收者不同的情况。

用于 super 属性访问的优化代码由 [TurboFan](https://v8.dev/docs/turbofan) 编译器的 `JSNativeContextSpecialization` 阶段生成。该实现概括了现有的属性查找机制（[`JSNativeContextSpecialization::ReduceNamedAccess`](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/compiler/js-native-context-specialization.cc;l=1130)），以处理接收者和查找起始对象不同的情况。

当我们将主对象从存储它的 `JSFunction` 中移出时，优化的代码变得更加优化。现在，它存储在类上下文中，这使 TurboFan 尽可能将其作为常量嵌入到优化的代码中。

## `super` 的其它用法 { #other-usages-of-super }

`super` 在对象字面（literal）方法内部的工作方式与类方法内部相同，并且进行了类似的优化。

```javascript
const myproto = {
  __proto__: { 'x': 100 },
  m() { return super.x; }
};
const o = { __proto__: myproto };
o.m(); // returns 100
```

当然，有些情况我们没有进行优化。例如，写入 super 属性（`super.x = ...`）并未得到优化。此外，使用 mixins 会使 access site 变成 megamorphic，从而导致 super 属性访问速度变慢：

```javascript
function createMixin(base) {
  class Mixin extends base {
    m() { return super.m() + 1; }
    //                ^ this access site is megamorphic
  }
  return Mixin;
}

class Base {
  m() { return 0; }
}

const myClass = createMixin(
  createMixin(
    createMixin(
      createMixin(
        createMixin(Base)
      )
    )
  )
);
(new myClass()).m();
```

要确保所有面向对象的模式都尽可能快，还有很多工作要做 - 敬请期待进一步的优化！
