# Nautilus Log

> **给每一分钟分配一份工作。**

一个面向 Roam Research 的透明可视化日计划工具。Nautilus Log 把固定事件、弹性任务
和可选的 Actual 实际计时连接成同一套每日工作流。

[English](./README.md) · **简体中文**

## 不只是列任务，而是把任务真正放进时间里

待办清单告诉你“要做什么”，却不告诉你“今天是否放得下”；日历能保护固定承诺，
但手工安排每一项弹性任务又过于僵硬；计时器能记录现实，却往往只在计划完成后才开始。

Nautilus Log 把三者连接起来：它把 Daily Note 中的计划绘制成螺旋时间线，让未完成
任务随着时间向前流动，并在一天失控前明确显示超载。

### 为什么使用 Nautilus Log

- **一眼看出今天是否放得下。** Planned、余量、碎片空档和今日放不下都会明确显示。
- **既有结构，又保留弹性。** 固定事件保持不动，未完成任务按照 Roam block 顺序绕开
  事件向前推进。
- **连接意图与现实。** 先用预计时长低摩擦规划，再按需用兼容的 `LOGBOOK::` / `CLOCK:`
  Actual 时间校准估算。
- **不离开 Roam 就能执行。** 聚焦、任务切换、计时、完成和每日 Review 都连接在普通
  Roam block 上。

## 三层时间管理模型

| 层级 | 表达方式 | 方法 | 作用 |
| --- | --- | --- | --- |
| 固定承诺 | 明确起止时间 | Time Blocking | 保护不可移动的事件与作息 |
| 行动意图 | 按顺序排列并带预计时长的任务 | Timeboxing | 让弹性工作拥有可见成本和位置 |
| 真实执行 | 可选的 `CLOCK:` 计时段 | Actual Tracking | 看见真实用时并校准下一次估算 |

只用 Planned 就能完成轻量规划；只有当真实反馈值得额外交互时，才需要开启 Actual。

## 快速开始

1. 在 Roam 中安装 **Nautilus Log**。
2. 在今天的 Daily Note 输入 `;;`，选择 **Nautilus Log**。
3. 把固定事件与 TODO 写成组件的直接子级。
4. 按照希望执行的顺序排列弹性任务。
5. 调整预计时长，直到计划放得下，或有意识地接受超载。

```text
05:00-06:00 Morning routine
{{[[TODO]]}} 撰写项目简报 45m
{{[[TODO]]}} 复习笔记 30m
11:45-12:30 Lunch
13:00-13:30 Nap
18:00-19:00 Yoga + shower
```

- `11:45-12:30 Lunch` 这样的时间范围是固定事件。
- `{{[[TODO]]}} 复习笔记 30m` 是弹性任务。
- 预计时长使用分钟：`30m`、`90m` 或 `30min`。
- 没有时长的任务使用 **Default Todo Duration**。
- **Urgent Trigger Word** 可以把任务显示为红色，但不会改变 block 顺序。

## 海螺图如何排程

1. 固定事件先占用自己声明的时间范围。
2. 读取尚未完成的直接子级 TODO，并保持 Roam block 顺序。
3. 从当前时刻开始，把每项完整任务放进下一个足够大的空档。
4. 时间经过后，未完成任务继续向前推进，但不改变优先顺序。
5. 到设定结束时间仍然放不下的任务进入 **今日放不下**，不会消失。

所有规则都可预测、可检查：没有 AI 自动估算，也没有黑盒排程。螺旋图负责呈现计划
成本，并不声称能够精确测量人的精力。

## 可选的 Actual 实际计时

Actual Time Tracking 默认**关闭**。关闭时，插件只依赖预计时长绘图，不会加载执行面板、
计时轮询、命令或 CLOCK 写入者。

开启后，Blueprint 风格顶栏提供：

| 视图 | 用途 |
| --- | --- |
| Timing | 当前 Timing Line 与最近结束的任务 |
| Plan | 当天 Primary Plan 中尚未完成的直接子级任务 |
| Review | 当天 Planned、Actual 和有效偏差状态 |

当天 Daily Note 中的第一个 Nautilus Log 会成为 **Primary Plan**。任意时刻只运行一个
CLOCK；切换任务时，会在同一时刻关闭旧任务并启动新任务。Clock In 还可以把当前任务
置顶到 Roam 右侧边栏，让聚焦交互尽量接近原生 Shift+Click。

弹性任务完成后，海螺图优先使用当天有效 CLOCK 的 Actual 总时长。多段计时仍分别保留
在 `LOGBOOK::` 中，图表只把总时长压成一个历史切片。没有 Actual 时，只有 `d18:21`
这类明确完成锚点存在，才会用 Planned 绘制历史区间。

<details>
<summary><strong>顶部指标与视觉语言</strong></summary>

| 指标 | 含义 |
| --- | --- |
| Planned | 剩余弹性任务需求；百分比 = `Planned ÷ 当前 Available` |
| Remaining | 安排完 Planned 后的余量 |
| Overload | 超出当前可用时间的需求 |
| 空档不足 | 总时间存在，但没有连续空档能容纳某项完整任务 |
| Available | 当前剩余弹性时间 / 完整时段弹性时间总量 |
| Events | 当前剩余事件时间 / 完整时段事件时间总量 |

重叠事件按时间并集计算，同一分钟不会重复统计。小火焰表示当前正在消耗 Available
还是 Event 时间。

- 红色：紧急任务
- 黄色：固定事件
- 蓝色：弹性任务
- 红色指针：当前时间
- 弱化历史切片：已记录的过去
- 斜纹历史切片：没有记录事项的过去时间

过去空档只是排程事实，不等于插件判断那段时间“被浪费”。

</details>

<details>
<summary><strong>设置</strong></summary>

| 设置 | 默认值 |
| --- | --- |
| Language | English |
| Chart Start Time | 05:00 |
| Chart End Time | 21:00 |
| Component Prefix | `[[Nautilus Log]]` |
| Legend Max Length | 22 |
| Default Todo Duration | 15 分钟 |
| Urgent Trigger Word | 空 |
| Actual Time Tracking | 关闭 |
| Keep Timing Line first in right sidebar | 开启 |
| Pomodoro Threshold | 45 分钟 |
| Recent Retention | 45 分钟；`0` 为关闭 |
| Forgotten Timer Warning | 120 分钟；`0` 为关闭 |

开始时间可选择 05:00–08:00，结束时间可选择 18:00–24:00。选择 `24:00` 时，内部按
第 1440 分钟处理并标为 `0`；跨午夜事件会在当前展示日期边界截断。

</details>

<details>
<summary><strong>命令、数据与安全</strong></summary>

命令面板提供：

- **Nautilus Log: Focus current block**
- **Nautilus Log: Clock out Timing Line**
- **Nautilus Log: Locate Primary Plan**

可以在 **Roam Settings → Hotkeys** 自行绑定；TODO 右键菜单也提供 Clock In 与 Clock Out。

Actual 时间保存为兼容的 Org 风格图谱数据：

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

开启 Actual 前请关闭独立的 Roam Logbook；Nautilus Log 检测到第二个 CLOCK 写入者时会
拒绝启动。一个页面可以有多个图表，但只有今天 Daily Note 中的第一个会成为 Primary
Plan。右侧边栏、面包屑和折叠路径副本会跳过昂贵的图表绘制。卸载插件不会重写或删除
用户 block。

</details>

## 致谢与灵感来源

Nautilus Log 建立在这些优秀项目之上：

- Tomáš Barys 的 [Nautilus](https://github.com/tombarys/roam-depot-nautilus)：透明螺旋
  日计划的原始理念。
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)：本项目继续开发所基于
  的增强分支。
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)：兼容 CLOCK 计时与聚焦执行
  交互的重要灵感来源。

“在使用有限资源前先分配明确意图”的整体理念受到
[YNAB Method](https://www.ynab.com/the-four-rules/) 启发；Nautilus Log 与 YNAB 没有关联。

项目沿用原始 MIT License。
