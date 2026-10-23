# 耗时反思机制

面向插件维护者的机制说明. 用户视角的使用方式见 [README](../README.md).

## 设计目标

在超时发生的时刻, 把分散的耗时数据聚合为一份结构化 JSON 送达模型. 反思由模型显式开始与结束, 插件只负责计时与记账. 插件不自动冷却, 不自动休眠, 是否让插件安静由模型决定.

插件只对主会话生效.

## 数据来源

全部数据来自官方会话事件日志, 不写入自定义事件类型:

| 事件 | 用途 |
|:---:|:---|
| `turn/start`, `turn/end` | 轮次边界与实际耗时 |
| `tool/call`, `tool/result` | 按 `callId` 配对得到单次原生工具耗时 |
| `tool/ptc-dispatch-start`, `tool/ptc-dispatch` | PTC 模式下按 `subCallId` 配对得到嵌套工具耗时 |
| `user/message` | 识别本插件注入的 JSON |
| 工具事件的 `arguments` | 读取预估, 休眠与重启的原因 |

事件信封上的 `time` 是唯一时间戳来源.

## 折叠状态

插件通过 `ctx.sessionProjections` 注册 host-only 投影, 折叠为逐会话状态:

- 每轮记录: 开始与结束时间, 预估, 按工具聚合的耗时, 反思窗口, 反思内部工具与模型时间
- 跨轮状态: `active` 或 `dormant`, 待展示的重启标记, 是否已注入过
- 每轮归档: 与注入 JSON 同结构的报告记录, 未触发注入时总账字段为 `null`
- 注入记录: 每次注入的轮次, 被统计轮次, 预估与实际, 是否开始与结束反思, 反思耗时与最终状态
- 完成轮次按 `maxTurnHistory` 截断; 归档与注入记录分别按 200 条截断; 未配对调用在轮次结束时清空

状态在进程重启后由日志重放自动重建.

## 时间口径

- 实际耗时 = `turn/end.time - turn/start.time`
- 工具耗时 = `tool/result.time - tool/call.time`; PTC 子调用 = `tool/ptc-dispatch.time - tool/ptc-dispatch-start.time`
- 子调用按真实工具名入桶, 外层 `run_code` 只记扣除子调用后的净耗时, 总账不重复计数
- PTC 事件不带轮次, 只能挂到当前未闭合的轮次; 轮次闭合后到达的子调用直接丢弃
- 反思窗口 = `time_introspect_start` 的工具结果到 `time_introspect_stop` 的工具调用开始
- 反思窗口内的全部耗时计入反思, 包括窗口内的普通工具与插件工具
- 反思窗口内的工具进入 `introspect.details.tool`, 不再进入顶层 `tool.details`
- 顶层三项相加等于实际耗时: `tool.total_ms + model.total_ms + introspect.total_ms = time_consume_total_ms`
- 每层 `ratio` 相对该层父级总量, 保留 4 位小数, 缺失差值补给该层最大项
- 崩溃恢复合成的零时长轮次不参与判定

## 工具语义

| 工具 | 成功 | 失败或幂等 |
|:---:|:---|:---|
| `time_introspect_estimate` | 记录本轮预估, 同轮最后一次为准 | 非正整数或超过 24 小时报错 |
| `time_introspect_start` | 打开反思窗口 | 本轮无注入报错; 已有打开窗口报错 |
| `time_introspect_stop` | 关闭窗口并结算 | 没有打开窗口报错 |
| `time_introspect_shut` | 进入 dormant | 已 dormant 时幂等返回, 不覆盖原因; 丢弃未闭合窗口 |
| `time_introspect_waken` | 进入 active, 下一次注入带重启原因 | 已 active 时幂等返回 |
| `time_introspect_status` | 返回状态与最近一轮总账 | 无 |

一轮最多一次反思; 跨轮未闭合的窗口在轮次结束时丢弃.

## 注入

触发条件:

1. 上一轮有预估记录
2. 实际耗时同时超过 `minOverrunRatio` 与 `minOverrunMs`
3. 状态为 active
4. 当前轮 step 1

注入内容为纯 JSON, 消息来源 `dsh-time-introspect`, 不带代码围栏. 结构包含:

- `type`, `desc`, `turn`
- `waken`: 仅在模型重启后的第一次注入出现
- `estimate_ms`, `overrun_ms`, `overrun_ratio`
- `time_consume_total_ms`
- `time_consume_details`: `tool`, `model`, `introspect` 三类; `introspect` 内再分 `tool` 与 `model`

`details` 数组每个对象占一行; 全部工具逐个列出, 不设 top N. `desc` 只说明 JSON 是什么, 不披露数据. 文案语言由 `locale` 控制.

## 归档与落盘

- 每个主会话 `turn/end` 都生成一条归档; 归档只进入会话投影与 profile 文件, 不进入模型上下文, 也不参与注入判定
- 归档结构与注入 JSON 相同; 未触发注入的轮次 `estimate_ms`, `overrun_ms`, `overrun_ratio` 为 `null`
- 文件路径为 `$DSH_HOME/profiles/<profile>/time-introspect/<sessionId>.json`; 内容包含 `sessionId`, `updatedAt`, `archive` 与 `injections` 两个数组
- 写盘由 `session/event` 的 `turn/end` 触发, 通过 `queueMicrotask` 等投影更新后读取状态; 同一文件的写入按队列串行并原子替换
- profile 目录优先从运行期 `baseUrl` 向上查找 `profiles/<name>`; 找不到时回退到 `DSH_HOME` 下 bundle 清单含本插件的 profile
- 写盘失败只记录告警, 不影响注入或 agent; 归档最多保留 200 轮

注入记录的状态:

| 状态 | 含义 |
|:---:|:---|
| `pending` | 注入已出现, 当前轮尚未结束, 还没开始反思 |
| `open` | 已 `start`, 反思窗口打开 |
| `completed` | `start` 与 `stop` 都完成 |
| `incomplete` | 已 `start`, 但轮次结束前没有 `stop` |
| `not_started` | 注入后没有 `start` |
| `aborted` | 反思窗口被 `shut` 丢弃 |

## 状态查询

返回结构化结果并渲染为 JSON:

- `state`, `dormant`, `introspection_open`
- `last_turn`: 轮次, 预估, 实际, 超出量, 超出比例, 实际总耗时
- `totals`: `tool_ms`, `model_ms`, `introspect_ms`

没有上一轮记录时 `last_turn` 为 `null`.

## 仅主会话

- 注入监听器只处理主会话的 `agent/pre-step`
- 子代理会话中六个工具完全隐藏, 工具执行入口再做一次主会话检查
- 不提供子代理启用声明

## 已知限制

- 分叉会话的继承前缀不会重放, 分叉后的第一个存活轮次没有可比的前序轮次
- 崩溃恢复产生的合成 closer 复用最后事件时间, 零时长轮次被跳过
- 一轮最多一次反思; 跨轮窗口丢弃
- 没有自动冷却或自动休眠; 是否安静完全取决于模型是否调用 `time_introspect_shut`
- 反思窗口开启后轮次结束仍未 stop 的, 不记账, 注入记录标记为 `incomplete`
- profile 目录无法解析时只跳过写盘, 归档仍保留在会话投影中
- PTC 子调用的起止取两个派发事件的时间, 与被调用工具的真实执行边界相差数毫秒
- 旧版 dsh 若不写派发事件, PTC 嵌套调用按原生行为处理, 只记录外层 `run_code`

## 自省 Tab

会话区域通过 `conversation.view` 注册"耗时自省"视图, 与对话, 轨迹等视图并列:

- 上半部分按轮倒序展示归档; 每张卡片默认收起, 点击后显示预估, 实际, 超出比例与三类耗时
- 工具 `details` 数组默认收起; 展开卡片后可继续点击"展开明细"查看工具明细与反思内工具明细
- 下半部分按注入倒序展示反思记录; 每条显示注入轮次, 被统计轮次, 反思状态与反思耗时
- 卡片与记录都可展开/收起; Tab 数据通过 `useProjection` 读取当前会话投影, 随事件实时更新
- 文件是持久化镜像, Tab 不依赖额外 HTTP 路由

## 用户可见气泡

客户端半端通过 `tool.call.toolview` 为六个工具注册原子视图, 在每次工具调用位置渲染红点按钮与可展开气泡:

- 新调用自动展开一行简要提示, 3 秒后收起; 红点保留
- 只有挂载时距调用时间不超过 15 秒的调用自动展开, 历史调用只显示红点
- 点击红点展开或收起详细信息; 展开后不自动收起
- 气泡位于对话记录内, 随聊天滚动, 不阻塞输入与模型
- 详情从工具阶段参数与结果中读取; 结束反思的耗时来自客户端投影
- 文案由客户端 locale 字典提供

## 源码地图

| 文件 | 职责 |
|:---:|:---|
| `src/index.ts` | 插件入口: 装配投影, 工具, pre-step 与归档写盘监听器 |
| `src/config.ts` | 配置 schema 与加载期校验 |
| `src/state.ts` | 投影定义, 纯折叠函数, 归档与注入记录 |
| `src/policy.ts` | 注入判定与状态迁移 |
| `src/render.ts` | JSON 注入, 归档 JSON 与状态结果渲染 |
| `src/archive.ts` | profile 归档写盘与路径解析 |
| `src/report-types.ts` | 注入与归档共用的数据形状 |
| `src/session.ts` | 主会话判定 |
| `src/tools.ts` | 六个工具的注册与参数校验 |
| `src/state-types.ts` | 投影状态的数据形状 |
| `client/index.ts` | 浏览器半端: 工具调用位置的红点气泡与耗时自省 Tab |
| `scripts/build-client.mjs` | 用 esbuild 生成 `lib/client.js` 并套上客户端模块加载器 |
| `src/types.ts` | 消息来源与投影状态的类型声明合并 |

## 测试

目标覆盖:

- 注入阈值(无预估, 比例, 绝对值, dormant)
- 工具语义(开始前置, 严格配对, 幂等休眠/重启)
- 时间口径(反思全包, 顶层三项相加, 每层 ratio 校正)
- 投影折叠(工具聚合, 反思窗口, 状态迁移, 历史截断)
- 仅主会话(子代理隐藏)
- JSON 结构与一行一个 details 对象
- 归档字段, 注入记录状态与 profile 写盘