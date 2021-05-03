---
title: '运行时调用统计（Runtime Call Stats）'
description: '本文档说明了如何使用运行时调用统计信息来获取详细的 V8 内部指标。'
cn:
  author: "不如怀念 ([@wang1212](https://github.com/wang1212))"
---
[DevTools 性能（Performance）面板](https://developers.google.com/web/tools/chrome-devtools/evaluate-performance/)通过可视化各种 Chrome 内部指标来深入了解你的网络应用的运行时性能。但是，DevTools 当前未公开某些低级别的  V8 指标。本文引导你通过 `chrome://tracing`，以最可靠的方式收集详细的 V8 内部指标，称为“运行时调用统计”（Runtime Call Stats 或 RCS）。

跟踪记录整个浏览器的行为，包括其它选项卡、窗口和扩展程序；因此，在干净的用户配置文件中，禁用扩展程序且未打开其它浏览器选项卡的情况下，它的工作效果最佳：

```bash
# Start a new Chrome browser session with a clean user profile and extensions disabled
google-chrome --user-data-dir="$(mktemp -d)" --disable-extensions
```

在第一个标签中输入你要测量的页面的 URL，但不要加载该页面。

![](/_img/rcs/01.png)

添加第二个标签并打开 `chrome://tracing`。提示：你可以仅输入 `chrome:tracing`，省略斜杠。

![](/_img/rcs/02.png)

点击“记录”（Record）按钮以准备记录跟踪信息。首先选择“Web 开发者”（Web developer），然后选择“编辑类别”（Edit categories）。

![](/_img/rcs/03.png)

从列表中选择 `v8.runtime_stats`。根据调查的详细程度，你还可以选择其它类别。

![](/_img/rcs/04.png)

按“记录”（Record）同时切换回第一个选项卡并加载页面。最快的方法是使用 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>1</kbd> 直接跳到第一个标签，然后按 <kbd>Enter</kbd> 接受输入的 URL。

![](/_img/rcs/05.png)

等待直到页面完成加载或缓冲区已满，然后“停止”（Stop）记录。

![](/_img/rcs/06.png)

从中查找包含记录选项卡的网页标题的 "Renderer" 部分。最简单的方法是单击“进程”（Processes），然后单击“无”（None）以取消选中所有条目，然后仅选择你感兴趣的渲染器（renderer）。

![](/_img/rcs/07.png)

通过按 <kbd>Shift</kbd> 并拖动来选择跟踪事件/片段。确保覆盖 _所有_ 部分，包括 `CrRendererMain` 和任何 `ThreadPoolForegroundWorker`。包含所有选定片段的表格将显示在底部。

![](/_img/rcs/08.png)

滚动到表的右上角，然后单击“运行时调用统计表”（Runtime call stats table）旁边的链接。

![](/_img/rcs/09.png)

在出现的视图中，滚动到底部以查看 V8 花费时间的详细表格。

![](/_img/rcs/10.png)

通过展开某个类别，你可以进一步深入查看具体数据。

![](/_img/rcs/11.png)

## 命令行接口 { #cli }

使用 `--runtime-call-stats` 运行 [`d8`](/docs/d8)，以从命令行获取 RCS 指标：

```bash
d8 --runtime-call-stats foo.js
```
