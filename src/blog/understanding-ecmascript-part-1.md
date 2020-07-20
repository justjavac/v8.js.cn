---
title: '理解 ECMAScript 规范, 第1部分'
author: '[Marja Hölttä](https://twitter.com/marjakh), speculative specification spectator'
avatars:
  - marja-holtta
date: 2020-02-03 13:33:37
tags:
  - ECMAScript
description: 'Tutorial on reading the ECMAScript specification'
tweet: '1224363301146189824'
cn:
  author: 'Vincent Wang ([@Vincent0700](https://github.com/Vincent0700))。<br/>Blog：[https://vincentstudio.info](https://vincentstudio.info)'
  avatars: 
    - vincent-wang
---
在这篇文章里，我们取规范中一个简单的函数并尝试理解他的符号。让我们开始吧！

## 前言 {#preface}

即使你知道 JavaScript，读它的语言规范, [ECMAScript Language specification, or the ECMAScript spec for short](https://tc39.es/ecma262/)，也可能会令人生畏，至少我第一次读它的时候是这样想的。

让我们从一个具体的示例开始，通过阅读规范来理解它。以下代码演示了 `Object.prototype.hasOwnProperty` 的使用：

```js
const o = { foo: 1 };
o.hasOwnProperty('foo'); // true
o.hasOwnProperty('bar'); // false
```

在案例中，`o` 没有 `hasOwnProperty` 这个属性，所以我们沿着原型链寻找它。我们在 `o` 的原型链上找到它，也就是 `Object.prototype`。

为了描述 `Object.prototype.hasOwnProperty` 是如何工作的，规范使用类似伪代码的描述:

> **[`Object.prototype.hasOwnProperty(V)`](https://tc39.es/ecma262#sec-object.prototype.hasownproperty)**
>
> 当使用参数 `V` 调用 `hasOwnProperty` 方法时，会采取以下步骤：
>
> 1. Let `P` be `? ToPropertyKey(V)`.
> 2. Let `O` be `? ToObject(this value)`.
> 3. Return `? HasOwnProperty(O, P)`.

然后。。。

> **[`HasOwnProperty(O, P)`](https://tc39.es/ecma262#sec-hasownproperty)**
>
> 抽象操作 `HasOwnProperty` 用于确定对象是否具有带有指定属性的自己的属性。返回一个布尔值。该操作使用参数 `O` 和 `P` 进行调用，其中 `O` 是对象，`P` 是属性。此抽象操作执行以下步骤：
>
> 1. Assert: `Type(O)` is `Object`.
> 2. Assert: `IsPropertyKey(P)` is `true`.
> 3. Let `desc` be `? O.[[GetOwnProperty]](P)`.
> 4. If `desc` is `undefined`, return `false`.
> 5. Return `true`.

但是什么是 “抽象操作” ？`[[]]` 里有什么东西？为什么在函数前有一个问号？断言是什么意思？

让我们来看一看！

## 语言类型和规范类型 {#language-and-specification-types}

让我们从看起来熟悉的东西开始。规范上使用 `undefined`，`true` 和 `false` 等值，我们已经从JavaScript中知道这些值。他们都是 [**语言值**](https://tc39.es/ecma262/#sec-ecmascript-language-types), 也是规范中定义的 **语言类型** 的值。

规范还在内部使用语言值，例如，内部数据类型可能包含一个字段，其可能值为 `true` 和 `false`。相反，JavaScript 引擎通常在内部不使用语言值。例如，如果 JavaScript 引擎是用 C++ 编写的，则通常会使用 C++ 的 `true` 和 `false`（而不是其 JavaScript 的 `true` 和 `false` 的内部表示形式）。

除语言类型外，规范还使用[**规范类型**](https://tc39.es/ecma262/#sec-ecmascript-specification-types)，这些类型仅在规范中出现，但不在 JavaScript 语言中。JavaScript 引擎不需要（但可以自由）实现它们。在此博客文章中，我们将了解规范类型 Record（及其子类型 Completion Record）。

## 抽象操作 {#abstract-operations}

[**抽象操作**](https://tc39.es/ecma262/#sec-abstract-operations) 是 ECMAScript 规范中定义的函数；定义它们是为了简洁地编写规范。JavaScript 引擎不必将其作为单独的函数实现在引擎内部。不能在 JavaScript 直接调用它们。

## 内部插槽和内部方法 {#internal-slots-and-methods}

[**内部插槽** and **内部方法**](https://tc39.es/ecma262/#sec-object-internal-methods-and-internal-slots) 使用 `[[ ]]` 中包含的名称.

内部插槽是 JavaScript 对象或规范类型的数据成员。它们用于存储对象的状态。内部方法是 JavaScript 对象的成员函数。

例如，每个JavaScript对象都有一个内部插槽 `[[Prototype]]` 和一个内部方法 `[[GetOwnProperty]]`.

我们无法从 JavaScript 中访问内部插槽和方法。例如，您无法访问 `o.[[Prototype]]` 或者调用 `o.[[GetOwnProperty]]()`。JavaScript 引擎可以实现它们以供内部使用，但不是必须的。

有时内部方法委托给相似名称的抽象操作，例如在普通对象的 `[[GetOwnProperty]]` 中：

> **[`[[GetOwnProperty]](P)`](https://tc39.es/ecma262/#sec-ordinary-object-internal-methods-and-internal-slots-getownproperty-p)**
>
> 使用属性 `P` 调用 `O` 的 `[[GetOwnProperty]]` 的内部方法时，将执行以下步骤：
>
> Return `! OrdinaryGetOwnProperty(O, P)`.

（我们将在下一章中找出感叹号的含义）

`OrdinaryGetOwnProperty` 不是内部方法，因为它未与任何对象关联；而是将对其进行操作的对象作为参数传递。

因为 `OrdinaryGetOwnProperty` 只对普通对象对象起作用，所以它被称为 “普通的”。ECMAScript 对象可以是 **普通的** 或者 **奇异的**。普通对象必须具有称为 **基本内部方法** 的一组方法的默认行为。如果某个对象偏离默认行为，则该对象是奇异的。

最著名的奇异对象是 `Array`，因为其 length 属性的行为方式不是默认的：设置 `length` 属性可以从 `Array` 中删除元素。

基本的内部方法在 [这里](https://tc39.es/ecma262/#table-5) 列出。

## Completion records {#completion-records}

问号和感叹号是什么呢？要了解它们，我们需要查看 [**Completion Records**](https://tc39.es/ecma262/#sec-completion-record-specification-type)！

Completion Record 是一种规范类型（仅出于规范目的而定义）。JavaScript 引擎不必具有相应的内部数据类型。

Completion Record 是一种 “记录” —— 一种具有一组固定的命名字段的数据类型。一个 Completion Record 包含三个字段：

:::table-wrapper
| 名称 | 描述 |
--- | ---
| `[[Type]]` | `normal`，`break`，`continue`，`return` 或 `throw` 之一。除了 `normal` 以外的其他类型都是 **突然中止**.|
| `[[Value]]` | 结束时产生的值，例如，函数的返回值或异常（如果引发了异常）。|
| `[[Target]]` | 用于定向控制转移（与本博客文章无关）|
:::

每个抽象操作都隐式返回一个 Completion Record。即使看起来抽象操作会返回一个简单的类型，例如Boolean，它也将被隐式包装为具有 `normal` 类型的 Completion Record (请参见 [Implicit Completion Values](https://tc39.es/ecma262/#sec-implicit-completion-values)).

注1：规范在这方面并不完全一致；有些帮助函数返回裸值，并且其返回值按原样使用，而无需从 Completion Record 中提取值。从上下文中通常可以清楚地看出这一点。

注2：规范的编辑人员正在研究如何使 Completion Record 的处理更加明确.

如果算法引发异常，则意味着返回带有 `[[Type]]` `throw` 的 Completion Record，它的 `[[Value]]` 是一个异常对象的。我们暂且忽略 `break`，`continue` 和 `return` 类型。

[`ReturnIfAbrupt(argument)`](https://tc39.es/ecma262/#sec-returnifabrupt) 意味着采取以下步骤：

> 1. If `argument` is abrupt, return `argument`
> 2. Set `argument` to `argument.[[Value]]`

也就是说，我们检查 Completion Record；如果是突然终止的类型，我们会立即返回。否则，我们从完成记录中提取值。

`ReturnIfAbrupt` 可能看起来像一个函数调用，但事实并非如此。它会导致返回 `ReturnIfAbrupt()` 的函数返回，而不是返回 `ReturnIfAbrupt` 函数本身的函数。它更像是C语言中的宏.

`ReturnIfAbrupt` 可以这样使用：

> 1. Let `obj` be `Foo()`. (`obj` 是一个 Completion Record。)
> 2. `ReturnIfAbrupt(obj)`
> 3. `Bar(obj)`. (如果程序能走到这，则 `obj` 是从 Completion Record 提取出的值。)

[问号](https://tc39.es/ecma262/#sec-returnifabrupt-shorthands) 的含义：`? Foo()` 等同于 `ReturnIfAbrupt(Foo())`.

同样，`Let val be ! Foo()` 等同于：

> 1. Let `val` be `Foo()`
> 2. Assert: `val` is not an abrupt completion
> 3. Set `val` to `val.[[Value]]`.

利用这些知识，我们可以像这样重写 `Object.prototype.hasOwnProperty`：

> **`Object.prototype.hasOwnProperty(P)`**
>
> 1. Let `P` be `ToPropertyKey(V)`.
> 2. If `P` is an abrupt completion, return `P`
> 3. Set `P` to `P.[[Value]]`
> 4. Let `O` be `ToObject(this value)`.
> 5. If `O` is an abrupt completion, return `O`
> 6. Set `O` to `O.[[Value]]`
> 7. Let `temp` be `HasOwnProperty(O, P)`.
> 8. If `temp` is an abrupt completion, return `temp`
> 9. Let `temp` be `temp.[[Value]]`
> 10. Return `NormalCompletion(temp)`

我们可以这样重写 `HasOwnProperty`：

> **`HasOwnProperty(O, P)`**
>
> 1. Assert: `Type(O)` is `Object`.
> 2. Assert: `IsPropertyKey(P)` is `true`.
> 3. Let `desc` be `O.[[GetOwnProperty]](P)`.
> 4. If `desc` is an abrupt completion, return `desc`
> 5. Set `desc` to `desc.[[Value]]`
> 6. If `desc` is `undefined`, return `NormalCompletion(false)`.
> 7. Return `NormalCompletion(true)`.

我们也可以重写不带感叹号的的内部方法 `[[GetOwnProperty]]`：

> **`O.[[GetOwnProperty]]`**
>
> 1. Let `temp` be `OrdinaryGetOwnProperty(O, P)`
> 2. Assert: `temp` is not an abrupt completion
> 3. Let `temp` be `temp.[[Value]]`
> 4. Return `NormalCompletion(temp)`

在这里，我们假设 `temp` 是一个全新的临时变量，不会与其他任何冲突。

我们还使用了以下知识：当 return 语句返回除 Completion Record 以外的其他内容时，它隐式包装在 `NormalCompletion` 中.

### 换个话题：`Return ? Foo()` {#side-track}

规范中使用 `Return ? Foo()` —— 为什么用问号

`Return ? Foo()` 展开如下：

> 1. Let `temp` be `Foo()`
> 2. If `temp` is an abrupt completion, return `temp`
> 3. Set `temp` to `temp.[[Value]]`
> 4. Return `NormalCompletion(temp)`

与 `Return Foo()` 相同；无论是突然终止还是正常终止，其行为方式都相同。

## 断言 {#asserts}

规范中断言了算法的不变条件。为了清楚起见，添加了它们，但没有对实现添加任何要求 —— 实现中不必检查它们。

## 继续 {#moving-on}

我们已经建立了阅读规范所需的知识，如 `Object.prototype.hasOwnProperty` 之类的简单方法和诸如 `HasOwnProperty` 之类的抽象操作。它们仍然会委托到其他抽象操作，但是基于此博客文章，我们应该能够弄清楚它们的作用。我们还将会遇到属性描述符，这是另一种规范类型。

<figure>
  <img src="/_img/understanding-ecmascript-part-1/call-graph.svg" width="1082" height="306" alt="Function call graph starting from Object.prototype.hasOwnProperty">
</figure>

## 有用的链接 {#usful-links}

[How to Read the ECMAScript Specification](https://timothygu.me/es-howto/): a tutorial which covers much of the material covered in this post, from a slightly different angle.
