---
title: 'V8 中的排序'
author: 'Simon Zünd ([@nimODota](https://twitter.com/nimODota)), consistent comparator'
avatars:
  - simon-zuend
date: 2018-09-28 11:20:37
tags:
  - ECMAScript
  - internals
description: 'Starting with V8 v7.0 / Chrome 70, Array.prototype.sort is stable.'
tweet: '1045656758700650502'
cn:
  author: '[@froyog](https://github.com/froyog). Life was short, used python'
  avatars:
    - froyog
---

`Array.prototype.sort` 是 V8 中仅存的几个仍使用自托管 Javascript 实现的内置函数。移植它给了我们一个机会，让我们可以探索几种不同的算法及其实现策略，最终在 V8 v7.0 / Chrome 70 中让它成为了 [稳定算法](https://mathiasbynens.be/demo/sort-stability)。

## 背景 {#background}

在 Javascript 中排序很难。这篇博客旨在分析排序算法和 Javascript 语言的交集中的一些怪癖，并且讲述我们是如何让 V8 的排序实现变为稳定的，性能更加可预测的排序。

对比不同的排序算法时，我们常常关注它们最坏情况和平均情况下的性能。它们是由渐进增长的边界条件给出的（比如说，大 O 表示法）内存使用或比较次数。注意在 Javascript 这样的动态语言中，比较操作通常比内存访问昂贵一个数量级。这是由于在排序时比较两个值常常涉及到调用用户代码。

让我们来看一个简单的例子：基于用户提供的比较函数，对一些数进行升序排序。这是一个 **稳定** 的比较函数，在被比较的一个数小于另一个数时，返回 `-1`（或任意负数）；相等时，返回 `0`；大于时，返回 `1`（或任意正数）。如果某个比较函数不符合这种形式，它就是 **不稳定** 的，而且可能产生任意的副作用，比如修改了它想要排序的数组。

```js
const array = [4, 2, 5, 3, 1];

function compare(a, b) {
  // 任意代码，比如 `array.push(1)`。
  return a - b;
}

// 一个“典型”的排序调用。
array.sort(compare);
```

即使是在下面的例子中，用户代码也可能会被调用。“默认”的比较函数对两个参数调用 `toString`，并对返回的字符串按字典序排序。

```js
const array = [4, 2, 5, 3, 1];

array.push({
  toString() {
    // 任意代码，比如 `array.push(1)`。
    return '42';
  }
});

// 不传入比较函数来调用 sort。
array.sort();
```

### 引入访问器和原形作用链 {#accessors-prototype}

这部分我们要将规范抛在脑后，看看“实现定义（implementation-defined）”的行为。规范中规定了一系列的情况，在这些条件下，引擎可以任意处理对象或数组的排序，或者根本不排序。引擎仍然要遵守一些基本原则，但其余的可以完全不顾。一方面来说，这给予了引擎开发者相当大的自由来试验不同的实现方式。另一方面来说，尽管规范没有这方面的规定，用户仍期望着（引擎的）一些合理行为。然而所谓“合理行为”很难定义，这又加剧了问题的复杂性。

这部分要向你展示在 `Array#sort` 的某些方面中，不同引擎的行为差别很大。这些情况不太可能出现，而且依上文，我们很那说“正确的做法”究竟是什么。我们 **强烈不建议** 你写这种代码，引擎是不会优化它们的。

第一个例子给出了一个带有访问器（例如 getter 和 setter）的数组以及不同引擎的“调用顺序”。访问器是第一个“由具体实现决定输出数组排序”的第一种情况：

```js
const array = [0, 1, 2];

Object.defineProperty(array, '0', {
  get() { console.log('get 0'); return 0; },
  set(v) { console.log('set 0'); }
});

Object.defineProperty(array, '1', {
  get() { console.log('get 1'); return 1; },
  set(v) { console.log('set 1'); }
});

array.sort();
```

这是不同引擎的输出结果。注意它们没有对错之分——因为规范让引擎自行决定！

```
// Chakra
get 0
get 1
set 0
set 1

// JavaScriptCore
get 0
get 1
get 0
get 0
get 1
get 1
set 0
set 1

// V8
get 0
get 0
get 1
get 1
get 1
get 0

#### SpiderMonkey
get 0
get 1
set 0
set 1
```

下一个例子展示了原型作用链的影响。简短起见我们不再显示调用栈。

```js
const object = {
 1: 'd1',
 2: 'c1',
 3: 'b1',
 4: undefined,
 __proto__: {
   length: 10000,
   1: 'e2',
   10: 'a2',
   100: 'b2',
   1000: 'c2',
   2000: undefined,
   8000: 'd2',
   12000: 'XX',
   __proto__: {
     0: 'e3',
     1: 'd3',
     2: 'c3',
     3: 'b3',
     4: 'f3',
     5: 'a3',
     6: undefined,
   },
 },
};
Array.prototype.sort.call(object);
```

输出显示了排序后的 `object`。同样，这里没有所谓的正确结果。这个例子只是想展示当索引属性和原型作用链相互影响时，事情会变得多么怪异：

```js
// Chakra
['a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e3', undefined, undefined, undefined]

// JavaScriptCore
['a2', 'a2', 'a3', 'b1', 'b2', 'b2', 'c1', 'c2', 'd1', 'd2', 'e3', undefined]

// V8
['a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e3', undefined, undefined, undefined]

// SpiderMonkey
['a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e3', undefined, undefined, undefined]
```

### V8 在排序前做了什么 {#before-sort}

V8 在排序前会进行两个预处理步骤。首先，如果被排序的对象的原型作用链上有洞（hole）或元素（element），V8 会把它们从原型链上拷贝到对象本身上来。这样一来我们在接下来的步骤中就不同考虑原型链的问题了。V8 只在非 `JSArray` 上才会这样做，但其他引擎在 `JSArray` 上也这么做。

<figure>
  <img src="/_img/array-sort/copy-prototype.svg" alt="">
  <figcaption>从作用链中拷贝</figcaption>
</figure>

第二个预处理步骤是移除洞。排序范围内的所有元素会被移到对象最前面。随后所有 `undefined` 被移到其后。某种程度上来说这是规范要求的，它规定 `undefined` **必须** 排在末尾。所以如果排序的参数是 `undefined`，用户提供的比较函数永远不会被调用。第二步预处理结束后排序算法只需考虑所有非 `undefined` 的元素了，这潜在地减少了需要排序的元素。

<figure>
  <img src="/_img/array-sort/remove-array-holes.svg" alt="">
  <figcaption>移除洞，并把所有 <code>undefined</code> 移到末尾 </figcaption>
</figure>

## 历史 {#history}

`Array.prototype.sort` 和 `TypedArray.prototype.sort` 基于同一种 Javascript 实现的快速排序算法。算法本身很直接：快速排序的基础上对于短数组（长度小于 10）使用插入排序。当快速排序递归出一个长度小于 10 的子数组时也使用插入排序。因为插入排序对较短数组更高效。这是因为快排在每次分割后要递归两次，而每次递归都要建立并丢弃一个栈（stack frame）。

选择一个合适的主元（pivot）对于快排的性能有很大影响。V8 使用如下两种策略来选择主元：

- 在给定子数组的第一个、最后一个、三分之一点的元素中选择它们的中位数作为主元。对于较短数组，三分之一点的元素就是中间（二分之一点）的元素。
- 如果数组较长，就从中抽取一个样本数组，对它排序，然后取出其中位数作为上述计算中的“三分之一点元素”。

快排的其中一个好处就是它就地排序（in-place）。只有排序长数组时抽取样本数组需要分配一点额外内存，以及 log(n) 的栈空间。坏处就是它不是一个稳定算法，而且最坏情况下时间复杂度为 O(n^2)。

### 介绍 V8 Torque {#introducing-v8-torque}

作为 V8 博客狂热读者的你也许听说过 [`CodeStubAssembler`](/blog/csa)，简称 CSA。CSA 是一个 V8 组件，允许我们用 C++ 编写低等级 TurboFan IR，随后被 TurboFan 后端翻译成合适架构的机器码。

CSA 重度应用于给 Javascript 内置函数编写所谓“快速路径”。一个内置函数的快速路径版本通常会检查它是否含有特定“不变性”（例如原型链上没有元素，没有访问器等等），随后使用更快的、更具体的操作来实现内置函数的功能。这样一来执行时间会比通用版本快一个数量级。

CSA 的坏处在于它真的就是汇编语言。流程控制使用明确的 `label` 和 `goto`，这意味着用 CSA 实现更复杂的算法时代码会变得难以阅读，容易出错。

接下来说 [V8 Torque](/docs/torque)。Torque 是一个领域专用语言，拥有着类似 TypeScript 的语法，CSA 是它的唯一编译目标。Torque 可以提供与 CSA 几乎相同层次的控制，同时提供一些高级特性，例如 `while` 和 `for` 循环。而且它是强类型的，未来还会引入像自动越界检查这样的安全检查，为 V8 开发者们提供了更强有力的保证。

最先用 V8 Torque 重写的内置函数是 [`TypedArray#sort`](/blog/v8-release-68) 和 [`Dataview` 操作](/blog/dataview)。它们都为 Torque 开发者们提供了反馈，帮助他们决定还需要哪些语言特性，使用哪些模式来让编写内置函数更加高效。在本篇成文时，数个 `JSArray` 内置函数以及它们的自托管 Javascript 实现已经迁移到 Torque（比如 `Array#unshift`），还有一些被完全重写（例如 `Array#slice` 和 `Array#reverse`）。

### 将 `Array#sort` 迁移到 Torque {#moving-array%23sort-to-torque}

最初的 `Array#sort` Torque 版本或多或少是其 Javascript 实现的直接移植。唯一的区别是对长数组不再抽取样本数组，而是选择一个随机元素用于主元计算。

This worked reasonably well, but as it still utilized Quicksort, `Array#sort` remained unstable. [The request for a stable `Array#sort`](https://bugs.chromium.org/p/v8/issues/detail?id=90) is among the oldest tickets in V8’s bug tracker. Experimenting with Timsort as a next step offered us multiple things. First, we like that it’s stable and offers some nice algorithmic guarantees (see next section). Second, Torque was still a work-in-progress and implementing a more complex builtin such as `Array#sort` with Timsort resulted in lots of actionable feedback influencing Torque as a language.

这个实现得相当好，但由于它仍采用快速排序，`Array#sort` 还是不稳定排序。[对 `Array#sort` 稳定的要求](https://bugs.chromium.org/p/v8/issues/detail?id=90) 是 V8 bug 追踪器中最古老的工单之一。下一步对 Timsort 的实验性工作会带给我们很多益处。首先，我们很喜欢的是它是一个稳定排序，并且提供了一些很棒的算法保证（查看下节）。其次 Torque 仍是一个开发中的项目，用 Timsort 实现像 `Array#sort` 这么复杂的内置函数，一定会对 Torque 语言本身产生很多建设性反馈。

## Timsort

Timsort，最初由 Tim Peters 在 2002 年为 Python 所开发，可以被称为是一个自适应的稳定归并排序的变种。其细节比较复杂，最好参阅[作者本人](https://github.com/python/cpython/blob/master/Objects/listsort.txt)或[维基百科](https://en.wikipedia.org/wiki/Timsort)的描述，但基础很容易理解。归并排序使用递归，而 Timsort 使用迭代。算法从左向右处理一个数组并且寻找所谓的 run。run 就是已排好序的序列。当然这也包括逆向排好序的序列，因为这样的序列只需翻转（reverse）一下就可以形成一个 run。排序的一开始算法会根据输入数组的长度来决定 run 的最小长度，如果算法没有找到自然形成的具有这样最小长度的 run，它就会使用插入排序人工生成一个。

找到的 run 会记录在一个栈中，这个栈会记录每个 run 的起始位置和长度。栈中的 run 会时不时的被合并，直到最后只剩一个排好序的 run。在决定要合并哪些 run 的时候，算法会试图保持平衡。一方面你想要尽可能早地合并，因为 run 的数据很可能还在缓存之中。另一方面你想尽可能晚地合并，因为这时可以利用数据中可能出现的某些共同规律。为了做到这一点，Timsort 维护着两条原则。假设 `A`，`B`，`C` 是三个最顶端的 run：

- `|C| > |B| + |A|`
- `|B| > |A|`

<figure>
  <img src="/_img/array-sort/runs-stack.svg" alt="">
  <figcaption><code>A</code> 与 <code>B</code> 合并前后的栈</figcaption>
</figure>

图中的情况下 `|A| > |B|` 所以 `B` 被合并到两者中较小的 run 中。

注意 Timsort 只合并连续的 run，这是保持其稳定性所必需的，否则相等的元素会在不同的 run 中互相转移。另外，第一条原则保证了 run 的长度最差也会以斐波那契数列增长，这样知道了最大数组长度之后 run 栈的大小的上界也就随之确定了。

现在你可以看出，一个已排序序列在 Timsort 排序时时间复杂度是 O(n)，因为这样的数组会被分在一个 run 中，无需被合并。而最坏情况是 O(n log n)。出于这样的算法性能，以及其稳定的特性，是我们最终选用 Timsort 而非快速排序的几个原因之一。

### 在 Torque 中实现 Timsort {#implementing-timsort-in-torque}

内置函数通常有不同的代码路径（code-path），在运行时基于各种各样的变量选择一个。最通用的版本可以处理任何对象，不管是 `JSProxy`，还是拥有拦截器的对象，或者是查找/设置属性时需要查询原型链的对象。

大多数情况下通用路径是很慢的，因为它需要考虑所有可能性。但如果我们提前就知道要排序的对象只是包含小整数的 `JSArray`，所有昂贵的 `[[Get]]` 和 `[[Set]]` 都可以用简单的 `FixedArray` 载入和储存来替换。唯一的不同就是 [`ElementsKind`](/blog/elements-kinds)。

现在的问题变成了我们如何实现一个快速路径。核心算法不管怎么样都是一样的，但我们获取元素的方式取决于 `ElementsKind`。一种实现方法是我们为每一种调用形式分配正确的“访问器（accessor）”。想象一下每一个载入/储存操作都对应一个开关，通过这个开关我们即可选择想要的分支，以对应选择的路径。

另一个解决方案（也是我们此前试过的方法）是为每一条路径、每一个载入/储存方法拷贝一遍整个内置函数。这样做对于 Timsort 来说是不可行的，因为它是一个很大的内置函数。每一个路径都拷贝一遍内置函数总共需要 106 KB 的空间，这对于一个内置函数来说太大了。

最终方案有一点不同。每一种路径的每个载入/储存操作被放置在了它的“迷你内置函数”中。下面的代码展示了 `FixedDoubleArray` 的“载入”操作。

```torque
Load<FastDoubleElements>(
    context: Context, sortState: FixedArray, elements: HeapObject,
    index: Smi): Object {
  try {
    const elems: FixedDoubleArray = UnsafeCast<FixedDoubleArray>(elements);
    const value: float64 =
        LoadDoubleWithHoleCheck(elems, index) otherwise Bailout;
    return AllocateHeapNumberWithValue(value);
  }
  label Bailout {
    // 预处理步骤通过把所有元素移到数组最前的方式
    // 已经移除了所有的孔。这时找到了孔说明 cmp 函数
    // 或 ToString 改变了数组本身。
    return Failure(sortState);
  }
}
```

比较一下，最通用的“载入”操作只是简单地调用 `GetProperty`。而上方的版本产生了高效快速的机器码，来载入并转换一个 `Number`。而 `GetProperty` 是对另一个内置函数的调用，这可能会引发原型链搜索或者调用一个访问器。

```js
builtin Load<ElementsAccessor : type>(
    context: Context, sortState: FixedArray, elements: HeapObject,
    index: Smi): Object {
  return GetProperty(context, elements, index);
}
```

这样一来一个快速路径就变成了一系列函数指针。这意味着我们只需一份核心算法的实现，然后提前好设定所有相关函数指针。这显著降低了代码体积（降至 20k），但代价是，每个调用点都会产生非直接分支。而这种现象随着近期 [embedded builtins](/blog/embedded-builtins) 的引入加剧了。

### 排序状态 {#sort-state}

<figure>
  <img src="/_img/array-sort/sort-state.svg" alt="">
</figure>

上图展示了“排序状态”。这是一个 `FixedArray`，它记录了所有排序时需要的东西。每次调用 `Array#sort`，就会创建这样一个排序状态。索引 4 到 7 是一系列函数指针，构成了一个快速路径，正如上文中我们讨论的那样。

每次用户的 Javascript 代码返回时，“check” 内置函数就会被调用，以检查我们能否继续当前的快速路径。它会用 “initial receiver map” 和 “initial receiver length” 来做检查。如果用户代码更改了当前对象，我们就会放弃整个排序进程，把所有指针重置为最通用的一版然后重新开始。第 8 个位置的 “bailout status” 记录了这样的重置。

“compare” 可以指向两个不同的内置函数。一个调用用户提供的比较函数，另一个是默认比较函数，它会对每一个参数执行 `toString` 然后按字典序比较。

其他索引（除了 fast path id）都与 Timsort 有关。run 栈（上文讨论过）初始化时长度为 85，足以排序一个长度为 2<sup>64</sup> 的数组。临时数组（temporary array） 用于合并 run。它的长度会根据需要增长，但永远不会超过 `n/2`，`n` 为输入数组长度。

### 性能妥协 {#performance-trade-offs}

将排序从自托管 Javascript 迁移到 Torque 牺牲了一些性能。`Array#sort` 使用 Torque 编写后，它成为了静态编译的代码。这意味着我们仍可以为不同的 [`ElementsKind`](/blog/elements-kinds) 构建快速路径，但它永远不会比 TurboFan 高度优化的代码更快，因为它们可以根据类型的反馈来调整。另一方面，如果代码不够“热”，不足以保证 JIT 编译，或者调用点是复态（megamorphic）的，我们就会卡在解释器或者很慢的通用版本那里。自托管 Javascript 中的解析，编译和可能存在的优化过程，在 Torque 中的都不需要了。

尽管 Torque 版本排序无法达到相同的巅峰性能，它却避免了性能断崖。而且它的排序性能比之前更容易预测了。记住 Torque 仍在开发中，它目前已 CSA 为编译目标。未来可能会以 TurboFan 为目标，可以用 Torque 编写 JIT 编译代码。

### 微基准测试 {#microbenchmarks}

我们开始开发 `Array#sort` 之前，我们添加了一些微型基准测试（micro-benchmarks）来更好地了解重写后会造成什么影响。第一张表展示了“正常”使用情况，使用用户提供的比较函数对不同 ElementsKind 进行排序。

注意这些情况下 JIT 编译器会做很多工作，因为排序几乎都是我们（用户）做的。同时 Javascript 版本中优化编译器也可以内联比较函数，而我们在 Torque 版本有内置函数到 Javascript 的额外开销。尽管如此，我们还是在几乎所有情景下取得了更好的性能。

<figure>
  <img src="/_img/array-sort/micro-bench-basic.svg" alt="">
</figure>

下一张表展示了对已排序数组或含有已排序的子序列的数组进行排序时 Timsort 的威力。表中用快速排序做基准，显示了 Timsort 的速度提升（最高在 DownDown 中提升了 17 倍，这个数组是由两个反向排序的序列组成的）。如你所见，除了随机数据以外，Timsort 在其它所有情景中性能更好。尽管我们排序的对象是 `PACKED_SMI_ELEMENTS`，在上个测试中它的快速排序的性能优于 Timsort。

<figure>
  <img src="/_img/array-sort/micro-bench-presorted.svg" alt="">
</figure>

### Web 工具基准测试 {#web-tooling-benchmark}

[Web 工具基准测试](https://github.com/v8/web-tooling-benchmark) 是一系列对 web 开发者使用的工具（例如 Babel 或 Typescript）的测试。表中用快速排序做基准，比较了 Timsort 的速度提升。除了 chai 我们在几乎所有测试中获得了相同的性能。

<figure>
  <img src="/_img/array-sort/web-tooling-benchmark.svg" alt="">
</figure>

chai 的测试花费了 **三分之一** 的时间在一个比较函数里面（字符串距离计算）。性能测试是 chai 的测试套件本身。由于这些数据，Timsort 在这种情况下需要进行更多比较，进而对整体时间消耗造成了很大影响，因为一大部分时间都在比较函数中消耗了。

### 内存影响 {#memory-impact}

浏览 50 个网页（手机端和桌面端都有）然后分析 V8 堆快照显示，内存消耗既没有退步也没有进步。一方面来说，这很意外：从快速排序切换到 Timsort 需要临时数组用于合并 run，这样的数组会比（快排中使用的）抽样数组大得多。另一方面来说，这些临时数组生存时间很短（只在 `sort` 调用时存在），在 V8 新的内存空间中会被快速创建然后删除。

## 结论 {#conclusion}

总的来说 Torque 实现的 Timsort 表现出的算法性质和可预测行为，让我们觉得它比以前好得多。Timsort 将在 V8 v7.0 和 Chrome 70 中推出。Happy sorting!
