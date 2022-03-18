---
title: '发布流程'
description: '这篇文档解释了 V8 的版本发布流程'
cn:
  author: '迷渡 ([@justjavac](https://github.com/justjavac))，V8.js.cn 站长'
  avatars:
    - justjavac
---

V8 发布流程与 [Chrome 的发布流程](https://www.chromium.org/getting-involved/dev-channel)紧密关联。V8 团队也使用全部 4 种 Chrome 发布渠道向用户推送新版本。

如果您想查看 Chrome 版本中的 V8 版本，可以在 [OmahaProxy](https://omahaproxy.appspot.com) 中查看。对于每个 Chrome 版本，都会在 V8 代码库中创建单独的分支，以便使跟踪更容易，例如 [Chrome 94.0.4606.61](https://chromium.googlesource.com/v8/v8.git/+/chromium/4606)。

## Canary releases 金丝雀版 {#canary-releases}

通过 [Chrome's Canary channel](https://www.google.com/chrome/browser/canary.html?platform=win64)，每天都有新的 Canary 版本被推送给用户。正常情况下，这个版本来自 [main](https://chromium.googlesource.com/v8/v8.git/+/refs/heads/main) 分支的最新，足够稳定的版本。

Canary 分支通常是这样的：

```
remotes/origin/9.4.146
```

## Dev releases 开发版 {#dev-releases}

通过 [Chrome's Dev channel](https://www.google.com/chrome/browser/desktop/index.html?extra=devchannel&platform=win64)，每周都会有一个新的开发版本推送给用户。正常情况下，这个版本包括 Canary 频道上最新稳定的 V8 版本。

Dev 的分支通常看起来像这样：

```
remotes/origin/9.4.146
```

## Beta releases 测试版 {#beta-releases}

大约每 4 周就会创建一个新的主要分支，例如 [Chrome 94](https://chromium.googlesource.com/v8/v8.git/+log/branch-heads/9.4)。这与 [Chrome's Beta channel](https://www.google.com/chrome/browser/beta.html?platform=win64) 的创建同步发生。Chrome Beta 被固定在 V8 的 branch-heads。约 4 周时间分支被提升到 Stable。

所有的更改仅 cherry-picked 到稳定版。

Beta 的分支通常看起来像这样：

```
remotes/branch-heads/9.4
```

它们基于 Canary 分支创建。

## Stable releases 稳定版 {#stable-releases}

大约每 4 周就会有一个新的主要稳定版本完成。由于最新的 Beta 分支只是简单地升级为 Stable，因此不会创建特殊的分支。该版本通过 [Chrome's Stable channel](https://www.google.com/chrome/browser/desktop/index.html?platform=win64) 推送给用户。

Stable 的分支通常是这样的

```
remotes/branch-heads/9.4
```

他们由 Beta 分支提升（或重用）而来。

## 我应该将哪个版本嵌入到我的应用程序中？ {#which-version-should-i-embed-in-my-application%3F}

你应该使用：Chrome's Stable channel 的最新分支。

我们经常会将重要的 bug fixes 重新合并到稳定的分支，所以如果您关心稳定性和安全性以及正确性，则应该包括这些更新 - 这就是为什么我们推荐“分支的尖端”，而不是确切版本。

只要一个新分支被提升为 Stable，我们就会停止维护之前的稳定分支。这种情况每六周发生一次，所以你应该准备经常更新。

例如：目前稳定的 Chrome 版本是 [94.0.4606.61](https://omahaproxy.appspot.com)，对应的 V8 版本是 v9.4.146.17。所以你应该嵌入 [branch-heads/9.4](https://chromium.googlesource.com/v8/v8.git/+/branch-heads/9.4)。而当 Chrome 95 进入 stable 频道时，您应该更新到分支 branch-heads/9.5。

**相关阅读:** [我应该使用哪个版本的 V8?](/docs/version-numbers#which-v8-version-should-i-use%3F)
