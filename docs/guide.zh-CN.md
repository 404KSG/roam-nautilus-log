# Nautilus Log 使用指南

[返回 README](../README.zh-CN.md) · [English](./guide.md)

## 计划格式

把固定事件与弹性任务写成 Nautilus Log 组件的直接子级。Roam block 顺序就是任务优先级。

```text
05:00-06:00 Morning routine
{{[[TODO]]}} 撰写项目简报 45m
{{[[TODO]]}} 复习笔记 30m
11:45-12:30 Lunch
```

- 时间范围会被识别为固定事件。
- 尚未完成的 TODO 会被识别为弹性任务。
- 预计时长支持 `30m`、`30min`、`1h` 和 `1h30m`。
- 没有时长的任务使用 **Default Todo Duration**。
- **Urgent Trigger Word** 只改变任务颜色，不改变排程顺序。

## 排程规则

1. 固定事件先占用自己声明的时间范围。
2. 按照 Roam block 顺序读取尚未完成的直接子级 TODO。
3. 从当前时刻开始，把完整任务放进下一个足够大的连续空档。
4. 时间经过后，未完成任务向前推进，但不改变优先顺序。
5. 到设定结束时间仍放不下的任务进入 **今日放不下**。

排程规则完全确定，不会自动生成时长。每项任务保持完整：当前空档放不下时，任务会跳到
下一个合适空档，而不是被任意切开。

## 顶部指标

| 指标 | 含义 |
| --- | --- |
| Planned | 剩余弹性任务需求；`left` 百分比 = `当前剩余灵活时间 ÷ 全天 Available 总量` |
| Remaining | 安排完 Planned 后的余量 |
| Overload | 超出当前可用时间的需求 |
| 空档不足 | 总时间存在，但没有连续空档能容纳某项完整任务 |
| Available | 当前剩余弹性时间 / 完整时段弹性时间总量 |
| Events | 当前剩余事件时间 / 完整时段事件时间总量 |

重叠事件按时间并集计算，同一分钟不会重复统计。小火焰表示当前正在消耗 Available
还是 Event 时间。

## 视觉语言

- 红色：紧急任务
- 黄色：固定事件
- 蓝色：弹性任务
- 红色指针：当前时间
- 弱化历史切片：已经记录的过去
- 斜纹历史切片：没有记录事项的过去时间

过去空档只是排程事实，不等于插件判断那段时间“被浪费”。

## 图表控制

- **眼睛：** 显示或隐藏已完成事项。
- **播放：** 回放所配置的一天，不修改 Roam block。
- **折叠：** 隐藏当前图表实例，同时保留下面的计划 block。

鼠标悬停或键盘聚焦任务/事件切片时，会显示准确时间范围与时长；宽图中的未来空档也会
提供相同预览。紧凑的右侧边栏图表不显示 hover tooltip，并默认折叠 Schedule，避免裁切
和视觉干扰。

## 执行层

可选的执行层默认**关闭**。启用前会隐藏进阶执行设置，也不会加载执行面板、计时轮询、
命令或 CLOCK 写入者。

开启后，当天 Daily Note 中的第一个 Nautilus Log 会成为顶栏面板使用的 **Primary
Plan**。

| 视图 | 用途 |
| --- | --- |
| Timing | 当前 Timing Line 与最近结束的任务 |
| Plan | Primary Plan 中尚未完成的直接子级任务 |
| Review | 当天 Planned、Actual 和有效偏差状态 |

任意时刻只运行一个 CLOCK。切换任务时，会在同一时刻关闭旧 CLOCK 并打开新 CLOCK。
开启 **Keep Timing Line first in right sidebar** 后，Clock In 还会把当前任务打开或移动
到 Roam 右侧边栏顶部。

Recent 默认保留 45 分钟。Pomodoro 阈值默认 45 分钟，只改变实时提示，不会停止工作。
遗忘计时提醒默认 120 分钟，也不会自动停止或删除 CLOCK。填写 `0` 可以关闭 Recent
或遗忘计时提醒。

## Planned 与 Actual 历史

- 未完成任务使用 Planned 预计时长排程。
- 已完成弹性任务优先使用当天有效 Actual 总时长。
- 多段 CLOCK 仍分别保留在 `LOGBOOK::` 中，海螺图只把总时长合成一个历史切片。
- Actual 即使超过 Planned 也不会被截断。
- 没有 Actual 时，只有 `d18:21` 这类明确完成锚点存在，才会绘制 Planned 历史。
- 没有 Actual 结束点和完成锚点时，插件不会凭空制造历史区间。
- 使用跨午夜图表窗口时，次日延续区间内的 CLOCK 仍归属于创建该计划的 Daily Note。

Todo Trigger 是可选工具。它追加的完成时间可以提供 `dHH:MM` 锚点，但普通规划与完成
不依赖 Todo Trigger。

## 设置

| 设置 | 默认值 |
| --- | --- |
| Language | English |
| Chart Start Time | 05:00 |
| Chart End Time | 21:00 |
| Component Prefix | `[[Nautilus Log]]` |
| Legend Max Length | 22 |
| Default Todo Duration | 15 分钟 |
| Urgent Trigger Word | 空 |
| 执行层 · 进阶 | 关闭 |
| Keep Timing Line first in right sidebar | 开启 |
| Pomodoro Threshold | 45 分钟 |
| Recent Retention | 45 分钟；`0` 为关闭 |
| Forgotten Timer Warning | 120 分钟；`0` 为关闭 |

Component Prefix 只是新插入组件前的展示文本，可以修改或留空。Primary Plan 根据
Nautilus Log 稳定的 renderer 身份识别组件，不依赖这个标签。

开始时间可选择 00:00–23:00 的任意整点；结束时间可选择 01:00–24:00。结束时间早于
或等于开始时间时，设置中会明确标为 **次日**。例如 21:00–02:00 会成为一个连续的
300 分钟窗口，并始终归属于放置该组件的 Daily Note。旧模板继续兼容，默认值仍为
05:00–21:00。

只有开启 **执行层 · 进阶** 后，设置面板才会展开执行层的其他选项。

## 命令

命令面板提供：

- **Nautilus Log: 1. Focus current block**
- **Nautilus Log: 2. Clock out Timing Line**
- **Nautilus Log: 3. Locate Primary Plan**

可以在 **Roam Settings → Hotkeys** 自行绑定；TODO 右键菜单也提供 Clock In 与 Clock Out。

## 数据与安全

Actual 时间保存为兼容的 Org 风格图谱数据：

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

开启 Actual 前请关闭独立的 Roam Logbook；Nautilus Log 检测到第二个 CLOCK 写入者时会
拒绝启动。一个页面可以有多个图表，但只有今天 Daily Note 中的第一个会成为执行面板的
Primary Plan。面包屑和折叠路径副本会跳过昂贵的图表绘制；右侧边栏使用紧凑图表并默认
折叠 Schedule。卸载插件不会重写或删除用户 block。
