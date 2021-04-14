---
title: 'V8 Torque 用户手册'
description: 'This document explains the V8 Torque language, as used in the V8 codebase.'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 Torque 是一种语言，它允许参与 V8 项目的开发人员通过专注于对 VM 进行更改的 _意图_ 来表达对 VM 的更改，而不是将精力集中于不相关的实现细节。该语言设计得足够简单，可以轻松地将 [ECMAScript 规范](https://tc39.es/ecma262/) 直接转换为 V8 中的实现，而且其有足够的能力以健壮的方式表达低级别的 V8 优化技巧，例如根据特定对象形状（object-shapes）的测试创建快速路径（fast-paths）。

Torque 对于 V8 工程师和 JavaScript 开发者来说是比较熟悉的, 因其结合了类似 TypeScript 的语法（易于编写和理解 V8 代码）和 [`CodeStubAssembler`](/blog/csa) 中常见的语法及类型。凭借强大的类型系统和结构化的控制流程，Torque 可在结构上确保其正确性。Torque 的表现力足以让其表达 [目前 V8 内置的](/docs/builtin-functions) 几乎所有的功能。它也可以与 `CodeStubAssembler` 内置函数和用 C++ 编写的 `macro` 很好地互操作，从而允许 Torque 代码使用手写的 CSA 功能，反之亦然。

Torque 提供了用语言构造来表达高级别、语义丰富的 V8 实现方式，并且 Torque 编译器使用 `CodeStubAssembler` 将这些文件转换为有效的汇编代码。以前直接使用 `CodeStubAssembler` 是费力且容易出错的，Torque 的语言结构和 Torque 编译器的错误检查确保了其正确性。传统上，使用 `CodeStubAssembler`编写最佳代码需要 V8 工程师掌握大量的专业知识，以避免在实现过程中埋下细微的隐患，而其中许多知识几乎不能从书面文档上获得。没有掌握这些知识，编写高效内置程序的学习曲线将非常陡峭。即使掌握了必要的知识，不是那么明显且不受管理的陷阱也经常会导致正确性问题或 [安全性](https://bugs.chromium.org/p/chromium/issues/detail?id=775888) [漏洞](https://bugs.chromium.org/p/chromium/issues/detail?id=785804)。使用 Torque，这些陷阱可以通过 Torque 编译器避免和自动识别。

## 入门 { #getting-started }

大多数用 Torque 编写的源代码都已签入 V8 存储库下的 [`src/builtins` 目录](https://github.com/v8/v8/tree/master/src/builtins)，文件扩展名为 `.tq`。 (实际的 Torque 编译器可以在 [`src/torque`](https://github.com/v8/v8/tree/master/src/torque) 目录下找到。)。Torque 的功能测试在 [`test/torque`](https://github.com/v8/v8/tree/master/test/torque) 目录下。

为了让你能体验到这种语言，我们来编写一个 V8 内置功能来打印输出 "Hello World!"。为此，我们将在测试用例中添加一个 Torque `macro`，并在 `cctest` 测试框架中调用它。

首先打开 `test/torque/test-torque.tq` 文件，并在末尾（在最后一个 `}` 之前）添加如下代码：

```torque
@export
macro PrintHelloWorld() {
  Print('Hello world!');
}
```

接下来，打开 `test/cctest/torque/test-torque.cc` 文件并添加以下使用新的 Torque 代码构建的代码块（code stub）的测试用例：

```cpp
TEST(HelloWorld) {
  Isolate* isolate(CcTest::InitIsolateOnce());
  CodeAssemblerTester asm_tester(isolate, 0);
  TestTorqueAssembler m(asm_tester.state());
  {
    m.PrintHelloWorld();
    m.Return(m.UndefinedConstant());
  }
  FunctionTester ft(asm_tester.GenerateCode(), 0);
  ft.Call();
}
```

然后 [构建 `cctest` 可执行文件](/docs/test)，最后执行 `cctest` 测试以打印 "Hello world"：

```bash
$ out/x64.debug/cctest test-torque/HelloWorld
Hello world!
```

## Torque 如何生成代码 { #how-torque-generates-code }

Torque 编译器不会直接创建机器代码，而是会生成 C++ 代码，以调用 V8 现有的 `CodeStubAssembler` 接口。`CodeStubAssembler` 使用 [TurboFan 编译器的](https://v8.dev/docs/turbofan) 后端生成高效的代码。因此，Torque 编译需要多个步骤：

1. `gn` 构建首先运行 Torque 编译器。它处理所有 `*.tq` 文件，在 `gen/torque-generated` 目录下适当的子文件夹中输出相应的 `*-tq-csa.cc`
 和 `*-tq-csa.h` 文件。Torque 编译器还会生成各种已知的 `.h` 文件，这些文件将由 V8 构建使用。这些包含了编译的 `.tq` 文件中找到的所有类定义。
2. Torque 生成的 `.h` 文件包含在 V8 构建中的关键位置，补充了 V8 源文件中“手工”声明的类定义。
3. 然后，`gn` 构建将步骤 1 中生成的 `.cc` 文件编译为 `mksnapshot` 可执行文件。
4. 运行 `mksnapshot` 时，将生成所有 V8 内置文件并将其打包到快照文件中，包括在 Torque 中定义的那些以及使用 Torque 定义（Torque-defined）功能的任何其它内置文件。
5. V8 的其余部分已构建。通过链接到 V8 的快照文件，可以访问所有 Torque 授权（Torque-authored）的内置文件。可以像其它任何内置方法一样调用它们。在最终包中，没有留下任何直接的 Torque 痕迹（调试信息除外）：`d8` 或 `chrome` 可执行文件中均未包含Torque源代码（`.tq` 文件）或 Torque 生成的 `.cc` 文件。

以图形方式，构建过程如下所示：

<figure>
  <img src="/_img/docs/torque/build-process.svg" width="800" height="480" alt="" loading="lazy">
</figure>

## Torque 工具 { #tooling }

Torque 提供了基本的工具和开发环境支持。

- 有一个适用于 Torque 的 Visual Studio Code 语法突出显示插件：`tools/torque/vscode-torque`。
- 更改 `.tq` 文件后，还应该使用一种格式化工具：`tools/torque/format-torque.py -i <filename>`

## 对涉及 Torque 的构建进行故障排除 { #troubleshooting }

为什么你需要知道这一点？了解 Torque 文件如何转换为机器代码很重要，因为在将 Torque 转换为快照中嵌入的二进制位的不同阶段中可能会出现不同的问题（和错误）：

- 如果你在 Torque 代码（即 `.tq` 文件）中存在语法或语义错误，则 Torque 编译器将失败。 V8 构建在此阶段中止，并且你将看不到构建的后续部分可能发现的其他错误。
- 一旦你的 Torque 代码在语法上正确无误，并通过了 Torque 编译器（或多或少）严格的语义检查，`mksnapshot` 的构建仍然可能失败。最常见的情况是 `.tq` 文件中提供的外部定义不一致。在 Torque 代码中用 `extern` 关键字标记的定义会向 Torque 编译器发出信号，表明所需功能的定义已在 C++ 中找到。当前，`.tq` 文件中的 `extern` 定义与这些 `extern` 定义所引用的 C++ 代码之间的耦合是松散的，并且在 Torque 编译时没有进行任何验证。当 `extern` 定义与在 `code-stub-assembler.h` 头文件或其它 V8 头中访问的功能不匹配（或在最微妙的情况下屏蔽）时，`mksnapshot` 的 C++ 构建将失败，通常在 `*-gen.cc` 中。
- 即使 `mksnapshot` 成功构建，如果 Torque 提供的内置程序有错误，它也可能在执行期间失败。许多内置程序作为快照创建的一部分运行，包括 Torque生成的内置程序。例如，在 JavaScript 快照初始化过程中，将调用 Torque 创建的内置 `Array.prototype.splice` ，以设置默认的 JavaScript 环境。如果实现中存在错误，则 `mksnapshot` 在执行期间将会崩溃。当 `mksnapshot` 崩溃时，有时通过传递 `--gdb-jit-full` 标志来调用 `mksnapshot` 很有用，该标志会生成额外的调试信息，从而提供有用的上下文，例如 `gdb` 堆栈抓取中由 Torque 生成的内置函数的名称。
- 当然，即使 Torque 编写的代码通过 `mksnapshot` 构建，它仍然可能有故障或崩溃。将测试用例添加到 `torque-test.tq` 和 `torque-test.cc` 是确保你的 Torque 代码达到你实际期望的一种好方法。如果你的 Torque 代码最终在 `d8` 或 `chrome` 中崩溃，则 `--gdb-jit-full` 标志再次非常有用。

## `constexpr`: 编译时与运行时 { #constexpr }

了解 Torque 构建过程对于理解 Torque 语言的核心功能 `constexpr` 也很重要。

Torque 允许在运行时评估 Torque 代码中的表达式（即，当 V8 内置函数作为执行 JavaScript 的一部分而执行时）。但是，它也允许在编译时执行表达式（即，作为 Torque 构建过程的一部分，并且甚至在创建 V8 库和 `d8` 可执行文件之前）。

Torque 使用 `constexpr` 关键字指示必须在构建时对表达式求值。它的用法在某种程度上类似于 [C++’s `constexpr`](https://en.cppreference.com/w/cpp/language/constexpr)：除了从 C++ 借鉴了 `constexpr` 关键字和它的某些语法外，Torque 同样使用 `constexpr` 来表示编译时和运行时评估之间的区别。

但是，Torque 的 `constexpr` 语义有一些细微的差异。 在 C++ 中，`constexpr` 表达式可以由 C++ 编译器完全求值。在 Torque 中，`constexpr` 表达式不能由 Torque 编译器完全评估，而是映射到 C++ 类型、变量和表达式，这些变量和表达式在运行 `mksnapshot` 时可以被（必须被）完全评估。从 Torque 编写者（Torque-writer）的角度来看，`constexpr` 表达式不会生成在运行时执行的代码，因此从某种意义上说属于编译时，但是从技术上来说，`constexpr` 表达式是由 `mksnapshot` 运行的 Torque 外部的 C++ 代码评估的。因此，在 Torque 中，`constexpr` 本质上是指 "`mksnapshot`-time"，而不是“编译时”。

与泛型结合使用时，`constexpr` 是一个功能强大的 Torque 工具，可用于自动生成多个非常高效的标准内置程序，这些内建函数在少量特定细节上彼此不同，而这些 V8 开发人员则可以预先预料到。

## 文件 { #files }

Torque 代码打包在单独的源文件中。每个源文件都包含一系列声明，它们本身可以选择包含在命名空间声明中，以分隔声明的命名空间。`.tq` 文件的语法如下：

```grammar
Declaration :
  AbstractTypeDeclaration
  ClassDeclaration
  TypeAliasDeclaration
  EnumDeclaration
  CallableDeclaration
  ConstDeclaration
  GenericSpecialization

NamespaceDeclaration :
  namespace IdentifierName { Declaration* }

FileDeclaration :
  NamespaceDeclaration
  Declaration
```

## 命名空间 { #namespaces }

Torque 命名空间允许声明成为独立的命名空间。它们类似于 C++ 命名空间。它们允许你创建在其它命名空间中不自动可见的声明。它们可以嵌套，并且嵌套命名空间中的声明可以无限制地访问包含它们的命名空间中的声明。未在命名空间声明中显式声明的声明被放入对所有命名空间可见的共享全局默认命名空间中。可以重新打开命名空间，从而可以在多个文件中定义它们。

例如：

```torque
macro IsJSObject(o: Object): bool { … }  // In default namespace

namespace array {
  macro IsJSArray(o: Object): bool { … }  // In array namespace
};

namespace string {
  // …
  macro TestVisibility() {
    IsJsObject(o); // OK, global namespace visible here
    IsJSArray(o);  // ERROR, not visible in this namespace
  }
  // …
};

namespace array {
  // OK, namespace has been re-opened.
  macro EnsureWriteableFastElements(array: JSArray){ … }
};
```

## 声明 { #declarations }

### 类型 { #types }

Torque 是强类型的。它的类型系统是它提供的许多安全性和正确性保证的基础。

但是，除了稍后讨论的几个显著例外以外，Torque 实际上并不十分了解用于编写大多数 Torque 代码的核心类型。为了使 Torque 和手写的 `CodeStubAssembler` 代码之间具有更好的互操作性，Torque 的类型系统严格指定了 Torque 类型之间的关系，但在指定类型本身实际工作方式方面却不那么严格。相反，它通过显式类型映射与 `CodeStubAssembler` 和 C++ 类型松散耦合，并且它依赖 C++ 编译器来强制执行该映射的严格操作。

在 Torque 中，有三种不同的类型：Abstract, Function 和 Union。

#### 抽象（Abstract）类型 { #abstract-types }

Torque 的抽象（Abstract）类型直接映射到 C++ 编译时和 CodeStubAssembler 运行时值。它们的声明指定了名称和与 C++ 类型的关系：

```grammar
AbstractTypeDeclaration :
  type IdentifierName ExtendsDeclaration opt GeneratesDeclaration opt ConstexprDeclaration opt

ExtendsDeclaration :
  extends IdentifierName ;

GeneratesDeclaration :
  generates StringLiteral ;

ConstexprDeclaration :
  constexpr StringLiteral ;
```

`IdentifierName` 指定抽象类型的名称，`ExtendsDeclaration` 可选地指定所声明的类型所源自的类型。`GeneratesDeclaration` 可选地指定一个字符串字面量（与 `CodeStubAssembler` 代码中使用的 C++ `TNode` 类型相对应）以包含其类型的运行时值。 `ConstexprDeclaration` 是一个字符串文字面量，用于指定与构建时间（`mksnapshot`-time）评估的 Torque 类型的 `constexpr` 版本相对应的 C++ 类型。

这是来自 `base.tq` 的示例，其中包含 Torque 的 31 位和 32 位有符号整数类型：

```torque
type int32 generates 'TNode<Int32T>' constexpr 'int32_t';
type int31 extends int32 generates 'TNode<Int32T>' constexpr 'int31_t';
```

#### 联合（Union）类型 { #union-types }

联合（Union）类型表示值属于几种可能的类型之一。 我们仅允许标记值的联合类型，因为可以在运行时使用映射指针来区分它们。例如，JavaScript 数字是 Smi 值或已分配的 `HeapNumber` 对象。

```torque
type Number = Smi | HeapNumber;
```

联合（Union）类型满足以下相等性：

- `A | B = B | A`
- `A | (B | C) = (A | B) | C`
- `A | B = A` if `B` is a subtype of `A`

由于不允许在运行时区分未标记的类型，因此仅允许从标记的类型形成联合（Union）类型。

将联合（Union）类型映射到 CSA 时，将选择联合类型的所有类型中最具体的通用父类型，但 `Number`  和 `Numeric` 除外，它们映射到相应的 CSA 联合体类型。

#### 类（Class）类型 { #class-types }

类（Class）类型使得可以通过 Torque 代码在 V8 GC 堆上定义，分配和操作结构化对象。每个 Torque 类类型必须对应于 C++ 代码中 HeapObject 的子类。 为了最大程度地减少在 V8 的 C++ 和 Torque 实现之间维护样板（boilerplate）对象访问代码的开销，Torque 类定义用于在可能的情况下（和适当时）生成所需的 C++ 对象访问代码，以减少手动保持 C++ 和 Torque 同步的麻烦。

```grammar
ClassDeclaration :
  ClassAnnotation* extern opt transient opt class IdentifierName ExtendsDeclaration opt GeneratesDeclaration opt {
    ClassMethodDeclaration*
    ClassFieldDeclaration*
  }

ClassAnnotation :
  @generateCppClass
  @generateBodyDescriptor
  @generatePrint
  @abstract
  @export
  @noVerifier
  @hasSameInstanceTypeAsParent
  @highestInstanceTypeWithinParentClassRange
  @lowestInstanceTypeWithinParentClassRange
  @reserveBitsInInstanceType ( NumericLiteral )
  @apiExposedInstanceTypeValue ( NumericLiteral )

ClassMethodDeclaration :
  transitioning opt IdentifierName ImplicitParameters opt ExplicitParameters ReturnType opt LabelsDeclaration opt StatementBlock

ClassFieldDeclaration :
  ClassFieldAnnotation* weak opt const opt FieldDeclaration;

ClassFieldAnnotation :
  @noVerifier
  @if ( Identifier )
  @ifnot ( Identifier )

FieldDeclaration :
  Identifier ArraySpecifier opt : Type ;

ArraySpecifier :
  [ Expression ]
```

一个示例类：

```torque
@generateCppClass
extern class JSProxy extends JSReceiver {
  target: JSReceiver|Null;
  handler: JSReceiver|Null;
}
```

`extern` 表示该类是在 C++ 中定义的，而不是仅在 Torque 中定义的。

类中的字段声明隐式生成可被 CodeStubAssembler 使用的字段读写器（getter 和 setter），例如：

```cpp
// In TorqueGeneratedExportedMacrosAssembler:
TNode<HeapObject> LoadJSProxyTarget(TNode<JSProxy> p_o);
void StoreJSProxyTarget(TNode<JSProxy> p_o, TNode<HeapObject> p_v);
```

如上所述，在 Torque 类中定义的字段生成 C++ 代码，从而无需重复的样板访问器（boilerplate accessor）和堆访问器（heap visitor）代码。因为上面的示例使用 `@generateCppClass`，所以 JSProxy 的手写定义必须从生成的类模板继承，如下所示：

```cpp
// In js-proxy.h:
class JSProxy : public TorqueGeneratedJSProxy<JSProxy, JSReceiver> {

  // Whatever the class needs beyond Torque-generated stuff goes here...

  // At the end, because it messes with public/private:
  TQ_OBJECT_CONSTRUCTORS(JSProxy)
}

// In js-proxy-inl.h:
TQ_OBJECT_CONSTRUCTORS_IMPL(JSProxy)
```

生成的类提供了转换函数，字段访问器函数以及字段偏移量常量（例如，在这种情况下为 `kTargetOffset` 和 `kHandlerOffset`），这些常量表示每个字段从类的开头开始的字节偏移量。

##### 类类型注解

推荐使用 `@generateCppClass`（如上例所示），但某些类仍不使用它。在这种情况下，该类应该为其字段偏移量常量包含一个 Torque 生成的宏，并且必须实现其自己的访问器和强制转换函数。 使用该宏看起来像这样：

```cpp
class JSProxy : public JSReceiver {
 public:
  DEFINE_FIELD_OFFSET_CONSTANTS(
      JSReceiver::kHeaderSize, TORQUE_GENERATED_JS_PROXY_FIELDS)
  // Rest of class omitted...
}
```

`@generateBodyDescriptor` 使 Torque 在生成的类内抛出一个类 `BodyDescriptor`，它表示垃圾收集器应如何访问该对象。否则，C++ 代码必须定义自己的对象访问，或者使用现有的模式之一（例如，从 `Struct` 继承并在 `STRUCT_LIST` 中包含该类意味着该类仅应包含标记值）。

如果添加了 `@generatePrint` 注解，则生成器将实现 C++ 函数，该函数将打印由 Torque 布局定义的字段值。 使用 JSProxy 示例，签名将为  `void TorqueGeneratedJSProxy<JSProxy, JSReceiver>::JSProxyPrint(std::ostream& os)`，可以由 `JSProxy` 继承。

除非该类使用 `@noVerifier` 注解选择退出，否则 Torque 编译器还会为所有 `extern` 类生成验证代码。例如，上面的 JSProxy 类定义将生成一个 C++ 方法 `void TorqueGeneratedClassVerifiers::JSProxyVerify(JSProxy o, Isolate* isolate)`，该方法根据 Torque 类型定义验证其字段是否有效。它还将在生成的类 `TorqueGeneratedJSProxy<JSProxy, JSReceiver>::JSProxyVerify` 上生成相应的函数，该类从 `TorqueGeneratedClassVerifiers` 调用静态函数。如果要为类添加额外的验证（例如，可接受的数字值的范围，或者如果字段 `bar` 为非空，则要求字段 `foo` 为 true 等），则将 `DECL_VERIFIER(JSProxy)` 添加到 C++ 类（隐藏继承的 `JSProxyVerify`）并在 `src/objects-debug.cc` 中实现。任何此类自定义验证程序的第一步都应该是调用生成的验证程序，例如 `TorqueGeneratedClassVerifiers::JSProxyVerify(*this, isolate);`。（要在每个 GC 之前和之后运行这些验证程序，请使用 `v8_enable_verify_heap = true` 进行构建，并使用 `--verify-heap` 进行运行。）

`@abstract` 指示类本身未实例化，并且没有自己的实例类型：逻辑上属于该类的实例类型是派生类的实例类型。

`@export` 注解使 Torque 编译器生成一个具体的 C++ 类（例如上例中的 `JSProxy`）。仅当你不想添加 Torque 生成的代码所提供的功能之外的任何 C++ 功能时，这显然才有用。不能与 `extern` 一起使用。对于仅在 Torque 中定义和使用的类，最合适的做法是不使用`extern`或 `@ export`。

`@hasSameInstanceTypeAsParent` 表示与父类具有相同实例类型的类，但是重命名了某些字段，或者可能具有不同的映射。 在这种情况下，父类不是抽象的。在这种情况下，父类不是抽象的。

注解 `@highestInstanceTypeWithinParentClassRange`，`@lowestInstanceTypeWithinParentClassRange`，`@reserveBitsInInstanceType` 和 `@apiExposedInstanceTypeValue` 都会影响实例类型的生成。通常，你可以忽略这些并且不会有什么问题。 Torque 负责在枚举 `v8::internal::InstanceType` 中为每个类分配一个唯一值，以便 V8 在运行时可以确定 JS 堆中任何对象的类型。在大多数情况下，Torque 分配的实例类型应该足够了，但是在少数情况下，我们希望特定类的实例类型在整个构建过程，或者在实例类型分配给其超类的开始或结束时范围内，或者是可以在 Torque 之外定义的保留值范围中保持稳定。

##### 类字段

除了上面的示例中的普通值之外，类字段也可以包含索引数据。 这是一个例子：

```torque
extern class CoverageInfo extends HeapObject {
  const slot_count: int32;
  slots[slot_count]: CoverageInfoSlot;
}
```

这意味着 `CoverageInfo` 实例的大小根据 `slot_count` 中的数据而有所不同。

与 C++ 不同，Torque 不会在字段之间隐式添加填充。 相反，如果字段未正确对齐，它将失败并发出错误。Torque 还要求强字段、弱字段和标量字段与按字段序排列的同一类别的其它字段在一起。

`const` 表示无法在运行时更改字段（或至少不容易更改；如果尝试设置该字段，则 Torque 将导致编译失败）。对于长度字段来说，这是一个好主意，应该非常小心地重设长度字段，因为它们将需要释放任何释放的空间，并可能导致带有线程标记的数据竞争。

字段声明开始处的 `weak` 表示该字段应与其它 `weak` 字段组合在一起，并影响常量 `kEndOfStrongFieldsOffset` 和 `kStartOfWeakFieldsOffset` 等可在自定义 `BodyDescriptor` 中使用的常量的生成。我们希望一旦 Torque 完全能够生成所有 `BodyDescriptor` 后就删除该关键字。如果存储在字段中的对象可能是弱引用（已设置第二个位），则应在类型中使用 `Weak<T>`。例如， `Map` 中的该字段可以包含一些强类型和一些弱类型，并且还标记为包含在 `weak` 部分中：

```torque
  weak transitions_or_prototype_info: Map|Weak<Map>|TransitionArray|
      PrototypeInfo|Smi;
```

`@if` 和 `@ifnot` 标记应在某些构建配置中包含的字段，而在其他构建配置中则不包括。它们接受 `src/torque/torque-parser.cc` 中 `BuildFlags` 列表中的值。

##### 完全在 Torque 之外定义的类

有些类未在 Torque 中定义，但是 Torque 必须了解每个类，因为它负责分配实例类型。在这种情况下，可以不带任何主体声明类，并且 Torque 除实例类型外不会为它们生成任何内容。 例子：

```torque
extern class OrderedHashMap extends HashTable;
```

#### 形状 { #shapes }

定义 `shape` 看起来就像定义一个类，只不过它使用关键字 `shape` 而不是 `class`。`shape` 是 `JSObject` 的子类型，代表对象内属性的时间点排列（具体来说，这些是“数据属性”，而不是“内部插槽”）。`shape` 没有自己的实例类型。具有特定形状的对象可能随时更改并丢失该形状，因为该对象可能会进入字典模式并将其所有属性移到单独的后备存储中。

#### 结构体 { #structs }

`struct` 是可以轻松在一起传递的数据的集合。（与名为 `Struct` 的类完全无关。）像类一样，它们可以包含对数据进行操作的宏。与类不同的是，它们还支持泛型（generics）。语法类似于类：

```torque
@export
struct PromiseResolvingFunctions {
  resolve: JSFunction;
  reject: JSFunction;
}

struct ConstantIterator<T: type> {
  macro Empty(): bool {
    return false;
  }
  macro Next(): T labels _NoMore {
    return this.value;
  }

  value: T;
}
```

##### 结构体注解

标记为 `@export` 的任何结构体都将以可预测的名称包含在生成的文件 `gen/torque-generated/csa-types-tq.h` 中。该名称以 `TorqueStruct` 开头，因此 `PromiseResolvingFunctions` 成为 `TorqueStructPromiseResolvingFunctions`。

结构体字段可以标记为 `const`，这意味着其不应被写入（或者说修改）。整个结构体仍然可以被覆盖。

##### 结构体作为类的字段

可以将结构体用作类字段的类型。在那种情况下，它表示类中的打包的有序数据（否则，结构体没有对齐要求）。这对于类中的索引字段特别有用。例如，`DescriptorArray` 包含一个三值结构数组：

```torque
struct DescriptorEntry {
  key: Name|Undefined;
  details: Smi|Undefined;
  value: JSAny|Weak<Map>|AccessorInfo|AccessorPair|ClassPositions;
}

extern class DescriptorArray extends HeapObject {
  const number_of_all_descriptors: uint16;
  number_of_descriptors: uint16;
  raw_number_of_marked_descriptors: uint16;
  filler16_bits: uint16;
  enum_cache: EnumCache;
  descriptors[number_of_all_descriptors]: DescriptorEntry;
}
```

##### 引用和切片

`Reference<T>` 和 `Slice<T>` 是特殊的结构，表示指向堆对象中保存的数据的指针。它们都包含一个对象和一个偏移量。`Slice<T>` 也包含一个长度。除了直接构造这些结构体外，还可以使用特殊的语法：`&o.x` 将在对象  `o` 中创建对字段 `x` 的引用（`Reference`），或者如果 `x` 是索引字段，则创建对数据的切片（`Slice`）。`Reference<T>` 可以用 `*`  或 `->` 取消引用，与 C++ 一致。

`Reference<T>` 不应直接使用。相反，它具有两个子类型 `MutableReference<T>` 和 `ConstReference<T>`，可以使用语法糖来引用它们：`&T` 和 `const &T`。

#### 位字段结构体 { #bitfield-structs }

`bitfield struct` 表示打包为单个数字值的数字数据的集合。 它的语法看起来与普通 `struct` 类似，只是每个字段的位数有所增加。

```torque
bitfield struct DebuggerHints extends uint31 {
  side_effect_state: int32: 2 bit;
  debug_is_blackboxed: bool: 1 bit;
  computed_debug_is_blackboxed: bool: 1 bit;
  debugging_id: int32: 20 bit;
}
```

如果将位字段结构体（bitfield struct）（或任何其他数字数据）存储在 Smi 中，则可以使用 `SmiTagged<T>` 类型表示它。

#### 函数指针类型 { #function-pointer-types }

函数指针（Function pointers）只能指向 Torque 中定义的内置函数，因为这保证了默认的 ABI。它们对于减小二进制代码的大小特别有用。

尽管函数指针类型是匿名的（例如在 C 中），但是可以将它们绑定到类型别名（例如在 C 中的 `typedef`）。

```torque
type CompareBuiltinFn = builtin(implicit context: Context)(Object, Object, Object) => Number;
```

#### 特殊类型 { #special-types }

关键字 `void` 和 `never` 表示两种特殊类型。`void` 用作不返回值的可调用对象的返回类型，`never` 用作永不实际返回（即仅通过特殊路径退出）的可调用对象的返回类型。

#### 瞬态类型 { #transient-types }

在 V8 中，堆对象可以在运行时更改布局。为了表示类型系统中可能发生更改或其它临时假设的对象布局，Torque 支持"瞬态类型"（transient type）的概念。在声明抽象类型时，添加关键字 `transient` 会将其标记为瞬态类型。

```torque
// A HeapObject with a JSArray map, and either fast packed elements, or fast
// holey elements when the global NoElementsProtector is not invalidated.
transient type FastJSArray extends JSArray
    generates 'TNode<JSArray>';
```

例如，对于 `FastJSArray`，如果数组更改为字典元素，或者全局 `NoElementsProtector` 无效，则瞬态类型将无效。为了用 Torque 来表达这一点，请标注所有可能执行此操作的可调用对象为 `transitioning`。例如，调用 JavaScript 函数可以执行任意 JavaScript，因此它是 `transitioning`。

```torque
extern transitioning macro Call(implicit context: Context)
                               (Callable, Object): Object;
```

在类型系统中进行控制的方式是，在 transitioning 操作中访问瞬态类型的值是非法的。

```torque
const fastArray : FastJSArray = Cast<FastJSArray>(array) otherwise Bailout;
Call(f, Undefined);
return fastArray; // Type error: fastArray is invalid here.
```

#### 枚举 { #enums }

枚举（Enumerations）提供了一种定义常量集并将其分组的方式，类似于 C++ 中的枚举类。声明由 `enum` 关键字引入，并遵循以下语法结构：

```grammar
EnumDeclaration :
  extern enum IdentifierName ExtendsDeclaration opt ConstexprDeclaration opt { IdentifierName list+ (, ...) opt }
```

一个基本的示例如下所示：

```torque
extern enum LanguageMode extends Smi {
  kStrict,
  kSloppy
}
```

该声明定义了一个新的类型 `LanguageMode`，其中 `extends` 子句指定了基础类型，即用于表示枚举值的运行时类型。在此示例中，这是 `TNode<Smi>`，因为这是 `Smi` `generates` 的类型。由于在枚举中未指定  `constexpr` 子句来替换默认名称，因此 `constexpr LanguageMode` 在生成的 CSA 文件中会转换为 `LanguageMode`。如果省略 `extends` 子句，Torque 将仅生成该类型的 `constexpr` 版本。`extern` 关键字告诉 Torque这个枚举由 C++ 定义。 当前，仅支持 `extern` 枚举。

Torque 为每个枚举项生成不同的类型和常量。它们是在与枚举名称匹配的命名空间中定义的。 生成必要的 `FromConstexpr<>` 专业化功能，以将条目的 `constexpr` 类型转换为枚举类型。为 C++ 文件中的条目生成的值是 `<enum-constexpr>::<entry-name>`，其中 `<enum-constexpr>` 是为枚举生成的`constexpr` 名称。在上面的示例中，它们是 `LanguageMode::kStrict` 和 `LanguageMode::kSloppy`。

Torque 的枚举与 `typeswitch` 构造一起很好地工作，因为这些值是使用不同的类型定义的：

```torque
typeswitch(language_mode) {
  case (LanguageMode::kStrict): {
    // ...
  }
  case (LanguageMode::kSloppy): {
    // ...
  }
}
```

如果枚举的 C++ 定义包含的值比 `.tq` 文件中使用的值更多，则 Torque 需要知道这一点。这是通过在最后一个条目之后附加一个 `...` 来声明枚举 ' open‘ 来完成的。以 `ExtractFixedArrayFlag` 为例，在 Torque 中只有某些选项可用/使用：

```torque
enum ExtractFixedArrayFlag constexpr 'CodeStubAssembler::ExtractFixedArrayFlag' {
  kFixedDoubleArrays,
  kAllFixedArrays,
  kFixedArrays,
  ...
}
```

### 可调用对象 { #callables }

从概念上讲，可调用对象（Callables）类似于 JavaScript 或 C++ 中的函数，但是它们具有一些附加的语义，使它们可以以有用的方式与 CSA 代码和 V8 运行时进行交互。Torque 提供了几种不同类型的可调用对象：`macro`，`builtin`，`runtime` 和 `intrinsic`。

```grammar
CallableDeclaration :
  MacroDeclaration
  BuiltinDeclaration
  RuntimeDeclaration
  IntrinsicDeclaration
```

#### `macro` 可调用对象 { #macro-callables }

宏（Macros）是可调用的，它对应于生成的生成 CSA（CSA-producing）的 C++ 块。`macro` 可以在 Torque 中完全定义，在这种情况下，CSA 代码由Torque 生成，也可以标记为 `extern`，在这种情况下，必须在 CodeStubAssembler 类中以手写 CSA 代码的形式提供实现。从概念上讲，考虑在 callsites 内联的可插入的 CSA 代码的 `macro` 是很有用的。

Torque中的 `macro` 声明采用以下形式：

```grammar
MacroDeclaration :
   transitioning opt macro IdentifierName ImplicitParameters opt ExplicitParameters ReturnType opt LabelsDeclaration opt StatementBlock
  extern transitioning opt macro IdentifierName ImplicitParameters opt ExplicitTypes ReturnType opt LabelsDeclaration opt ;
```

每个非 `extern` Torque `macro` 都使用它的 `StatementBlock` 主体在其命名空间的生成的 `Assembler` 类中创建 CSA 生成（CSA-generating）函数。该代码看起来与你可以在 `code-stub-assembler.cc` 中找到的其它代码一样，尽管可读性较低，因为它是机器生成的。标为 `extern` 的 `macro` 没有用 Torque 编写的主体，而只是提供了手写 C++ CSA 代码的接口，以便可以从 Torque 使用。

`macro` 定义指定隐式和显式参数，以及可选的返回类型和可选的标签。参数和返回类型将在下面更详细地讨论，但是到目前为止，只要知道它们的工作方式与 TypeScript 参数类似就足够了，正如 [TypeScript 文档的 Function Types 部分](https://www.typescriptlang.org/docs/handbook/functions.html)中所讨论的那样。

标签是一种异常退出 `macro` 的机制。它们将 1:1 映射到 CSA 标签，并作为 `CodeStubAssemblerLabels*`- 类型的参数添加到为 `macro` 生成的C ++方法中。它们的确切语义在下面进行了讨论，但是出于 `macro` 声明的目的，以逗号分隔的 `macro` 标签列表可选地带有 `labels`  关键字，并位于 `macro` 的参数列表和返回类型之后。

这是来自 `base.tq` 的外部和 Torque 定义（Torque-defined）的  `macro` 示例：

```torque
extern macro BranchIfFastJSArrayForCopy(Object, Context): never
    labels Taken, NotTaken;
macro BranchIfNotFastJSArrayForCopy(implicit context: Context)(o: Object):
    never
    labels Taken, NotTaken {
  BranchIfFastJSArrayForCopy(o, context) otherwise NotTaken, Taken;
}
```

#### `builtin` 可调用对象 { #builtin-callables }

`builtin` 与 `macro` 类似，因为它们可以在 Torque 中完全定义，也可以标记为 `extern`。在基于 Torque（Torque-based）的内置实例中，内置主体用于生成 V8 内置函数，可以像其它任何 V8 内置函数一样调用它，包括自动在 `builtin-definitions.h` 中添加相关信息。像 `macro` 一样，标记为 `extern` 的 Torque `builtin` 没有基于 Torque 的主体，仅提供与现有 V8 `builtin` 的接口，以便可以从 Torque 代码中使用它们。

Torque中的 `builtin` 声明具有以下形式：

```grammar
MacroDeclaration :
  transitioning opt javascript opt builtin IdentifierName ImplicitParameters opt ExplicitParametersOrVarArgs ReturnType opt StatementBlock
  extern transitioning opt javascript opt builtin IdentifierName ImplicitParameters opt ExplicitTypesOrVarArgs ReturnType opt ;
```

Torque 内置代码只有一个副本，即在生成的内置代码对象中。与 `macro` 不同，从 Torque 代码调用 `builtin` 时，不会在 callsite 内联 CSA 代码，而是会生成对内置函数的调用。

`builtin` 文件不能具有标签。

如果你正在编码 `builtin` 的实现，则可以对内置函数或运行时函数（当且仅当它是内置函数中的最终调用）进行尾调用。在这种情况下，编译器可能能够避免创建新的堆栈帧。只需在调用之前添加 `tail` 即可，如 `tail MyBuiltin(foo, bar);` 中所示。

#### `runtime` 可调用对象 { #runtime-callables }

`runtime` 与 `builtin` 相似，因为它们可以将接口暴露给 Torque 外部功能。但是，`runtime` 提供的功能必须始终在 V8 中作为标准运行时回调来实现，而不是在 CSA 中实现。

Torque 中的 `runtime` 声明具有以下形式：

```grammar
MacroDeclaration :
  extern transitioning opt runtime IdentifierName ImplicitParameters opt ExplicitTypesOrVarArgs ReturnType opt ;
```

名称为 <i>IdentifierName</i> 的  `extern runtime` 对应于 <code>Runtime::k<i>IdentifierName</i></code> 指定的运行时函数。

像 `builtin` 一样，`runtime` 不能具有标签。

你也可以在适当时将 `runtime` 函数作为尾部调用。 只需在调用之前添加tail关键字即可。只需在调用之前添加 `tail` 关键字即可。

#### `intrinsic` 可调用对象 { #intrinsic-callables }

`intrinsic` 是内置的 Torque 可调用对象，可提供对内部功能的访问，而这些功能在其它情况下无法在 Torque 中实现。它们是在 Torque 中声明的，但未定义，因为该实现是由 Torque 编译器提供的。`intrinsic` 声明使用以下语法：

```grammar
IntrinsicDeclaration :
  intrinsic % IdentifierName ImplicitParameters opt ExplicitParameters ReturnType opt ;
```

在大多数情况下，“用户的” Torque 代码很少应该直接使用 `intrinsic`。 当前支持的内部函数（intrinsics）是：

```torque
// %RawObjectCast downcasts from Object to a subtype of Object without
// rigorous testing if the object is actually the destination type.
// RawObjectCasts should *never* (well, almost never) be used anywhere in
// Torque code except for in Torque-based UnsafeCast operators preceeded by an
// appropriate type assert()
intrinsic %RawObjectCast<A: type>(o: Object): A;

// %RawPointerCast downcasts from RawPtr to a subtype of RawPtr without
// rigorous testing if the object is actually the destination type.
intrinsic %RawPointerCast<A: type>(p: RawPtr): A;

// %RawConstexprCast converts one compile-time constant value to another.
// Both the source and destination types should be 'constexpr'.
// %RawConstexprCast translate to static_casts in the generated C++ code.
intrinsic %RawConstexprCast<To: type, From: type>(f: From): To;

// %FromConstexpr converts a constexpr value into into a non-constexpr
// value. Currently, only conversion to the following non-constexpr types
// are supported: Smi, Number, String, uintptr, intptr, and int32
intrinsic %FromConstexpr<To: type, From: type>(b: From): To;

// %Allocate allocates an unitialized object of size 'size' from V8's
// GC heap and "reinterpret casts" the resulting object pointer to the
// specified Torque class, allowing constructors to subsequently use
// standard field access operators to initialize the object.
// This intrinsic should never be called from Torque code. It's used
// internally when desugaring the 'new' operator.
intrinsic %Allocate<Class: type>(size: intptr): Class;
```

像 `builtin` 和 `runtime` 一样，`intrinsic` 不能具有标签。

### 显式参数 { #explicit-parameters }

Torque 定义（Torque-defined）的可调用对象的声明，例如，Torque  `macro` 和 `builtin` 具有明确的参数列表。它们是标识符（identifier）和类型对的列表，使用的语法让人联想到带类型的 TypeScript 函数参数列表，但 Torque 不支持可选参数或默认参数。此外，如果内建函数使用 V8 的内部 JavaScript调用约定（例如，用 `javascript` 关键字标记），则 Torque 实现的（Torque-implement ）`builtin` 可以选择支持剩余（rest）参数。

```grammar
ExplicitParameters :
  ( ( IdentifierName : TypeIdentifierName ) list* )
  ( ( IdentifierName : TypeIdentifierName ) list+ (, ... IdentifierName ) opt )
```

举个例子：

```torque
javascript builtin ArraySlice(
    (implicit context: Context)(receiver: Object, ...arguments): Object {
  // …
}
```

### 隐式参数 { #implicit-parameters }

Torque 可调用对象可以使用类似于 [Scala 的隐式参数](https://docs.scala-lang.org/tour/implicit-parameters.html) 的方式指定隐式参数：

```grammar
ImplicitParameters :
  ( implicit ( IdentifierName : TypeIdentifierName ) list* )
```

具体来说：`macro` 除了可以声明显式参数外，还可以声明隐式参数：

```torque
macro Foo(implicit context: Context)(x: Smi, y: Smi)
```

映射到 CSA 时，隐式参数和显式参数被视为相同的，并形成联合参数列表。

callsite 未提及隐式参数，而是隐式传递参数：`Foo(4, 5)`。为此，必须在提供名为 `context` 的值的上下文中调用 `Foo(4, 5)`。 例子：

```torque
macro Bar(implicit context: Context)() {
  Foo(4, 5);
}
```

与 Scala 相比，如果隐式参数的名称不同，则我们禁止这样做。

由于重载解析（overload resolution）会导致混乱的行为，因此我们确保隐式参数根本不会影响重载解析。即：在比较重载集合的候选者时，我们不考虑 call-site 上可用的隐式绑定。仅在找到单个最佳重载之后，我们才检查隐式参数的隐式绑定是否可用。

在显式参数中保留隐式参数与 Scala 有所不同，但可以更好地映射到 CSA 中的现有约定，使其首先具有  `context` 参数。

#### `js-implicit`

对于在 Torque 中定义的具有 JavaScript 链接的内置程序，应使用关键字 `js-implicit` 而不是 `implicit` 关键字。参数仅限于调用约定的以下四个组成部分：

- context: `NativeContext`
- receiver: `JSAny` (`this` in JavaScript)
- target: `JSFunction` (`arguments.callee` in JavaScript)
- newTarget: `JSAny` (`new.target` in JavaScript)

它们不必全部声明，而只需要声明你要使用的即可。 例如，这是我们用于 `Array.prototype.shift` 的代码：

```torque
  // https://tc39.es/ecma262/#sec-array.prototype.shift
  transitioning javascript builtin ArrayPrototypeShift(
      js-implicit context: NativeContext, receiver: JSAny)(...arguments): JSAny {
  ...
```

请注意，`context` 参数是 `NativeContext`。这是因为 V8 中的内置程序始终在其闭包中嵌入本机上下文（native context）。使用 js-implicit 约定对此进行编码，使程序员可以消除从函数上下文中加载本机上下文的操作。

### 重载解析 { #overload-resolution }

Torque `macro` 和运算符（它们只是 `macro` 的别名）允许参数类型重载（overloading）。重载规则是受 C++ 启发的：如果重载严格优于所有替代方法，则选择重载。这意味着它必须在至少一个参数的情况下严格地更好，而在所有多个参数的情况下都必须更好或同样好。

比较两个重载的一对对应的参数时…

- …它们被认为同样好，如果：
    - 它们是一致的；
    - 两者都需要一些隐式转换。
- …如果满足以下条件，则认为第一种更好：
    - 它是另一个的严格子类型；
    - 它不需要隐式转换，而另一个则需要。

如果没有重载严格地优于所有替代方法，则将导致编译错误。

### 延迟块 { #deferred-blocks }

可以选择将语句块标记为 `deferred`，这是向编译器发出的信号，表明它的输入频率降低了。编译器可以选择将这些块放置在函数的末尾，从而提高了非延迟（non-deferred）代码区域的缓存局部性（cache locality）。例如，在 `Array.prototype.forEach` 实现的以下代码中，我们希望保留在“快速”路径上，并且很少采用 Bailout 方案：

```torque
  let k: Number = 0;
  try {
    return FastArrayForEach(o, len, callbackfn, thisArg)
        otherwise Bailout;
  }
  label Bailout(kValue: Smi) deferred {
    k = kValue;
  }
```

这是另一个示例，其中将字典元素（DICTIONARY_ELEMENTS）的情形标记为 deferred，以改善更相似情形的代码生成（来自 `Array.prototype.join` 实现）：

```torque
  if (IsElementsKindLessThanOrEqual(kind, HOLEY_ELEMENTS)) {
    loadFn = LoadJoinElement<FastSmiOrObjectElements>;
  } else if (IsElementsKindLessThanOrEqual(kind, HOLEY_DOUBLE_ELEMENTS)) {
    loadFn = LoadJoinElement<FastDoubleElements>;
  } else if (kind == DICTIONARY_ELEMENTS)
    deferred {
      const dict: NumberDictionary =
          UnsafeCast<NumberDictionary>(array.elements);
      const nofElements: Smi = GetNumberDictionaryNumberOfElements(dict);
      // <etc>...
```

## 将 CSA 代码移植到 Torque  { #porting-csa-code-to-torque }

[移植了 `Array.of` 的补丁](https://chromium-review.googlesource.com/c/v8/v8/+/1296464) 提供了将 CSA 代码移植到 Torque 的最小示例。
