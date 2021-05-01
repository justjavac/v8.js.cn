---
title: '使用 V8 分析 Chromium'
description: '本文档介绍了如何在 Chromium 中使用 V8 的 CPU 和堆分析器。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
从 V8 的 shell 程序中使用 [V8 的 CPU 和 堆分析器](/docs/profile)很简单，但是如何将它们与 Chromium 一起使用可能会感到困惑。此页面可以给你提供帮助。

## 为什么在 Chromium 中使用 V8 分析器与在 V8 shell 中使用它们不同？ { #why-is-using-v8’s-profilers-with-chromium-different-from-using-them-with-v8-shells? }

与 V8 shell 不同，Chromium 是一个复杂的应用程序。以下是影响分析器使用的 Chromium 功能列表：

- 每个渲染器都是一个单独的进程（好的，实际上不是每个渲染器，但我们省略此细节），因此它们不能共享相同的日志文件；
- 为渲染器进程构建的沙盒可防止其写入磁盘；
- 开发者工具出于自己的目的配置了分析器；
- V8 的日志记录代码包含一些优化，以简化日志记录状态检查。

## 如何运行 Chromium 获取 CPU 分析日志？ { #how-to-run-chromium-to-get-a-cpu-profile? }

以下是运行 Chromium 的方法，以便从进程开始时获取 CPU 分析日志：

```bash
./Chromium --no-sandbox --user-data-dir=`mktemp -d` --incognito --js-flags='--prof'
```

请注意，你不会在开发者工具中看到分析记录，因为所有数据都已记录到文件中，而不是开发者工具中。

### 标志说明 { #flags-description }

`--no-sandbox` 关闭渲染器沙盒，以便 chrome 可以写入日志文件。

`--user-data-dir` 用于创建一个新的分析记录，用它来避免已安装扩展的缓存和潜在的副作用（可选）。

`--incognito` 用于进一步防止结果受影响（可选）。

`--js-flags` 包含传递给 V8 的标志：

- `--logfile=%t.log` 指定日志文件的名称模式。`%t` 以毫秒为单位扩展到当前时间，因此每个进程都有自己的日志文件。你可以根据需要使用前缀和后缀，例如：`prefix-％t-suffix.log`。默认情况下，每个 isolate 都会获取一个单独的日志文件。
- `--prof` 告诉 V8 将统计分析信息写入日志文件。

## Android { #android }

Android 上的 Chrome 浏览器具有许多独特之处，这使其分析起来更加复杂。

- 在设备上启动 Chrome 之前，必须通过 `adb` 编写命令行。结果，命令行中的引号有时会丢失，并且最好用逗号分隔 `--js-flags`  中的参数，而不要尝试使用空格和引号。
- 日志文件的路径必须指定为 Android 文件系统上可写位置的绝对路径。
- Android 上用于渲染器进程的沙盒意味着即使使用 `--no-sandbox`，渲染器进程仍无法写入文件系统上的文件，因此，需要传递 `--single-process` 才能在与浏览器进程相同的进程中运行渲染器 。
- `.so` 嵌入在 Chrome 的 APK 中，这意味着符号化需要从 APK 内存地址转换为构建中未剥离的 `.so`  文件。

以下命令可在 Android 上启用性能分析：

```bash
./build/android/adb_chrome_public_command_line --no-sandbox --single-process --js-flags='--logfile=/storage/emulated/0/Download/%t.log,--prof'
<Close and relaunch Chome on the Android device>
adb pull /storage/emulated/0/Download/<logfile>
./src/v8/tools/linux-tick-processor --apk-embedded-library=out/Release/lib.unstripped/libchrome.so --preprocess <logfile>
```

## 注意 { #notes }

在 Windows 下，请确保为 `chrome.dll` 打开 `.MAP` 文件创建功能，而不是为 `chrome.exe`。
