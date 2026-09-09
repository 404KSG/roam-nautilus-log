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
- 没有时间范围的直接子级会被识别为弹性任务；TODO 可省略，DONE 则不进入今天的执行。
- 预计时长支持 `30m`、`30min`、`1h` 和 `1h30m`。
- 没有时长的任务使用 **Default Todo Duration**。
- **Urgent Trigger Word** 只改变任务颜色，不改变排程顺序。
- 裸 block 引用继承来源的 TODO/DONE；若要在今天重做已完成的来源内容，请在引用外层加 TODO。
- 引用后写入的时长覆盖来源时长；来源的完成时间和 CLOCK 历史不会被今天继承。
- 旧的 `dNN%` 文本不再具有排程含义。Nautilus Log 会把它保留为普通 block 文字，并始终按
  完整预计时长排程。

## 排程规则

1. 固定事件先占用自己声明的时间范围。
2. 按照 Roam block 顺序读取尚未完成的直接子级任务。
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
- **Calendar：** 设置中的 Google Calendar 显示“已连接”后，导入当前图表 Daily Note
  日期中的定时忙碌事件和有日期的 Google Tasks。Option/Alt + 点击只会强制刷新
  Google 托管字段。
- **整理：** 将已完成任务和已过去固定事件稳定移动到列表最前面，同时保持活动任务的
  相对优先级完全不变。整理只按 UID 移动直属外壳，不修改文本、时间、引用或后代 block；
  若整理后没有继续编辑计划，可撤销一次。
- **折叠：** 隐藏当前图表实例，同时保留下面的计划 block。

鼠标悬停或键盘聚焦任务/事件切片时，会显示准确时间范围与时长。单击弹性任务切片或紧凑
Schedule 中的任务行，只会在当前页面滚动定位对应 block，不会修改图谱；Shift + 单击或
Shift + Enter 会在右侧边栏打开。若目标因折叠而未渲染，则回退到 Roam 官方 block 导航。
宽图中的未来空档也会提供相同预览。紧凑的右侧边栏图表不显示 hover tooltip，并默认折叠
Schedule，避免裁切和视觉干扰。

## 执行层

可选的执行层默认**关闭**。启用前会隐藏进阶执行设置。关闭时仍会加载 30px 的今日计划
入口和一条创建/打开命令，但不会加载执行面板、1 秒计时器、CLOCK 写入者或 LOGBOOK
读取。

点击 **＋ 创建今日计划**（或命令）会按当前 renderer 身份和设置，在今天 Daily Note
末尾插入一条规范组件。若该页已有任何合法 Nautilus 组件（包括空任务计划），则只定位
树序 Primary。模板若含额外兄弟块或 render 子孙，首版会明确提示改用 `;;`，以免复制或
丢内容。按钮不会在午夜或加载时自动创建。

开启执行层后，当天 Daily Note 中的第一个 Nautilus Log 会成为顶栏面板使用的
**Primary Plan**。创建成功并读回后，会恢复原有容量文本或 136×6 精力槽，并在主窗口
打开计划。

单击 Nautilus 顶栏按钮会打开面板；Option/Alt + 单击会在主界面定位 Primary Plan；
Shift + 单击则会在 Roam 右侧边栏打开同一个 block，已存在时只将其移到顶部并展开。

| 视图 | 用途 |
| --- | --- |
| Timing | 当前 Timing Line 与最近结束的任务 |
| Plan | Primary Plan 中尚未完成的直接子级任务 |
| Review | 当天 Planned、Actual 和有效偏差状态 |

任意时刻只运行一个 CLOCK。切换任务时，会在同一时刻关闭旧 CLOCK 并打开新 CLOCK。
开启 **Keep Timing Line first in right sidebar** 后，Clock In 还会把当前任务打开或移动
到 Roam 右侧边栏顶部。

### 可选容量精力槽

开启 **用精力槽显示剩余容量** 后，普通单行顶栏标记会变成无金属描边的双层“潜航仪表”。
固定的 136×6px 槽体恢复为两端完整圆润的胶囊形，不带描边、阴影或额外端部装饰。槽体
位于顶栏中心线上方；下层合并成左对齐的
`百分比 left · 未完成计划总时长`，两行围绕中心线严格上下对折。CLOCK 或 POMO 运行时，
计时与停止按钮直接居中在这条顶栏中心线上，而不是与上方槽体对齐：

- 与 Roam 顶栏右侧图标相同的灰蓝色是扣除全部未完成需求后的弹性余量；
- 较浅的海绿色是今天已被未完成计划预占的容量；
- 更弱的冷灰色空槽是已经流逝的弹性容量；
- `超载 +Xm` 或 `无空档 Xm` 只在下层摘要中以现有警示色出现，不在槽体上重复显示。

所有宽度都以全天弹性容量为同一个分母。固定事件仍从容量中扣除；没有时长的任务仍使用
默认 Todo 时长；顶栏复用现有秒级状态，每分钟重新投影一次，不新增 Roam 读取或计时器。
从面板确认完成任务后，下层精确计划读数保持可见，并在原位做一次短促确认；两条槽层共用
同一次短宽度过渡。写入失败时槽体不变；外部 TODO/DONE 或时长变更会静默重绘，不出现完成
确认。这表示时间容量，不代表身体或心理健康。
完整密度下由双层仪表本身充当点击入口，不再显示最前面的 Nautilus 图标和分隔点；容量
数据不可用或空间不足时才恢复为单独图标，不会在 Roam 搜索框旁留下残缺状态。

### 引用任务的状态所有权

- 裸 `((来源 TODO))` 的 TODO/DONE 状态由真实来源块拥有。从 Nautilus Log 完成任务时，
  插件会把来源 TODO 改为 DONE；CLOCK 仍写在今天的直接外壳下，因此 Actual 仍属于今天。
- 显式外层 `TODO ((来源))` 由今天的外层状态负责。完成时只修改外层标记，不改可复用来源。
- 如果裸引用进入今天之前来源就已经 DONE，它不会进入 Plan 或 Review；如果来源是在今天
  外壳已经产生 Actual 之后变为 DONE，Review 会保留这条今天真实做过的记录。
- 多层引用沿引用链寻找最近的显式 TODO/DONE 所有者。插件只监听 Primary Plan 实际使用的
  精确来源块，不增加全图状态扫描。

Recent 默认保留 45 分钟。Pomodoro 阈值默认 45 分钟，只改变实时提示，不会停止工作。
没有任务 CLOCK 时，面板标题栏中的秒表可以启动独立正计时 POMO；运行后同一位置会变成
**停止 POMO**，因此顶栏压缩成单独 Nautilus 图标时仍可结束计时。完成另一项非聚焦任务
不会停止当前 CLOCK，也不会重置其 Pomodoro 周期。遗忘计时提醒默认 120 分钟，同样不会
自动停止或删除 CLOCK。填写 `0` 可以关闭 Recent 或遗忘计时提醒。

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
| Google Calendar | 未连接；连接后默认使用主日历 |
| 执行层 · 进阶 | 关闭 |
| 用精力槽显示剩余容量 | 关闭 |
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

Google Calendar 通过一个明确的连接状态行配置：点击 **连接**，选择自己的 Google
账号并批准 Calendar 与 Tasks 的只读权限。设置中会持续显示“已连接”和“断开连接”；
用户不需要填写任何开发者凭据或 Calendar ID。每次图表点击只读取当前日期，不设定时器、
不后台轮询，也不预取未来 7 天。定时 Calendar 事件保持为固定事件；有日期的 Tasks 会
按“默认 Todo 时长”导入为弹性 TODO/DONE。详见
[Google Calendar 同步说明](./google-calendar-sync.md)。

## 命令

命令面板提供：

- **Nautilus Log: Create or open today’s plan**（始终可用）
- **Nautilus Log: 1. Focus current block**（执行层开启时）
- **Nautilus Log: 2. Clock out Timing Line**（执行层开启时）
- **Nautilus Log: 3. Locate Primary Plan**（执行层开启时）

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
