# Nautilus Log

> **给每一分钟分配一份工作。**

一个面向 Roam Research 的可视化日计划工具。Nautilus Log 把一篇 Daily Note
变成动态螺旋日程：固定事件保持不动，弹性任务进入剩余时间，超载工作始终可见。

[English](./README.md) · **简体中文** · [使用指南](./docs/guide.zh-CN.md)

![Nautilus Log 螺旋日计划、Timing、Plan、Review 与右侧边栏视图](https://raw.githubusercontent.com/404KSG/roam-nautilus-log/main/docs/assets/nautilus-log-overview.png)

## 它能带来什么

- **让计划真正放进时间。** 同时看到 Planned、Available、固定 Events、剩余容量，
  以及今天放不下的工作。
- **透明而灵活的排程。** 事件保留原定时间，未完成任务按照 Roam block 顺序向前推进。
- **让一天适应你的作息。** 可以从任意整点开始，并按需把计划连续延伸到次日。
- **低摩擦执行。** 可以只使用预计时长，也可以启动独立 POMO，或按需用兼容的
  `LOGBOOK::` / `CLOCK:` 记录任务时间。
- **有依据的每日回顾。** 直接在普通 Roam block 上比较 Planned 与 Actual。

排程规则完全确定：事件先占用自己的时间范围，再从当前时刻开始，把完整任务依次放入
足够大的空档。放不下的任务进入**今日放不下**，不会被静默丢弃。

## 快速开始

1. 从 Roam Depot 安装 **Nautilus Log**；更新处于审核阶段时，使用对应 Depot PR
   中给出的 ShortHand。
2. 在今天的 Daily Note 输入 `;;`，选择 **Nautilus Log**。
3. 把固定事件和 TODO 写成组件的直接子级。
4. 排列任务，并为每项任务填写粗略时长。

```text
05:00-06:00 Morning routine
{{[[TODO]]}} 撰写项目简报 45m
{{[[TODO]]}} 复习笔记 30m
11:45-12:30 Lunch
```

时长支持 `30m`、`30min`、`1h` 和 `1h30m`。没有时长的任务使用设置中的默认值。

## 可选 Google Calendar 同步

开启 **Google Calendar · 可选** 后，可把定时且标记为忙碌的事件导入到当前点击的
Nautilus 图表日期。Blueprint Calendar 按钮只执行手动、只读同步；不会后台轮询，也不会
自动创建 Daily Note。

普通点击会保护你在 Roam 中改写的文字；Option/Alt + 点击只强制刷新 Google 托管字段，
仍保留用户自己创建的子 block。全天事件、空闲/透明事件和已拒绝事件不会导入。配置需要
你自己的 Google Web OAuth Client ID，并把 `https://roamresearch.com` 添加为 Authorized
JavaScript origin；短期访问令牌只留在内存中。

块结构、OAuth 设置、权限范围与合并规则详见
[Google Calendar 同步说明](./docs/google-calendar-sync.md)。

## 可选执行层

需要在可视化规划之外进一步执行时，可在设置中开启 **Execution Layer · Advanced**。
精简顶栏面板提供：

- **Timing**：当前 CLOCK 与最近任务。
- **Plan**：今天已安排和未排入的工作。
- **Review**：Planned 与 Actual 对比。
- **POMO**：不写入 CLOCK 的独立正计时专注模式。

任意时刻只运行一个任务 CLOCK。CLOCK 的优先级高于 POMO，并可把当前任务置顶到
Roam 右侧边栏。执行层默认关闭，因此只使用预计时长时仍然轻量。

设置、命令、语法、历史规则和安全边界请参阅[使用指南](./docs/guide.zh-CN.md)。

## 致谢

- Tomáš Barys 的 [Nautilus](https://github.com/tombarys/roam-depot-nautilus)：原始螺旋
  日计划理念。
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)：本项目继续开发
  所基于的分支。
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)：兼容 CLOCK 计时与聚焦
  执行的灵感来源。

时间分配哲学受到 [YNAB Method](https://www.ynab.com/the-four-rules/) 启发；Nautilus Log
与 YNAB 没有关联。项目沿用原始 MIT License。
