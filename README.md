<div align="center">

# dsh-time-introspect

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-time-introspect/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English](./README_en-US.md) | [简体中文]

</div>

面向 dsh 的耗时反思插件: 超时后把上一轮的耗时分布送到模型面前, 让模型自己定位时间去了哪, 自己调整; 反思本身的开销持续偏高时插件主动休眠, 模型可随时把它重新打开

支持 dsh 0.2.0-rc.2, 0.2.1-rc.1 与 0.2.1-rc.2

---

## 特性

- 超时触发: 仅当上一轮实际耗时同时超过预估比例(`minOverrunRatio`, 默认 20%)与绝对下限(`minOverrunMs`, 默认 5000 毫秒)时, 在下一轮 step 1 注入一次反馈; 非超时轮次不产生任何耗时注入
- 耗时分布: 按工具名降序聚合执行耗时, 超过 `topTools` 项的工具并入"其他工具"; "模型自身处理"作为独立项参与排序
- 定位到分工: "模型自身处理" = 实际耗时 - 工具耗时 - 反思开销, 这一项单独成行, 用于判断时间花在工具编排还是自身推理
- 反思自计费: 从注入进入会话日志到反思阶段结束之间的可观测耗时计入"反思开销", 并在下一次反馈中送达, 让模型自己判断反思是否还值得继续
- 自约束: 连续多轮反思占比过高且耗时没有改善时进入冷却, 冷却累计到上限后休眠; 休眠只注入一次通知, 此后保持安静
- 模型可重启: `resume_reflection` 始终注册, 模型可以随时重新启用反思并写下自述原因; 重启后的前若干轮使用更保守的冷却阈值, 防止"重启后立即再次休眠"的空转
- 可回放: 全部状态从会话事件日志折叠而来, 进程重启后自动重建, 不写入任何自定义会话事件类型
- 双语文案: 模型可见的注入与工具描述可选中文(`zh-CN`, 默认)或英文(`en-US`)

## 模型看到什么

上一轮预估 30 秒, 实际 52 秒, 下一轮 step 1 会收到:

```text
[耗时反思] 第 3 轮: 预估 30.0s, 实际 52.0s, 超出 73% (+22.0s).

耗时分布: bash 22.1s (43%) / 模型自身处理 13.4s (26%) / read 9.4s (18%) / 其他工具 2.3s (4%)

模型自身处理: 13.4s (26%). 若此项偏高, 优先压缩思考链, 而不是调整工具编排.

反思开销: 4.8s, 占该轮总耗时 9%.
```

首次注入会额外附带一行口径提示, 说明 `task_estimate` 与 `report_reflection_cost` 的用法. 反思由模型主动重启时, 注入开头会带上模型自述的原因.

## 安装

```sh
dsh plugin --profile <name> add dsh-time-introspect
```

`<name>` 是目标 profile, 例如 `web`, `desktop` 或专用 profile.

安装后的默认配置即可工作. 插件不主动推送耗时读数, 只有模型用 `task_estimate` 登记过预估的轮次才会被比较.

## 工具

| 工具 | 作用 | 参数 |
|:---:|:---|:---|
| `task_estimate` | 登记本轮预估耗时(毫秒). 任务开始时调用; 同一轮多次调用以最后一次为准 | `estimateMs` 必填, 上限 24 小时; `note` 可选 |
| `report_reflection_cost` | 标记反思分析结束, 结束反思计时 | `summary` 可选, `worthIt` 可选 |
| `resume_reflection` | 反思休眠后重新启用. 任何时候都可调用, 不审查理由 | `reason` 必填, 最长 500 字符 |

三个工具都是建议性通道: 插件不阻断任何工具调用, 也不检查模型是否真的执行了反思.

## 配置

在 profile 的 `cordis.patch.yml` 或插件行中覆盖默认值:

```yaml
- name: dsh-time-introspect
  config:
    minOverrunRatio: 0.15
    minOverrunMs: 3000
    topTools: 6
    locale: zh-CN
```

| 字段 | 默认值 | 含义 |
|:---:|:---:|:---|
| `enabled` | `true` | 总开关. 关闭后不注册投影, 工具与监听器 |
| `minOverrunRatio` | `0.20` | 触发注入所需的最小超出比例 |
| `minOverrunMs` | `5000` | 触发注入所需的最小绝对超出毫秒数 |
| `coolRatio` | `0.15` | 反思开销占本轮耗时的冷却阈值 |
| `coolRatioAfterResume` | `0.10` | 模型主动重启后前若干轮使用的更严格阈值 |
| `conservativeTurns` | `2` | 重启后保守阈值的持续轮数 |
| `coolAfterHighTurns` | `2` | 连续多少轮高于阈值且无改善后进入冷却 |
| `minImprovementRatio` | `0.10` | 相对前序基线判定为有改善所需的最小耗时下降比例 |
| `baselineTurns` | `3` | 计算改善基线时回看的已完成轮数 |
| `coolTurns` | `3` | 首次冷却持续的轮数, 之后每轮冷却翻倍 |
| `dormancyAfterCooldowns` | `2` | 累计冷却次数达到该值后进入休眠 |
| `topTools` | `5` | 耗时分布中最多单独列出的工具数 |
| `maxTurnHistory` | `12` | 投影保留的已完成轮数上限 |
| `locale` | `zh-CN` | 模型可见文案语言, 可选 `zh-CN` 或 `en-US` |
| `reflectionTools` | `[]` | 视为反思工具的额外工具名, 其耗时不进入普通工具分桶 |

非法配置在插件加载时直接失败, 不会静默回退到默认值.

## 口径与判定

- 上一轮: 当前轮之前最近一个已闭合的轮次. 当前轮没有前序轮次或前序轮次没有 `task_estimate` 记录时不注入
- 实际耗时: `turn/end` 事件时间减去 `turn/start` 事件时间
- 工具耗时: 按 `callId` 配对 `tool/call` 与 `tool/result`, 覆盖审批等待与会话排队时间
- 反思开销: 从注入消息进入日志到反思阶段结束. 结束点是 `report_reflection_cost` 的结果, 或反思后第一个普通工具调用的开始, 先到者为准; 一轮结束时仍未结束的窗口不记为反思开销
- 模型自身处理: `实际耗时 - 工具耗时 - 反思开销`, 下限为 0
- 恢复产生的零时长轮次(崩溃恢复时会复用最后事件时间)不参与注入与自约束判定

自约束状态迁移:

| 状态 | 行为 | 迁入条件 | 迁出条件 |
|:---:|:---|:---|:---|
| active | 正常判定并注入 | 初始状态, 或冷却期结束 | 连续 `coolAfterHighTurns` 轮反思占比高于阈值且无改善 |
| cooling | 不注入 | 触发冷却 | 经过 `coolTurns` 轮(每轮冷却翻倍, 最多 8 倍) |
| dormant | 不注入, 不累计反思开销, 只发一次通知 | 累计冷却次数达到 `dormancyAfterCooldowns` | 模型调用 `resume_reflection` |

重启后 `conservativeTurns` 轮内使用 `coolRatioAfterResume`, 冷却计数清零, 但保留普通工具耗时记录, 便于重启前后对比.

## 与时钟插件的关系

本插件不替代 `dsh-time-context` 或 `dsh-time-reminder`. 那两者负责"让模型知道时间", 本插件负责"在超时后告诉模型时间去了哪, 并让反思本身有成本". 三者可以同时挂载.

## 兼容性

| 项目 | 说明 |
|:---:|:---|
| dsh | `0.2.0-rc.2`, `0.2.1-rc.1`, `0.2.1-rc.2` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 判定方式 | `engines.dsh` 与所有 `@deepseek-ai/dsh*` peer 依赖声明同一组受支持版本; 0.2.1-rc.1 起存在 `engines.dsh` 时以它为准, 早期版本校验 peer 范围 |

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

构建产物在 `lib/`, 入口为 `lib/index.js`. 本地调试时先用 `npm run build` 生成产物, 再把 `--patch` 指向 `lib/index.js`. 机制细节见 [docs/mechanism.md](./docs/mechanism.md).

目录结构:

```text
dsh-time-introspect/
├── .gitignore            # git 忽略规则
├── COPYRIGHT             # 版权声明
├── LICENSE               # Apache-2.0 许可证
├── README.md             # 中文 README
├── README_en-US.md       # 英文 README
├── cordis.patch.yml      # 组合包 patch 层
├── docs/                 # 项目文档与官方开发文档快照
├── package.json          # 包清单
├── src/                  # 插件源码
├── test/                 # 单元测试
├── tsconfig.build.json   # 构建配置
├── tsconfig.json         # 类型检查配置
└── version.index.md      # 版本号出现位置索引
```

## 边界

- 不定义"合理耗时"标准, 只呈现分布与偏差
- 不用于考核, 排名或惩罚, 耗时数据只为反馈与审计
- 不修改模型权重, 不训练, 只做推理时的上下文干预
- 没有预估记录的轮次不触发任何行为
- 不写入自定义会话事件类型, 状态完全由官方事件日志折叠得到

## 许可证

[Apache-2.0](./LICENSE)