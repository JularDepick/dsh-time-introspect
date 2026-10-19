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
| `tool/call`, `tool/result` | 按 `callId` 配对得到单次工具耗时 |
| `user/message` | 识别本插件注入的 JSON |
| `tool/call` 的 `arguments` | 读取预估, 休眠与重启的原因 |

事件信封上的 `time` 是唯一时间戳来源.

## 折叠状态

插件通过 `ctx.sessionProjections` 注册 host-only 投影, 折叠为逐会话状态:

- 每轮记录: 开始与结束时间, 预估, 按工具聚合的耗时, 反思窗口, 反思内部工具与模型时间
- 跨轮状态: `active` 或 `dormant`, 待展示的重启标记, 是否已注入过
- 完成轮次按 `maxTurnHistory` 截断, 未配对调用在轮次结束时清空

状态在进程重启后由日志重放自动重建.

## 时间口径

- 实际耗时 = `turn/end.time - turn/start.time`
- 工具耗时 = `tool/result.time - tool/call.time`
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
- 反思窗口开启后轮次结束仍未 stop 的, 不记账

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
| `src/index.ts` | 插件入口: 装配投影与工具, 注册 pre-step 监听器 |
| `src/config.ts` | 配置 schema 与加载期校验 |
| `src/state.ts` | 投影定义与纯折叠函数 |
| `src/policy.ts` | 注入判定与状态迁移 |
| `src/render.ts` | JSON 注入与状态结果渲染 |
| `src/session.ts` | 主会话判定 |
| `src/tools.ts` | 六个工具的注册与参数校验 |
| `src/state-types.ts` | 投影状态的数据形状 |
| `client/index.ts` | 浏览器半端: 工具调用位置的红点气泡 |
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