---
title: 'V8 的 Linux `perf` 集成'
description: '本文档说明了如何使用 Linux `perf` 工具分析 V8 的 JITted 代码的性能。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
V8 内置了对 Linux `perf` 工具的支持。默认情况下，此支持处于禁用状态，但是通过使用 `--perf-prof` 和 `--perf-prof-debug-info` 命令行选项，V8 在执行期间会将性能数据写到一个文件中，该文件可用于使用 Linux `perf` 工具分析 V8 的 JITted 代码的性能。

## 可选：获取最新内核和 `perf` { #optional:-get-recent-kernel-and-perf }

为了使用 Linux `perf` 工具分析 V8 JIT 代码，你需要：

- 使用最新的 Linux 内核为 `perf` 工具和 V8 的 `perf` 集成提供高分辨率的时序信息，以使 JIT 代码性能样本与 Linux `perf` 工具收集的标准性能数据同步。
- 使用最新版本的 Linux `perf` 工具或将支持 JIT 代码的补丁应用到 `perf` 并自行构建。

安装新的 Linux 内核，然后重新启动计算机：

```bash
sudo apt-get install linux-generic-lts-wily
```

安装依赖：

```bash
sudo apt-get install libdw-dev libunwind8-dev systemtap-sdt-dev libaudit-dev \
    libslang2-dev binutils-dev liblzma-dev
```

下载包含最新的 `perf` 工具源的内核源：

```bash
cd <path_to_kernel_checkout>
git clone --depth 1 git://git.kernel.org/pub/scm/linux/kernel/git/tip/tip.git
cd tip/tools/perf
make
```

在以下步骤中，以 `<path_to_kernel_checkout>/tip/tools/perf/perf` 调用 `perf`。

## 构建 V8 { #build-v8 }

要将 V8 与 Linux perf 集成使用，你需要在激活了适当的 GN build 标志的情况下进行构建。你可以在现有的 GN 构建配置中设置 `enable_profiling = true`。

```bash
echo 'enable_profiling = true' >> out/x64.release/args.gn
ninja -C out/x64.release
```

或者，你创建一个新的纯净的构建配置，仅设置单个构建标志以启用 `perf` 支持：

```bash
cd <path_to_your_v8_checkout>
gn gen out/x64.release \
    --args='is_debug=false target_cpu="x64" enable_profiling=true'
ninja -C out/x64.release
```

## 使用 perf 标志运行 `d8` { #running-d8-with-perf-flags }

一旦有了正确的内核，perf 工具和 V8 的构建，就可以开始使用 linux perf 了：

```bash
cd <path_to_your_v8_checkout>
echo '(function f() {
    var s = 0; for (var i = 0; i < 1000000000; i++) { s += i; } return s;
  })();' > test.js
perf record -g -k mono out/x64.release/d8 \
    --perf-prof --no-write-protect-code-memory test.js
```

### 标志说明 { #flags-description }

[`--perf-prof`](https://source.chromium.org/search?q=FLAG_perf_prof) 用于 V8 命令行，以记录 JIT 代码性能样本。

[`--nowrite-protect-code-memory`](https://source.chromium.org/search?q=FLAG_nowrite_protect_code_memory) 被要求禁用对代码存储器的写保护。这是必要的，因为当 `perf` 看到与从代码页中删除写位相对应的事件时，它会丢弃有关代码页的信息。这是一个记录来自一个测试 JavaScript 文件的样本的示例：

[`--interpreted-frames-native-stack`](https://source.chromium.org/search?q=FLAG_interpreted_frames_native_stack) 用于为解释函数创建不同的入口点（InterpreterEntryTrampoline 的复制版本），以便可以仅基于地址通过 `perf` 对其进行区分。

## 使用 perf 标志运行 `chrome` { #running-chrome-with-perf-flags }

1. 你可以使用相同的 V8 标志来分析 chrome 本身。请按照上述说明获取正确的 V8 标志，然后将[所需的 chrome gn 标志](https://chromium.googlesource.com/chromium/src/+/master/docs/profiling.md#preparing-your-checkout)添加到 chrome 构建中。

1. 构建完成后，你就可以使用 C++ 和 JS 代码的完整符号对网站进行分析。

    ```
    out/x64.release/chrome --user-data-dir=`mktemp -d` --no-sandbox --incognito \
        --js-flags='--perf-prof --no-write-protect-code-memory --interpreted-frames-native-stack'
    ```

1. 启动 chrome 后，使用“任务管理器”（Task Manager）找到渲染器（renderer）进程 ID，并使用它开始分析：

    ```
    perf record -g -k mono -p $RENDERER_PID -o perf.data
    ```

1. 导航到你的网站，然后继续有关如何评估性能输出的下一部分。

## 评估 perf 输出 { #evaluating-perf-output }

执行完成后，必须将从 `perf` 工具收集的静态信息与 V8 针对 JIT 代码输出的性能样本结合起来：

```bash
perf inject -j -i perf.data -o perf.data.jitted
```

最后，你可以使用 Linux `perf` 工具来探索你的 JITted 代码中的性能瓶颈：

```bash
perf report -i perf.data.jitted
```

你还可以将 `perf.data.jitted` 文件与 [perf_to_profile](https://github.com/google/perf_data_converter) 转换为与 [pprof](https://github.com/google/pprof) 一起使用，以生成更多可视化效果：

```
~/Documents/perf_data_converter/bazel-bin/src/perf_to_profile -j -i perf.data.jitted -o out.prof;
pprof -http out.prof;
```
