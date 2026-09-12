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
2. 点击顶栏 **＋ 创建今日计划**，或运行 **Nautilus Log: Create or open today’s plan**。
   无论当前浏览哪个页面，都以今天的 Daily Note 为目标，并复制完整的受管理
   Nautilus 模板树（包括普通嵌套子项）并打开结果。一次普通点击即可，无需面板、
   确认或手动输入 `;;`。
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

打开 Nautilus Log 设置，点击 **连接 Google Calendar**，即可用只读权限授权自己的账号。
连接后，设置会显示 **已连接 · 只读 · 主日历**，图表中出现 Blueprint Calendar 按钮。
Roam Desktop 会在系统浏览器打开真实的 Google 授权页，并自动把结果返回正在等待的设置页。
Calendar 按钮只手动同步当前 Nautilus 图表对应的日期；不会后台轮询，也不会自动创建
Daily Note。

普通点击会保护你在 Roam 中改写的文字；Option/Alt + 点击只强制刷新 Google 托管字段，
仍保留用户自己创建的子 block。全天事件、空闲/透明事件和已拒绝事件不会导入。连接可在
Roam 刷新后自动恢复，用户无需创建或粘贴 OAuth Client ID、密钥或 Calendar ID。Calendar
数据由 Roam 客户端直接向 Google 请求，不会经过轻量授权服务。导入的 `Open` 链接保留
Google 原始事件目标，并在浏览器登录多个 Google 账号时优先提示已连接的主账号。

块结构、授权、权限范围、合并规则与隐私边界详见
[Google Calendar 同步说明](./docs/google-calendar-sync.md)与[隐私说明](./PRIVACY.md)。
中断写入使用图谱本地的 `google-calendar-sync-pending` 日志：无法读取或属于其它图谱时失败关闭，保留本地改动与已停放冲突；缺省或空白日志不等于抹掉已有 WAL。Google 读取受单次分页预算限制，不完整网络结果不会被当成成功的部分同步。同一 UID 的图读取只在无 yield 区间内复用。这些是本地正确性边界，不是真实 Google/Roam 延迟提升，也不会自动迁移所有旧的损坏 journal。

## 可选执行层

即使执行层关闭，30px 顶栏按钮和一条命令仍可创建或定位今天的 Primary Plan。该轻量
入口不会启动 CLOCK 写入、1 秒计时器或执行面板。一键插入会冻结并复制完整的受管理
renderer 根及普通子树，所有新块使用新 UID；树内引用会重映射，树外引用保持不变。
它不会复制昨天，也不会改动源模板。多个根、模板顶层兄弟或无法读取的动态内容会安全
失败，并可打开模板查看。今天 Daily Note 上已有任何合法 Nautilus 组件（包括空任务
计划或全部完成的计划）都只定位，不重复创建。创建需要确认当前图谱并获得 Web Locks；
读取失败后的“重新检查”只读，不会自动插入。

**创建未完成**会打开诊断与已验证块计数；**检查已创建内容**不会清除未完成状态。
只有原内存操作重新验证每个已写块后才提供**继续创建**；重载后只能验证、打开，不能用新
模板补写。图谱/日期范围内的 SHA-256 记录只保存目标标识与哈希，不保存模板正文。
LOGBOOK/CLOCK 历史和无法保留的属性会在模板写入前被拒绝。首次写入前跨午夜会停止；
写入开始后则完成冻结的原日期，并提示日期变化，不会把昨天显示为今天的就绪计划。

需要在可视化规划之外进一步执行时，可在设置中开启 **Execution Layer · Advanced**。
精简顶栏面板提供：

- **Timing**：当前 CLOCK 与最近任务。
- **Plan**：今天已安排和未排入的工作。
- **Review**：Planned 与 Actual 对比。
- **POMO**：不写入 CLOCK 的独立正计时专注模式。

任意时刻只运行一个任务 CLOCK。CLOCK 历史读取按 owner 覆盖，带短 TTL 与 LRU 上限；失败读取不会被缓存成空历史。图表订阅绑定 provider 代际，换掉 watch 后不会继续写入；暂时读不到时保持 stale，而不是看起来像已确认的空树。Plan Tidy 串行整理大纲，用 partial/unknown 标记变化，不把未确认写报成成功；Undo 仅在被折叠行确实展开后才报成功（当前 running 任务除外）。图表标签布局可能跳过一次本地重复计算，这只是操作次数收益，不是已测量的界面卡顿修复。LOGBOOK 256 字符变体仍保留兼容。本地 OAuth Worker 的 `await` 与错误形态测试只存在于源码，不等于已部署服务。CLOCK 的优先级高于 POMO，并可把当前任务置顶到
Roam 右侧边栏。执行设置中另有默认关闭的 **用精力槽显示剩余容量**：它会用双层时间
容量仪表替换普通顶栏标记：上下两层围绕顶栏中心线对折，上层显示分层槽，下层将精确
`% left · 未完成计划总时长` 合并后左对齐；CLOCK/POMO 计时则直接居中在顶栏中心线上。
执行层默认关闭，因此只使用预计时长时仍然轻量。

设置、命令、语法、历史规则和安全边界请参阅[使用指南](./docs/guide.zh-CN.md)。

## 本地验证

运行 `npm test` 和 `PYTHONDONTWRITEBYTECODE=1 npm run test:ui`。浏览器套件需要已有的
Python Playwright 与 Chromium，不会连接真实 Roam 图谱。真实会话套件使用实际源查询、
冻结、会话、写入适配器与两个顶栏入口，只替换底层图谱和时钟；假图谱会拒绝重复 UID。
覆盖一键完整复制、部分写入/重载、导航、提示框边界和计时优先级。截图与结果位于
`/tmp/nautilus-real-today-plan`；这不等于真实 Roam Desktop 验证。

## 致谢

- Tomáš Barys 的 [Nautilus](https://github.com/tombarys/roam-depot-nautilus)：原始螺旋
  日计划理念。
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced)：本项目继续开发
  所基于的分支。
- [Roam Logbook](https://github.com/forrestchang/roam-logbook)：兼容 CLOCK 计时与聚焦
  执行的灵感来源。

时间分配哲学受到 [YNAB Method](https://www.ynab.com/the-four-rules/) 启发；Nautilus Log
与 YNAB 没有关联。项目沿用原始 MIT License。
