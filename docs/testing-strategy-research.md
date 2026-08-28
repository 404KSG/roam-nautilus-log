# Roam Research 插件与 CSS 性能测试策略研究

> 研究日期：2026-08-28  
> 范围：Nautilus Log 及同类 Roam Research 扩展的功能、CSS 交互性能与发布前验证。  
> 来源边界：仅使用 Playwright、Chrome/web.dev、W3C、Roam Research 官方资料与公开的 Roam 插件源代码仓库。文中带“项目建议”的阈值和流程是基于这些一手资料形成的工程判断，不是上游规范原文。

## 结论先行

1. **应该使用真实 Roam 网页版 + Headless Chromium，但它只能是测试金字塔中的一层。** 它最适合验证真实 Roam DOM、React/Reagent 更新、DataScript、扩展生命周期与 CSS 的组合行为；纯算法和大多数组件行为仍应在更快、更稳定的单元/模拟层测试。Chrome 112 之后的统一 Headless 与普通 Chrome 共用浏览器实现，而 Playwright 默认也以 headless 方式运行测试，因此这条路径具有足够高的浏览器真实性。[Chrome Headless 官方说明](https://developer.chrome.com/docs/chromium/headless) [Playwright 运行测试](https://playwright.dev/docs/running-tests)
2. **真实 Roam E2E 必须使用专门的测试账号和可丢弃 graph，不得连接个人生产 graph。** 登录态只在本地或受控 runner 上短期复用；认证文件按凭据对待，不提交、不上传为 artifact。[Playwright Authentication](https://playwright.dev/docs/auth) [Roam Tools 官方仓库的安全提醒](https://github.com/Roam-Research/roam-tools)
3. **Enter 延迟不能用 `page.keyboard.press()` 的耗时、API 轮询或固定 sleep 代替。** 正确口径是“可信 Enter `keydown` 到下一次完成绘制，且新 block 已出现并获得编辑焦点”；主指标来自 W3C Event Timing，辅以 MutationObserver、Selection/activeElement 和 User Timing 标记。[W3C Event Timing](https://www.w3.org/TR/event-timing/) [W3C User Timing](https://www.w3.org/TR/user-timing/)
4. **性能比较必须固定页面大小和状态，不能在同一页持续增加 block。** DOM 规模会直接增加样式、布局和绘制成本；如果 CSS A/B 两组测试的页面长度不同，结果不能归因于 CSS。[web.dev：优化 INP](https://web.dev/articles/optimize-inp)
5. **CI 负责确定性正确性，本地受控环境负责细微性能与桌面兼容。** 共享 CI 机器和 SaaS 网络噪声不适合作为几毫秒级回归的唯一裁判；真实 Roam E2E 可在夜间或手动任务运行，发布前再做最小 Roam Desktop smoke。

## 一、推荐的测试分层

| 层级 | 运行环境 | 主要覆盖 | 不应承担 |
|---|---|---|---|
| L0 静态检查 | Node / 构建器 | ClojureScript/JavaScript 语法、构建、lint、CSS 解析、manifest | 用户交互与浏览器布局 |
| L1 纯单元 | Node test runner | 时间解析、容量计算、事件/任务分类、引用状态、Tidy 排序、格式化 | Roam DOM、焦点、真实渲染 |
| L2 DOM 组件 | jsdom + Testing Library + 最小 `roamAlphaAPI` mock | 面板状态、按钮、生命周期、observer/timer 清理、无障碍名称 | CSS 布局、SVG 实际尺寸、真实 Roam 选择区 |
| L3 浏览器组件 | 本地静态 harness + Playwright Chromium | CSS、响应式、SVG、键盘交互、视觉快照、tooltip 边界 | Roam DataScript 与真实页面行为 |
| L4 真实 Roam Web E2E | 专用 test graph + Headless Chromium | 扩展加载、真实 DOM、Enter、焦点、右侧栏、顶栏、onload/onunload、关键 CSS 性能 | Roam Desktop 专属 API |
| L5 桌面 smoke | Roam Desktop，人工或轻自动化 | Electron/macOS 焦点、桌面本地 API、快捷键、扩展重载、顶栏/侧栏最终外观 | 大规模回归套件与细粒度基准 |

公开的 RoamJS 组件仓库同时包含 Playwright 测试命令、jsdom/Testing Library 依赖，以及对 `window.roamAlphaAPI` 的模拟测试，说明社区成熟实现也采用“模拟层 + 浏览器层”，而不是把全部逻辑压在真实 Roam 上。[RoamJS Components `package.json`](https://github.com/RoamJS/roamjs-components/blob/main/package.json) [RoamJS Components 模拟 API 测试](https://github.com/RoamJS/roamjs-components/blob/main/tests/index.test.tsx)

Roam Depot 的官方约定要求扩展导出 `onload`/`onunload`，并明确要求清理由 `onload` 创建的状态；因此 L2 和 L4 都应加入“加载 → 卸载 → 再加载”的回归测试，检查 DOM、事件监听、MutationObserver、定时器和命令注册是否重复。[Roam Depot 官方 README](https://github.com/Roam-Research/roam-depot/blob/main/README.md)

### Nautilus Log 的落地顺序

1. 保留现有 `node --test`，优先把时间安排和状态规则做成纯函数测试。
2. 增加 jsdom 生命周期测试，覆盖 onload/onunload、顶栏重建和 observer 解绑。
3. 增加本地浏览器 harness，验证 SVG/CSS/响应式而不依赖 Roam 登录。
4. 增加默认不执行的 `e2e:roam`，只连接专用 test graph。
5. 增加独立 `perf:enter`，输出结构化 JSON，不与普通 E2E 混跑。
6. 发布前执行 5 分钟的 Roam Desktop smoke 清单。

## 二、真实 Roam Web + Headless Chromium 流程

### 为什么值得做

本地 harness 无法还原 Roam 的 block 编辑器、DataScript 更新、React/Reagent 调度、真实主题与其他扩展产生的 CSS 级联。真实 Roam Web E2E 是发现下列问题的最低充分层：

- Enter 后新 block 的真实生成和焦点转移；
- CSS 选择器在真实嵌套结构上的代价；
- 顶栏或右侧栏被 Roam 重建后监听是否失效；
- 扩展卸载后是否残留 DOM/observer/timer；
- 自定义前缀、引用 block、折叠/聚焦状态下的真实行为。

Playwright 建议测试用户可见行为，并通过 locator 的自动等待和 actionability 检查减少竞态；测试之间使用独立 BrowserContext，避免 cookies、localStorage 和页面状态串扰。[Playwright Best Practices](https://playwright.dev/docs/best-practices) [Playwright Locators](https://playwright.dev/docs/locators) [Playwright Browser Contexts](https://playwright.dev/docs/browser-contexts)

### 推荐执行步骤

1. 启动 Chromium，载入专用认证状态。
2. 打开专用 test graph 的固定测试页。
3. 等待**明确的应用就绪信号**：目标 page title、扩展根节点和编辑器同时存在；不要等待“全网空闲”。Playwright 明确不推荐把 `networkidle` 当作测试就绪条件。[Playwright Page API](https://playwright.dev/docs/api/class-page) [Playwright Frame API](https://playwright.dev/docs/api/class-frame)
4. 用唯一 run id 创建合成测试 page/block，并记录每个 UID。
5. 完成功能测试或安装一次性测量探针后执行性能样本。
6. 在 `finally`/teardown 中按 UID 精确删除本次数据并读回验证。
7. 关闭 BrowserContext；失败时只保留脱敏后的指标和必要诊断。

### Headless 与桌面 smoke 的边界

- Headless Chromium 适合持续回归；它不等于 Roam Desktop。
- Roam 官方本地 HTTP API 依赖 Roam Desktop，不能把它作为网页版 E2E 的前提。[Roam Tools 官方仓库](https://github.com/Roam-Research/roam-tools)
- 桌面 smoke 只验证桌面专属边界：本地 API、Electron/macOS 焦点、系统快捷键、扩展热重载、最终顶栏/侧栏位置。
- 不建议让普通 CI 驱动个人桌面客户端或复用个人 graph。

## 三、认证如何安全复用

### 推荐方案

1. 建立专门的 Roam 测试账号与可丢弃 graph，只放合成数据。
2. 本地以 headed setup 流程手工登录一次。
3. 保存 `storageState`，同时启用 `indexedDB: true`；Playwright 说明某些认证令牌会存于 IndexedDB，仅 cookies/localStorage 可能不足。[BrowserContext `storageState`](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
4. 保存到如 `playwright/.auth/roam.json`，目录加入 `.gitignore`，本地权限限制为仅当前用户读取。
5. 每个测试创建新的隔离 BrowserContext 并加载同一 storage state，不共享正在运行的页面上下文。
6. 认证过期时重新执行 setup；不在测试脚本里硬编码邮箱、密码或验证码。

Playwright 明确警告：认证状态文件可能包含可冒充账号的 cookies 和 headers，绝不能提交到仓库。[Playwright Authentication](https://playwright.dev/docs/auth)

### 不推荐方案

- 不复制或自动化日常 Chrome 默认 profile。Playwright/Chromium 不支持自动化默认用户数据目录；若必须用 persistent context，应使用独立的 automation `userDataDir`，且同一目录不能同时被多个实例使用。[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)
- 不把 auth state、个人 graph 截图、trace 或视频上传为公开 CI artifact。
- 不通过 CDP 连接日常浏览器作为主要测试方式；Playwright 标注 `connectOverCDP` 的保真度低于原生 Playwright 连接。[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)

## 四、CSS Enter 延迟的科学测量

### 1. 先定义“完成”

建议的用户口径：

> 用户发出可信 Enter `keydown`，到下一帧中新的 block 已出现在 DOM、成为编辑目标，并且焦点/Selection 已经就绪。

这比“按键 API 返回了”更贴近用户感受。W3C Event Timing 覆盖键盘交互，包括 `keydown`、`beforeinput`、`input` 等可信事件；其 `duration` 代表从物理输入时间戳到后续绘制完成的交互延迟，并可拆分为 input delay、processing duration 和 presentation delay。[W3C Event Timing](https://www.w3.org/TR/event-timing/)

### 2. 双轨记录

#### 主指标：PerformanceEventTiming

在页面内提前安装 `PerformanceObserver`，监听 Enter 对应的可信事件：

- `duration`：端到端交互延迟；
- `processingStart - startTime`：输入等待；
- `processingEnd - processingStart`：事件处理；
- `startTime + duration - processingEnd`：近似绘制/呈现部分；
- `interactionId`：把同一次交互相关的键盘事件聚合起来。

Event Timing 默认只缓冲较慢的记录；observer 应在按键前安装，并设置适当的 `durationThreshold` 以捕获较快样本。规范也要求被报告的事件为可信输入，因此不要用页面内 `dispatchEvent()` 伪造 Enter。[W3C Event Timing](https://www.w3.org/TR/event-timing/)

#### 辅指标：应用里程碑

为确认 Roam 的实际“可编辑完成”，在页面内安装一次性探针：

1. 捕获 Enter `keydown`，记录 User Timing mark；
2. MutationObserver 只观察当前编辑器附近，发现新 block；
3. 验证 activeElement 或 Selection 已落到新 block；
4. 连续跨过两个 `requestAnimationFrame`，记录结束 mark 和 measure；
5. 立即断开 observer，返回结构化样本。

这是**项目建议的补充指标**：它能验证功能终点，但不能替代浏览器原生 Event Timing。User Timing 是浏览器提供的应用级标记和测量标准。[W3C User Timing](https://www.w3.org/TR/user-timing/) [Chrome DevTools 自定义 Performance 轨道](https://developer.chrome.com/docs/devtools/performance/extension)

### 3. 不要测这些东西

- `page.keyboard.press('Enter')` Promise 的墙钟时间；它包含 Playwright/进程通信，不等于渲染完成。
- 外部 Roam API/CLI 轮询；网络、序列化和 DataScript 查询会污染 CSS 结论。
- `waitForTimeout()` 或人为 sleep；Playwright 明确说明它会造成脆弱测试，只适合调试。[Playwright Page API](https://playwright.dev/docs/api/class-page)
- `networkidle`；Roam 是长期在线应用，网络安静不代表编辑器完成。[Playwright Frame API](https://playwright.dev/docs/api/class-frame)
- 性能采样期间开启持续 trace、视频或截图；这些工具用于失败调查，不应用在最终计时样本中。Playwright 建议在 CI 首次重试时记录 trace，而不是所有正常运行都开启。[Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) [Playwright Configuration](https://playwright.dev/docs/test-configuration)

### 4. 控制污染变量

每个 CSS 变体必须保持以下条件一致：

- 同一 Chromium 版本、viewport、device scale、主题和系统 reduced-motion 设置；
- 相同扩展集合、右侧栏状态、页面 UID、block 数量、层级、文本长度和 class；
- 每次样本前恢复同一 fixture，或为每个样本创建等规模的新临时页；
- 不在同一页连续按 Enter 而不回滚，因为 DOM 持续增长会提高 style/layout/paint 成本；web.dev 明确指出大 DOM 会增加渲染工作并影响交互响应。[web.dev：优化 INP](https://web.dev/articles/optimize-inp)
- 冷启动和热交互分成两套测试；不要把首次字体、脚本、缓存加载与稳定编辑混在一个分布中；
- 正式基准使用单 worker。Playwright CI 文档也建议 CI 从 `workers: 1` 开始，以获得更高的稳定性和可复现性。[Playwright CI](https://playwright.dev/docs/ci)

### 5. A/B 方法与报告

项目建议：

- 先运行 3–5 次预热并丢弃；每个变体至少记录 15–30 个有效样本；
- 按 A-B-B-A 或随机交错顺序运行原 CSS 与候选 CSS，抵消机器随时间升温/后台负载变化；
- 报告 median、P75、样本数，以及 input/processing/presentation 三段；不要只报最佳值或平均值；
- 原始样本输出为 JSON，至少包含 commit、Chromium 版本、viewport、fixture id、CSS variant、DOM block count；
- 微基准回归阈值先通过本机基线校准。web.dev 的 INP “良好”参考值是 200ms 内，但它是面向真实页面整体交互的产品指标，不应直接当作 Enter 微基准的唯一阈值。[web.dev：INP](https://web.dev/articles/inp)

当回归出现时，再单独录制 Chrome Performance profile，查看 Interactions 轨道及 style/layout/paint；Chrome DevTools 能展示交互阶段，Long Tasks 则可帮助判断是否有主线程长任务。[Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance) [W3C Long Tasks](https://www.w3.org/TR/longtasks-1/)

### 6. CSS 隔离策略

为了避免修改真实 `roam/css`：

- 测试启动后向页面注入带 `data-test-variant` 的 `<style>`；
- 一次只覆盖或禁用一个候选规则组；
- 从大类二分：全局字体/通配选择器 → block 布局 → 动画/transition → 伪元素与阴影 → 局部组件；
- 找到可疑组后缩小到单条 selector；
- A/B 都从相同 reload 后的 fixture 开始；
- 最后再在 headed Roam 中人工确认候选改动没有视觉回归。

这样测量不会在用户 graph 中产生 CSS block，也不会把一次错误测试写入长期配置。

## 五、CI 与本地环境如何分工

### 每个 PR 的普通 CI

- L0 构建、lint、语法检查；
- L1 纯单元；
- L2 jsdom/模拟 API；
- L3 本地浏览器 harness；
- Chromium 版本锁定，必要时采用 Playwright 官方 Docker 镜像；
- 失败时使用 `trace: 'on-first-retry'`，不上传任何真实 Roam 凭据或个人内容。[Playwright CI](https://playwright.dev/docs/ci) [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)

### 夜间或手动受控任务

- L4 真实 Roam Web E2E；
- 仅使用专门 test graph；
- `workers: 1`；
- 从受保护 secret 或本机安全文件取得 auth state；
- 执行核心功能流和较宽松的性能健康检查；
- 无论成功失败都执行 UID 清理和验证。

### 本地发布前

- 在固定机器上运行 `perf:enter`，比较当前基线与候选 CSS；
- 运行 headed Chromium，人工确认截图/焦点；
- 执行 L5 Roam Desktop smoke；
- 小幅性能变化以本地多轮数据为准，不让共享 CI 的瞬时抖动阻断发布。

Playwright 的 webServer 配置适合 L3：开发环境可复用现有服务，而 CI 启动隔离服务。[Playwright Web Server](https://playwright.dev/docs/test-webserver)

## 六、数据安全、临时 graph/page 与清理

### 最低安全规则

1. 真实 Roam 自动化只接触专用账号和 test graph。
2. 测试内容使用完全合成的姓名、任务和时间，不复制个人 graph。
3. 所有临时 page/block 使用唯一前缀，例如 `__NL_E2E_<runId>`。
4. 创建时立即记录 page UID、根 block UID 和所有子 UID；清理按 UID 精确删除，禁止按模糊标题或全图查询批量删除。
5. 操作前记录基线清单；teardown 后读回验证 UID 不存在。若清理失败，任务必须失败并报告剩余 UID。
6. 在 `afterEach`、suite teardown 和进程退出的 `finally` 中做幂等清理；重复调用不得扩大删除范围。
7. 认证文件、persistent profile、trace、视频和截图使用本地临时目录；测试结束后删除，并确认没有残留。
8. 只保留脱敏后的数值 JSON。若为失败保留 trace，必须确认其中没有个人 graph 和认证信息，并设置短保留期。

Roam 官方工具仓库强调：API 具有完整写权限，自动化应先在 test graph 测试、备份重要 graph，并在执行写操作前审查计划；这些原则同样适用于浏览器 E2E。[Roam Tools 官方仓库](https://github.com/Roam-Research/roam-tools)

### 扩展资源清理

除测试数据外，还要验证扩展自身：

- `onunload` 后扩展根节点消失；
- MutationObserver、ResizeObserver、interval、timeout 均停止；
- document/window 事件监听不再响应；
- command palette/shortcut 不重复注册；
- 再次 `onload` 后只存在一个实例。

这既是正确性要求，也是性能要求；Roam Depot 官方 README 对 `onunload` 清理有明确约定。[Roam Depot 官方 README](https://github.com/Roam-Research/roam-depot/blob/main/README.md)

## 七、推荐的最小测试矩阵

| 场景 | L1/L2 | L3 harness | L4 Roam Web | L5 Desktop |
|---|---:|---:|---:|---:|
| 时间解析/安排算法 | 必须 | — | 抽样 | — |
| 引用 TODO/DONE 状态 | 必须 | — | 必须 | 抽样 |
| onload/onunload 清理 | 必须 | 可选 | 必须 | 必须 |
| 顶栏响应式与重建 | 模拟状态 | 必须 | 必须 | 必须 |
| SVG、tooltip、窄窗口 | — | 必须 | 抽样 | 抽样 |
| Enter CSS 延迟 | — | 预筛 | 主基准 | 最终 smoke |
| 右侧栏/聚焦/快捷键 | 行为单元 | 部分 | 必须 | 必须 |
| 本地 HTTP API | — | — | — | 如功能使用则必须 |

## 八、对当前 CSS 排查的直接建议

1. 不再通过打开日常 Roam App 和 DevTools 侧栏进行每轮初筛。
2. 先在 L3 harness 对规则组做二分，排除明显昂贵的全局 selector、动画、阴影和布局依赖。
3. 候选缩小后，在真实 Roam Web headless 的固定 fixture 上跑 Enter A/B。
4. 仅当 Event Timing 或应用里程碑显示稳定差异时，录制一次 headed Chrome Performance profile 定位 style/layout/paint。
5. 最后用 Roam Desktop 做一次视觉、焦点和快捷键 smoke，不把它作为批量性能采样器。

这套流程可以避免人为观感、DevTools 自身开销、API 轮询、缓存差异和页面持续增长共同污染结论，同时保留真实 Roam 环境的最终证据。

## 主要一手来源

- [Playwright：Authentication](https://playwright.dev/docs/auth)
- [Playwright：Browser Contexts](https://playwright.dev/docs/browser-contexts)
- [Playwright：Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright：CI](https://playwright.dev/docs/ci)
- [Playwright：Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Chrome：Headless mode](https://developer.chrome.com/docs/chromium/headless)
- [Chrome DevTools：Performance](https://developer.chrome.com/docs/devtools/performance)
- [web.dev：Interaction to Next Paint](https://web.dev/articles/inp)
- [web.dev：Optimize INP](https://web.dev/articles/optimize-inp)
- [W3C：Event Timing](https://www.w3.org/TR/event-timing/)
- [W3C：User Timing](https://www.w3.org/TR/user-timing/)
- [W3C：Long Tasks](https://www.w3.org/TR/longtasks-1/)
- [Roam Research：Roam Depot](https://github.com/Roam-Research/roam-depot)
- [Roam Research：Roam Tools](https://github.com/Roam-Research/roam-tools)
- [RoamJS：roamjs-components](https://github.com/RoamJS/roamjs-components)
