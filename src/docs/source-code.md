---
title: '检出 V8 源码'
author: 'who who who ([@fsx950223](https://github.com/fsx950223)),good at javascript'
---
本文档介绍了如何在本地检出V8源代码。如果你只是想浏览线上代码，请使用这些链接:

- [browse](https://chromium.googlesource.com/v8/v8/)
- [browse bleeding edge](https://chromium.googlesource.com/v8/v8/+/master)
- [changes](https://chromium.googlesource.com/v8/v8/+log/master)

## 使用 Git {#using-git}

V8 的 Git 项目位于 <https://chromium.googlesource.com/v8/v8.git>, 并且有一个 Github 的官方镜像: <https://github.com/v8/v8>。

不要直接 `git clone` 这些链接! 如果你想构建 V8，请按照如下说明执行构建。

## 说明 {#instructions}

1. 在 Linux 或 macOS 上，首先安装 Git， 然后安装 [`depot_tools`](https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up).
    在 Windows 上, 依照 Chromium 说明（[for Googlers](https://goto.google.com/building-chrome-win), [for non-Googlers](https://chromium.googlesource.com/chromium/src/+/master/docs/windows_build_instructions.md#Setting-up-Windows)）安装 Visual Studio,Windows 的调试工具与 `depot_tools` (which on Windows includes Git).

1. 在终端执行如下语句来更新 `depot_tools`。 在 Windows 中必须使用 `cmd.exe` 执行, 而不是 Powershell。

    ```
    gclient
    ```

1. 为了使用 **push access**，你需要使用你的 Git 密码安装 `.netrc` 文件:

    1. 使用你的提交账户登陆 <https://chromium.googlesource.com/new-password>（通常是 `@chromium.org` 账户）。注意：创建新密码不会自动撤消以前创建的任何密码。请确保使用与 `git config user.email` 相同的电子邮件。
    1. 看看包含shell命令的大灰盒子。将这些行粘贴到您的shell中。

1. 现在，获取包含所有分支和依赖的 V8 源码：

    ```bash
    mkdir ~/v8
    cd ~/v8
    fetch v8
    cd v8
    ```

现在，你处于一个独立的头状态。

你可以选择指定应如何跟踪新分支：

```bash
git config branch.autosetupmerge always
git config branch.autosetuprebase always
```

另外，你可以用如下命令创建分支 (推荐)：

```bash
git new-branch fix-bug-1234
```

## 保持更新 {#staying-up-to-date}

使用 `git pull` 更新分支。注意：如果你不在一个分支上 `git pull` 将不起作用，你需要使用 `git fetch`。

```bash
git pull
```

一般情况下 V8 的依赖都是最新的。你可以通过使用如下命令同步依赖:

```bash
gclient sync
```

## 发送用于审核的代码 {#sending-code-for-reviewing}

```bash
git cl upload
```

## 提交 {#committing}

你可以使用 CQ 选项进行提交 (推荐). 在 [chromium instructions](https://www.chromium.org/developers/testing/commit-queue) 上查阅 CQ 标志位与故障排除。

如果你需要更多测试机器人，在 Gerrit 添加如下提交信息（e.g. 添加一个 nosnap 机器人）：

```
CQ_INCLUDE_TRYBOTS=tryserver.v8:v8_linux_nosnap_rel
```

请主动更新您的分支:

```bash
git pull --rebase origin
```

然后提交

```bash
git cl land
```

## 尝试作业 {#try-jobs}

这部分只针对 V8 项目成员。

### 从 codereview 创建测试作业 {#creating-a-try-job-from-codereview}

1. 将 CL 上传到 Gerrit 。

    ```bash
    git cl upload
    ```

1. 尝试向机器人发送测试的 CL：

    ```bash
    git cl try
    ```

1. 等待测试机器人构建，然后您收到一封包含结果的电子邮件。您还可以在 Gerrit 的补丁中查看测试状态。

1. 如果应用修补程序失败，则需要重新绑定补丁或指定要同步的V8修订版：

```bash
git cl try --revision=1234
```

### 从本地分支创建测试作业 {#creating-a-try-job-from-a-local-branch}

1. 给本地项目的一个分支提交一些修改。

1. 使用如下命令尝试修改：

    ```bash
    git cl try
    ```

1. 等待测试机器人构建，然后您收到一封包含结果的电子邮件。注意：目前有些附件存在问题。建议从 codereview 发送测试作业。

### 实用参数 {#useful-arguments}

revision 参数告诉测试机器人你的本地修改用于什么版本的代码库。 可以用 [V8’s LKGR revision](https://v8-status.appspot.com/lkgr) 替代 revision。

```bash
git cl try --revision=1234
```

为了避免在所有的机器人上运行测试作业，使用 `--bot` 标志指定一个以逗号分隔的构建器名称列表。例子：

```bash
git cl try --bot=v8_mac_rel
```

### 查看测试服务器 {#viewing-the-try-server}

```bash
git cl try-results
```

## 源码分支 {#source-code-branches}

V8有几个不同的分支;如果你不确定要获得哪个版本，你很可能想要最新的稳定版本。有关所使用的不同分支的更多信息，请查看我们的[[发布过程|发布过程]]。

您可能需要关注Chrome在其稳定（或测试版）渠道上发布的V8版本，请查阅 <https://omahaproxy.appspot.com/>.
