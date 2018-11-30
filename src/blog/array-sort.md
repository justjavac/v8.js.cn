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
---
`Array.prototype.sort` was among the last builtins implemented in self-hosted JavaScript in V8. Porting it offered us the opportunity to experiment with different algorithms and implementation strategies and finally [make it stable](https://mathiasbynens.be/demo/sort-stability) in V8 v7.0 / Chrome 70.

## 背景 {#background}

Sorting in JavaScript is hard. This blog post looks at some of the quirks in the interaction between a sorting algorithm and the JavaScript language, and describes our journey to move V8 to a stable algorithm and make performance more predictable.

Javascript 中的排序很难。这篇博客旨在分析一个排序算法和 Javascript 语言本身的交集中的一些怪癖，并且讲述我们是如何让 V8 的排序实现变为稳定排序，性能更加可预测的排序。

When comparing different sorting algorithms we look at their worst and average performance given as a bound on the asymptotic growth (i.e. “Big O” notation) of either memory operations or number of comparisons. Note that in dynamic languages, such as JavaScript, a comparison operation is usually a magnitude more expensive than a memory access. This is due to the fact that comparing two values while sorting usually involves calls to user code.

对比不同的排序算法时，我们常常关注它们最坏情况和平均情况下的性能。它们是由渐进增长的边界条件给出的（比如说，O 记号）,要么是内存使用，要么是比较次数。注意在 Javascript 这样的动态语言中，比较操作通常是比内存访问昂贵一个数量级。这是由于在排序时比较两个值常常涉及到调用用户代码。

Let’s take a look at a simple example of sorting some numbers into ascending order based on a user-provided comparison function. A _consistent_ comparison function returns `-1` (or any other negative value), `0`, or `1` (or any other positive value) when the two provided values are either smaller, equal, or greater respectively. A comparison function that does not follow this pattern is _inconsistent_ and can have arbitrary side-effects, such as modifying the array it’s intended to sort.

让我们来看一个简单的例子：基于用户提供的比较函数，对一些数进行升序排序。这是一个 **稳定** 的比较函数，在被比较的一个数小于另一个数时，返回 `-1`（或任意负数）；相互等于时，返回 `0`；大于时，返回 `1`（或任意正数）。如果某个比较函数不符合这种形式，它就是 **不稳定** 的，而且可能产生任意的副作用，比如修改了它想要排序的数组。

```js
const array = [4, 2, 5, 3, 1];

function compare(a, b) {
  // Arbitrary code goes here, e.g. `array.push(1);`.
  // 任意代码，比如 `array.push(1)`
  return a - b;
}

// A “typical” sort call.
// 一个“典型”的排序调用
array.sort(compare);
```

Even in the next example, calls to user code may happen. The “default” comparison function calls `toString` on both values and does a lexicographical comparison on the string representations.

即使是在下面的例子中，用户代码也可能会被调用。“默认”的比较函数对两个值调用 `toString`，并对返回的字符串按字典序排序。

```js
const array = [4, 2, 5, 3, 1];

array.push({
  toString() {
    // Arbitrary code goes here, e.g. `array.push(1);`.
    // 任意代码，比如 `array.push(1)`
    return '42';
  }
});

// Sort without a comparison function.
// 不传入比较函数来调用 sort
array.sort();
```

### More fun with accessors and prototype-chain interactions{ #accessors-prototype }

### 引入访问器和原形作用链 {#accessors-prototype}

This is the part where we leave the spec behind and venture into “implementation-defined” behavior land. The spec has a whole list of conditions that, when met, allow the engine to sort the object/array as it sees fit — or not at all. Engines still have to follow some ground rules but everything else is pretty much up in the air. On the one hand, this gives engine developers the freedom to experiment with different implementations. On the other hand, users expect some reasonable behavior even though the spec doesn’t require there to be any. This is further complicated by the fact that “reasonable behavior” is not always straightforward to determine.

这部分我们要将规范抛在脑后，进入“实现定义（implementation-defined）”的行为的领域。规范中存在一系列的情况，在这些条件下，引擎对这些对象或数组任意排序，或根本不排序。引擎仍然要遵守一些基本原则，但其余的可以完全不顾。一方面来说，这给予了引擎开发者相当大的自由来试验不同的实现，另一方面来说，用户期望着（引擎的）一些合理行为，尽管规范没有这方面的规定。然而所谓“合理行为”很难定义，这又加剧了问题的复杂性。

This section shows that there are still some aspects of `Array#sort` where engine behavior differs greatly. These are hard edge cases, and as mentioned above it’s not always clear what “the right thing to do” actually is. We _highly_ recommend not writing code like this; engines won’t optimize for it.

这部分要向你展示在 `Array#sort` 的某些方面中，不同引擎的行为差别很大。这些情况不太可能出现，而且依上文，我们很那说“正确的做法”究竟是什么。我们 **强烈不建议** 你写这种代码，引擎是不会优化它们的。

The first example shows an array with some accessors (i.e. getters and setters) and a “call log” in different JavaScript engines. Accessors are the first case where the resulting sort order is implementation-defined:

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

Here’s the output of that snippet in various engines. Note that there are no “right” or “wrong” answers here — the spec leaves this up to the implementation!

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

The next example shows interactions with the prototype chain. For the sake of brevity we don’t show the call log.

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

The output shows the `object` after it’s sorted. Again, there is no right answer here. This example just shows how weird the interaction between indexed properties and the prototype chain can get:

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

### What V8 does before actually sorting { #before-sort }

### V8 在排序前做了什么 {#before-sort}

V8 has two pre-processing steps before it actually sorts anything. First, if the object to sort has holes and elements on the prototype chain, they are copied from the prototype chain to the object itself. This frees us from caring about the prototype chain during all remaining steps. This is currently only done for non-`JSArray`s but other engines do it for `JSArray`s as well.

V8 在排序前会进行两个预处理步骤。首先，如果被排序的对象的原型作用链上有洞（hole）或元素（element），V8 会把它们从原型链上拷贝到对象本身上来.这样一来我们在接下来的步骤中就不同考虑原型链的问题了。V8 只在非 `JSArray` 上才会这样做，但其他引擎在 `JSArray` 上也这么做。

<figure>
  <img src="/_img/array-sort/copy-prototype.svg" alt="">
  <figcaption>从作用链中拷贝</figcaption>
</figure>

The second pre-processing step is the removal of holes. All elements in the sort-range are moved to the beginning of the object. `undefined`s are moved after that. This is even required by the spec to some degree as it requires us to *always* sort `undefined`s to the end. The result is that a user-provided comparison function will never get called with an `undefined` argument. After the second pre-processing step the sorting algorithm only needs to consider non-`undefined`s, potentially reducing the number of elements it actually has to sort.

第二个预处理步骤是移除洞。排序范围内的所有元素会被移到对象最前面。随后所有 `undefined` 被移到其后。某种程度上来说这是规范要求的，它规定 `undefined` **必须** 排在末尾。所以如果排序的参数是 `undefined`，用户提供的比较函数永远不会被调用。第二步预处理结束后排序算法只需考虑所有非 `undefined` 的元素了，潜在地减少了需要排序的元素。

<figure>
  <img src="/_img/array-sort/remove-array-holes.svg" alt="">
  <figcaption>移除洞，并把所有 <code>undefined</code> 移到末尾 </figcaption>
</figure>

## History

## 历史 {#history}

`Array.prototype.sort` and `TypedArray.prototype.sort` relied on the same Quicksort implementation written in JavaScript. The sorting algorithm itself is rather straightforward: The basis is a Quicksort with an Insertion Sort fall-back for shorter arrays (length < 10). The Insertion Sort fall-back was also used when Quicksort recursion reached a sub-array length of 10. Insertion Sort is more efficient for smaller arrays. This is because Quicksort gets called recursively twice after partitioning. Each such recursive call had the overhead of creating (and discarding) a stack frame.

`Array.prototype.sort` 和 `TypedArray.prototype.sort` 基于同一种 Javascript 实现的快速排序算法。算法本身很直接：快速排序的基础上对于短数组（长度小于 10）使用插入排序。当快速排序递归出一个长度小于 10 的子数组时也用插入排序。因为插入排序对较短数组更高效。这是因为快排在每次分割后要递归两次，而每次递归都要建立并丢弃一个栈（stack frame）。

Choosing a suitable pivot element has a big impact when it comes to Quicksort. V8 employed two strategies:

选择一个合适的主元（pivot）对于快排的性能有很大影响。V8 使用如下两种策略来选择主元：

- The pivot was chosen as the median of the first, last, and a third element of the sub-array that gets sorted. For smaller arrays that third element is simply the middle element.
- For larger arrays a sample was taken, then sorted and the median of the sorted sample served as the third element in the above calculation.

- 在给定子数组的第一个、最后一个、三分之一点的元素中选择它们的中位数作为主元。对于较短数组，三分之一点的元素就是中间（二分之一点）的元素。
- 如果数组较长，就从中抽取一个样本数组，对它排序，然后取出其中位数作为上述计算中的“三分之一点元素”。

One of the advantages of Quicksort is that it sorts in-place. The memory overhead comes from allocating a small array for the sample when sorting large arrays, and log(n) stack space. The downside is that it’s not a stable algorithm and there’s a chance the algorithm hits the worst-case scenario where QuickSort degrades to O(n^2).

快排的其中一个好处就是它就地排序（in-place）。只有排序长数组时抽取样本数组需要分配一点额外内存，以及 log(n) 的栈空间。坏处就是它不是一个稳定算法，而且最坏情况下时间复杂度为 O(n^2)。

### Introducing V8 Torque

### 介绍 V8 Torque

As an avid reader of the V8 blog you might have heard of [`CodeStubAssembler`](/blog/csa) or CSA for short. CSA is a V8 component that allows us to write low-level TurboFan IR directly in C++ that later gets translated to machine code for the appropriate architecture using TurboFan’s backend.

作为 V8 博客狂热读者的你也许听说过 [`CodeStubAssembler`](/blog/csa)，简称 CSA。CSA 是一个 V8 组件允许我们用 C++ 编写低等级 TurboFan IR，随后被 TurboFan 后端翻译成适合架构的机器码。

CSA is heavily utilized to write so-called “fast-paths” for JavaScript builtins. A fast-path version of a builtin usually checks whether certain invariants hold (e.g. no elements on the prototype chain, no accessors, etc) and then uses faster, more specific operations to implement the builtin functionality. This can result in execution times that are an order of magnitude faster than a more generic version.

CSA 重度应用于给 Javascript 内置函数编写所谓“捷径”。一个内置函数的捷径版本通常会检查它是否含有特定“不变性”（例如原型链上没有元素，没有访问器等等），随后使用更快的、更具体的操作来实现内置函数的功能。这样一来执行时间会比更通用的版本快一个数量级。

The downside of CSA is that it really can be considered an assembly language. Control-flow is modeled using explicit `labels` and `gotos`, which makes implementing more complex algorithms in CSA hard to read and error-prone.

CSA 的坏处在于它真的可以被认为是汇编语言。流程控制使用明确的 `label` 和 `goto`，这意味着用 CSA 实现更复杂的算法时代码会变得难以阅读，容易出错。

Enter [V8 Torque](/docs/torque). Torque is a domain-specific language with TypeScript-like syntax that currently uses CSA as its sole compilation target. Torque allows nearly the same level of control as CSA does while at the same time offering higher-level constructs such as `while` and `for` loops. Additionally, it’s strongly typed and will in the future contain security checks such as automatic out-of-bound checks providing V8 engineers with stronger guarantees.

接下来说 [V8 Torque]。Torque 是一个领域专用语言，拥有着类似 TypeScript 的语法，CSA 是它的唯一编译目标。Torque 可以提供与 CSA 几乎相同层次的控制，同时提供一些高级特性，例如 `while` 和 `for` 循环。而且它是强类型的，未来还会引入像自动越界检查这样的安全检查，为 V8 开发者们提供了更强有力的保证。 

The first major builtins that were re-written in V8 Torque were [`TypedArray#sort`](/blog/v8-release-68) and [`Dataview` operations](/blog/dataview). Both served the additional purpose of providing feedback to the Torque developers on what languages features are needed and idioms should be used to write builtins efficiently. At the time of writing, several `JSArray` builtins had their self-hosted JavaScript fall-back implementations moved to Torque (e.g. `Array#unshift`) while others were completely re-written (e.g. `Array#splice` and `Array#reverse`).

最先用 V8 Torque 重写的内置函数是 [`TypedArray#sort`](/blog/v8-release-68) 和 [`Dataview` 操作](/blog/dataview)。它们都为 Torque 开发者们提供了反馈，帮助他们决定还需要哪些语言特性，使用哪些模式来让编写内置函数更加高效。在本篇成文时，数个 `JSArray` 内置函数以及它们的自托管 Javascript 实现已经迁移到 Torque（比如 `Array#unshift`），还有一些被完全重写（例如 `Array#slice` 和 `Array#reverse`）。

### Moving `Array#sort` to Torque

### 将 `Array#sort` 迁移到 Torque

The initial `Array#sort` Torque version was more or less a straight up port of the JavaScript implementation. The only difference was that instead of using a sampling approach for larger arrays, the third element for the pivot calculation was chosen at random.

最初的 `Array#sort` 的 Torque 版本或多或少是其 Javascript 实现的直接搬移。唯一的区别是对长数组不再抽取样本数组，而是选择一个随机元素用于主元计算。

This worked reasonably well, but as it still utilized Quicksort, `Array#sort` remained unstable. [The request for a stable `Array#sort`](https://bugs.chromium.org/p/v8/issues/detail?id=90) is among the oldest tickets in V8’s bug tracker. Experimenting with Timsort as a next step offered us multiple things. First, we like that it’s stable and offers some nice algorithmic guarantees (see next section). Second, Torque was still a work-in-progress and implementing a more complex builtin such as `Array#sort` with Timsort resulted in lots of actionable feedback influencing Torque as a language.

这个实现得相当好，但由于它仍采用快速排序，`Array#sort` 还是不稳定排序。[对 `Array#sort` 稳定排序的要求](https://bugs.chromium.org/p/v8/issues/detail?id=90) 是 V8 bug 追踪器中最古老的工单之一。下一步对 Timsort 的实验性工作会带给我们很多益处。首先，我们很喜欢它是一个稳定排序，并且提供了一些很棒的算法保证（查看下节）。其次 Torque 仍是一个开发中的项目，用 Timsort 实现一个更复杂的像 `Array#sort` 这样的内置函数会对 Torque 语言本身产生很多可操作的反馈。

## Timsort

Timsort, initially developed by Tim Peters for Python in 2002, could best be described as an adaptive stable Mergesort variant. Even though the details are rather complex and are best described by [the man himself](https://github.com/python/cpython/blob/master/Objects/listsort.txt) or the [Wikipedia page](https://en.wikipedia.org/wiki/Timsort), the basics are easy to understand. While Mergesort usually works in recursive fashion, Timsort works iteratively. It processes an array from left to right and looks for so-called _runs_. A run is simply a sequence that is already sorted. This includes sequences that are sorted “the wrong way” as these sequences can simply be reversed to form a run. At the start of the sorting process a minimum run length is determined that depends on the length of the input. If Timsort can’t find natural runs of this minimum run length a run is “boosted artificially” using Insertion Sort.

Runs that are found this way are tracked using a stack that remembers a starting index and a length of each run. From time to time runs on the stack are merged together until only one sorted run remains. Timsort tries to maintain a balance when it comes to deciding which runs to merge. On the one hand you want to try and merge early as the data of those runs has a high chance of already being in the cache, on the other hand you want to merge as late as possible to take advantage of patterns in the data that might emerge. To accomplish this, Timsort maintains two invariants. Assuming `A`, `B`, and `C` are the three top-most runs:

- `|C| > |B| + |A|`
- `|B| > |A|`

<figure>
  <img src="/_img/array-sort/runs-stack.svg" alt="">
  <figcaption>Runs stack before and after merging <code>A</code> with <code>B</code></figcaption>
</figure>

The image shows the case where `|A| > |B|` so `B` is merged with the smaller of the two runs.

Note that Timsort only merges consecutive runs, this is needed to maintain stability, otherwise equal elements would be transferred between runs. Also the first invariant makes sure that run lengths grow at least as fast as the Fibonacci numbers, giving an upper bound on the size of the run stack when we know the maximum array length.

One can now see that already-sorted sequences are sorted in O(n) as such an array would result in a single run that does not need to get merged. The worst case is O(n log n). These algorithmic properties together with the stable nature of Timsort were a few of the reasons why we chose Timsort over Quicksort in the end.

### Implementing Timsort in Torque

Builtins usually have different code-paths that are chosen during runtime depending on various variables. The most generic version can handle any kind of object, regardless if its a `JSProxy`, has interceptors or needs to do prototype chain lookups when retrieving or setting properties.
The generic path is rather slow in most cases, as it needs to account for all eventualities. But if we know upfront that the object to sort is a simple `JSArray` containing only Smis, all these expensive `[[Get]]` and `[[Set]]` operations can be replaced by simple Loads and Stores to a `FixedArray`. The main differentiator is the [`ElementsKind`](/blog/elements-kinds).

The problem now becomes how to implement a fast-path. The core algorithm stays the same for all but the way we access elements changes based on the `ElementsKind`. One way we could accomplish this is to dispatch to the correct “accessor” on each call-site. Imagine a switch for each “load”/”store” operation where we choose a different branch based on the chosen fast-path.

Another solution (and this was the first approach tried) is to just copy the whole builtin once for each fast-path and inline the correct load/store access method. This approach turned out to be infeasible for Timsort as it’s a big builtin and making a copy for each fast-path turned out to require 106 KB in total, which is way too much for a single builtin.

The final solution is slightly different. Each load/store operation for each fast-path is put into its own “mini-builtin”. See the code example which shows the “load” operation for `FixedDoubleArray`s.

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
    // The pre-processing step removed all holes by compacting all elements
    // at the start of the array. Finding a hole means the cmp function or
    // ToString changes the array.
    return Failure(sortState);
  }
}
```

To compare, the most generic “load” operation is simply a call to `GetProperty`. But while the above version generates efficient and fast machine code to load and convert a `Number`, `GetProperty` is a call to another builtin that could potentially involve a prototype chain lookup or invoke an accessor function.

```js
builtin Load<ElementsAccessor : type>(
    context: Context, sortState: FixedArray, elements: HeapObject,
    index: Smi): Object {
  return GetProperty(context, elements, index);
}
```

A fast-path then simply becomes a set of function pointers. This means we only need one copy of the core algorithm while setting up all relevant function pointers once upfront. While this greatly reduces the needed code space (down to 20k) it comes at the cost of an indirect branch at each access site. This is even exacerbated by the recent change to use [embedded builtins](/blog/embedded-builtins).

### Sort state

<figure>
  <img src="/_img/array-sort/sort-state.svg" alt="">
</figure>

The picture above shows the “sort state”. It’s a `FixedArray` that keeps track of all the things needed while sorting. Each time `Array#sort` is called, such a sort state is allocated. Entry 4 to 7 are the set of function pointers discussed above that comprise a fast-path.

The “check” builtin is used every time we return from user JavaScript code, to check if we can continue on the current fast-path. It uses the “initial receiver map” and “initial receiver length” for this.  Should the user code have modified the current object, we simply abandon the sorting run, reset all pointers to their most generic version and restart the sorting process. The “bailout status” in slot 8 is used to signal this reset.

The “compare” entry can point to two different builtins. One calls a user-provided comparison function while the other implements the default comparison that calls `toString` on both arguments and then does a lexicographical comparison.

The rest of the fields (with the exception of the fast path ID) are Timsort-specific. The run stack (described above) is initialized with a size of 85 which is enough to sort arrays of length 2<sup>64</sup>. The temporary array is used for merging runs. It grows in size as needed but never exceeds `n/2` where `n` is the input length.

### Performance trade-offs

Moving sorting from self-hosted JavaScript to Torque comes with performance trade-offs. As `Array#sort` is written in Torque, it’s now a statically compiled piece of code, meaning we still can build fast-paths for certain [`ElementsKind`s](/blog/elements-kinds) but it will never be as fast as a highly optimized TurboFan version that can utilize type feedback. On the other hand, in cases where the code doesn’t get hot enough to warrant JIT compilation or the call-site is megamorphic, we are stuck with the interpreter or a slow/generic version. The parsing, compiling and possible optimizing of the self-hosted JavaScript version is also an overhead that is not needed with the Torque implementation.

While the Torque approach doesn’t result in the same peak performance for sorting, it does avoid performance cliffs. The result is a sorting performance that is much more predictable than it previously was. Keep in mind that Torque is very much in flux and in addition of targeting CSA it might target TurboFan in the future, allowing JIT compilation of code written in Torque.

### Microbenchmarks

Before we started with `Array#sort`, we added a lot of different micro-benchmarks to get a better understanding of the impact the re-implementation would have. The first chart shows the “normal” use case of sorting various ElementsKinds with a user-provided comparison function.

Keep in mind that in these cases the JIT compiler can do a lot of work, since sorting is nearly all we do. This also allows the optimizing compiler to inline the comparison function in the JavaScript version, while we have the call overhead from the builtin to JavaScript in the Torque case. Still, we perform better in nearly all cases.

<figure>
  <img src="/_img/array-sort/micro-bench-basic.svg" alt="">
</figure>

The next chart shows the impact of Timsort when processing arrays that are already sorted completely, or have sub-sequences that are already sorted one-way or another. The chart uses Quicksort as a baseline and shows the speedup of Timsort (up to 17× in the case of “DownDown” where the array consists of two reverse-sorted sequences). As can be seen, expect in the case of random data, Timsort performs better in all other cases, even though we are sorting `PACKED_SMI_ELEMENTS`, where Quicksort outperformed Timsort in the microbenchmark above.

<figure>
  <img src="/_img/array-sort/micro-bench-presorted.svg" alt="">
</figure>

### Web Tooling Benchmark

The [Web Tooling Benchmark](https://github.com/v8/web-tooling-benchmark) is a collection of workloads of tools usually used by web developers such as Babel and TypeScript. The chart uses JavaScript Quicksort as a baseline and compares the speedup of Timsort against it. In almost all benchmarks we retain the same performance with the exception of chai.

<figure>
  <img src="/_img/array-sort/web-tooling-benchmark.svg" alt="">
</figure>

The chai benchmark spends *a third* of its time inside a single comparison function (a string distance calculation). The benchmark is the test suite of chai itself. Due to the data, Timsort needs some more comparisons in this case, which has a bigger impact on the overall runtime, as such a big portion of time is spent inside that particular comparison function.

### Memory impact

Analyzing V8 heap snapshots while browsing some 50 sites (both on mobile as well as on desktop) didn’t show any memory regressions or improvements. On the one hand, this is surprising: the switch from Quicksort to Timsort introduced the need for a temporary array for merging runs, which can grow much larger than the temporary arrays used for sampling. On the other hand, these temporary arrays are very short-lived (only for the duration of the `sort` call) and can be allocated and discarded rather quickly in V8’s new space.

## Conclusion

In summary we feel much better about the algorithmic properties and the predictable performance behavior of a Timsort implemented in Torque. Timsort is available starting with V8 v7.0 and Chrome 70. Happy sorting!
