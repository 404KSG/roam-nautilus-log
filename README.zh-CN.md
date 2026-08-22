# Nautilus Log

> **给每一分钟分配一份工作。**

一个面向 Roam Research 的透明可视化日计划工具。Nautilus Log 把固定事件和弹性任务
放到同一条螺旋时间线上，让你在一天失控前看清楚计划是否放得下。

[English](./README.md) · **简体中文** · [使用指南](./docs/guide.zh-CN.md)

## 看见完整的一天，而不只是一张清单

待办清单告诉你“什么重要”，却不告诉你“今天是否放得下”。Nautilus Log 把今天的
Daily Note 变成一份动态时间计划：

- **承诺之前先看清容量。** Planned、剩余时间、超载和今日放不下都会明确显示。
- **既有结构，又不僵硬。** 固定事件保持不动，未完成任务按照 Roam block 顺序绕开
  事件向前推进。
- **连接预计与现实。** 先用预计时长低摩擦规划，再按需用 `LOGBOOK::` / `CLOCK:`
  Actual 时间校准估算。
- **不离开 Roam 就能执行。** 聚焦、任务切换、计时、完成和每日 Review 都连接在普通
  Roam block 上。

## 一套工作流，三个层级

1. **保护固定承诺。** 用明确时间范围写下会议、吃饭和作息。
2. **给行动分配时间。** 按顺序排列弹性 TODO，并为每项任务填写预计时长。
3. **用现实校准计划。** 可选记录 Actual 时间，改进下一次估算。

排程规则完全确定：固定事件先占用自己的时间范围，再从当前时刻开始，把完整任务依次
放进足够大的空档。未完成工作会向前推进，但不改变优先顺序；仍然放不下的任务进入
**今日放不下**，不会消失。没有 AI 自动估算，也没有黑盒排程。

## 快速开始

1. 从 Roam Depot 安装 **Nautilus Log**。
2. 在今天的 Daily Note 输入 `;;`，选择 **Nautilus Log**。
3. 把事件和 TODO 写成组件的直接子级。
4. 排列任务、填写粗略时长，并调整到一天能够容纳。

```text
05:00-06:00 Morning routine
{{[[TODO]]}} 撰写项目简报 45m
{{[[TODO]]}} 复习笔记 30m
11:45-12:30 Lunch
```

预计时长使用分钟：`30m`、`90m` 或 `30min`。没有时长的任务使用设置中的默认值。

## 需要时再记录 Actual

Actual Time Tracking 默认**关闭**，因此只使用预计时长时仍然轻量。开启后会增加一个
精简执行面板：

- **Timing** 显示当前任务和最近结束的工作。
- **Plan** 显示当天 Primary Plan 中尚未完成的任务。
- **Review** 比较当天有效的 Planned 与 Actual 结果。

任意时刻只运行一个 CLOCK。Clock In 可以把当前任务置顶到 Roam 右侧边栏，让聚焦和
任务切换尽量接近原生 Shift+Click。

语法、指标、设置、命令、Actual 历史规则和安全边界请参阅
[完整使用指南](./docs/guide.zh-CN.md)。

## 致谢与灵感来源

- Tomáš Barys 的 [Nautilus](https://github.com/tombarys/roam-depot-nautilus)：透明螺旋
  日计划的原始理念。
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)：本项目继续开发所基于
  的增强分支。
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)：兼容 CLOCK 计时与聚焦执行
  交互的重要灵感来源。

时间分配哲学受到 [YNAB Method](https://www.ynab.com/the-four-rules/) 启发；Nautilus Log
与 YNAB 没有关联。项目沿用原始 MIT License。
