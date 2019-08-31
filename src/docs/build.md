---
title: "由源码构建 V8"
description: '这篇文档解释了如何从源代码构建 V8 项目'
cn:
  author: "Suyan ([@suyanhanx](https://github.com/suyanhanx))"
  avatars:
    - suyanhanx
---

为了能在 64 位 Windows/Linux/macOS 系统上从源码编译 V8，请遵循以下步骤。

## 获取 V8 源码

依照我们的指南的步骤[获取 V8 源码](/docs/source-code)。

## 安装构建依赖

1. 在 macOS 上: 安装 Xcode 并接受它的许可协议。（如果你已经单独安装了命令行工具，[先卸载它](https://bugs.chromium.org/p/chromium/issues/detail?id=729990#c1).）

2. 确保你在 V8 源码目录下。如果你按照前文的步骤操作了，你现在应该已经在正确的位置了。

3. 下载所有构建需要的依赖:

   ```bash
   gclient sync
   ```

4. 这一步只有 Linux 需要。下载额外的构建依赖:

   ```bash
   ./build/install-build-deps.sh
   ```

## 构建 V8

1. 确保你现在在 V8 的源码目录下且位于 `master` 分支。

   ```bash
   cd /path/to/v8
   ```

2. 拉取最新代码并安装任何新的构建依赖：

   ```bash
   git pull && gclient sync
   ```

3. 编译：

   ```bash
   tools/dev/gm.py x64.release
   ```

   或者编译并立即执行测试：

   ```bash
   tools/dev/gm.py x64.release.check
   ```

   关于 `gm.py` 帮助类脚本的更多信息和它触发的命令，参见[使用 GN 构建](/docs/build-gn).
