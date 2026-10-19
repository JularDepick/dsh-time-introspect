<div align="center">

# dsh-time-introspect

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-time-introspect/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English](./README_en-US.md) | [简体中文]

</div>

面向 dsh 的耗时反思插件: 上一轮实际耗时超出模型预估时, 把完整的耗时分布以 JSON 注入下一轮, 由模型自己决定是否反思. 反思的开始与结束都由模型显式调用工具, 插件只负责计时与记账; 插件不自动冷却, 不自动休眠, 是否让插件安静由模型决定.

支持 dsh 0.2.0-rc.2, 0.2.1-rc.1 与 0.2.1-rc.2

---

## 特性

- 超时触发: 仅当上一轮有预估记录, 且实际耗时同时超过比例阈值(`minOverrunRatio`, 默认 20%)与绝对下限(`minOverrunMs`, 默认 5000 毫秒)时, 在下一轮 step 1 注入一次
- 完整 JSON: 注入内容是结构化 JSON, 包含总账, 工具耗时, 模型自身处理与反思内部明细; 全部工具逐个列出, 不做 top N 合并
- 显式反思边界: 模型调用 `time_introspect_start` 开始, `time_introspect_stop` 结束; 插件按两次调用的位置计时, 模型不需要整理或上报任何耗时数据
- 反思自计费: 反思窗口内的全部耗时计入反思开销, 窗口内的工具单独列在 `introspect` 明细里, 帮助模型判断反思本身是否值得
- 模型控制休眠: `time_introspect_shut` 让插件休眠, `time_introspect_waken` 恢复; 没有自动冷却与自动休眠
- 对话内红点气泡: 每次模型调用本插件工具, 都在该工具调用位置显示红点; 新调用展开一行简要提示, 3 秒后收起, 红点保留; 点击红点可展开或收起详细信息
- 状态可查: `time_introspect_status` 只读返回状态, 最近一轮总账与三类耗时合计
- 仅主会话: 子代理会话不注入, 六个工具在子代理中完全隐藏
- 可回放: 状态由会话投影从官方事件折叠, 进程重启自动重建; 不写自定义会话事件
- 双语文案: `locale` 可选中文(`zh-CN`, 默认)或英文(`en-US`)

## 模型看到什么

```json
{
  "type": "time_introspect",
  "desc": "本 JSON 由 dsh-time-introspect 插件自动统计生成, 内容是上一轮任务的耗时分布报告. 是否据此反思由你决定; 如需反思, 调用 time_introspect_start 开始, 完成后调用 time_introspect_stop.",
  "turn": 3,
  "waken": { "reason": "连续三轮工具调用冗余, 工作越来越难推进" },
  "estimate_ms": 100000,
  "overrun_ms": 30000,
  "overrun_ratio": 0.3,
  "time_consume_total_ms": 130000,
  "time_consume_details": {
    "tool": {
      "desc": "本层是反思窗口外的工具耗时, 不含反思窗口内调用的工具; 含反思窗口外的本插件工具(包括开始与结束边界工具)的调用耗时.",
      "ratio": 0.0769,
      "total_ms": 10000,
      "details": [
        { "name": "bash", "calls": 3, "ms": 4000, "ratio": 0.4 },
        { "name": "read", "calls": 2, "ms": 2000, "ratio": 0.2 },
        { "name": "write", "calls": 4, "ms": 3000, "ratio": 0.3 },
        { "name": "time_introspect_start", "calls": 1, "ms": 300, "ratio": 0.03 },
        { "name": "time_introspect_stop", "calls": 1, "ms": 700, "ratio": 0.07 }
      ]
    },
    "model": { "desc": "本层是反思窗口外的模型自身处理与等待耗时, 不含反思窗口内的模型耗时, 也不含任何工具耗时.", "ratio": 0.7693, "total_ms": 100000 },
    "introspect": {
      "desc": "本层是反思窗口内的全部耗时, 含窗口内调用的工具(包括本插件工具)与模型处理; 开始与结束工具本身在窗口外, 不计入本层.",
      "ratio": 0.1538,
      "total_ms": 20000,
      "details": {
        "tool": {
          "desc": "本层是反思窗口内调用的工具耗时, 含窗口内调用的本插件工具; 开始与结束工具本身在窗口外, 不计入本层.",
          "ratio": 0.3,
          "total_ms": 6000,
          "details": [
            { "name": "bash", "calls": 10, "ms": 5000, "ratio": 0.8333 },
            { "name": "read", "calls": 2, "ms": 1000, "ratio": 0.1667 }
          ]
        },
        "model": { "desc": "本层是反思窗口内的模型处理与等待耗时, 不含窗口内工具耗时.", "ratio": 0.7, "total_ms": 14000 }
      }
    }
  }
}
```

`waken` 只在模型重启后的第一次注入出现, 之后省略. 每个耗时层都带 `desc`, 说明该层是否包含反思工具与本插件工具. 每层 `ratio` 保留 4 位小数, 缺失差值补给该层最大项.

## 安装

```sh
dsh plugin --profile <name> add dsh-time-introspect
```

`<name>` 是目标 profile, 例如 `web`, `desktop` 或专用 profile.

## 工具

| 工具 | 参数 | 行为 |
|:---:|:---|:---|
| `time_introspect_estimate` | `estimateMs` | 登记本轮预估, 同轮以最后一次为准 |
| `time_introspect_start` | 无 | 开始反思; 本轮必须先收到注入, 已有打开窗口时报错 |
| `time_introspect_stop` | 无 | 结束反思; 没有打开窗口时报错 |
| `time_introspect_shut` | `reason` | 休眠; 已休眠时幂等返回, 丢弃未闭合窗口 |
| `time_introspect_waken` | `reason` | 重启; 已活动时幂等返回 |
| `time_introspect_status` | 无 | 只读查询状态与最近一轮总账 |

工具名统一带 `time_introspect_` 前缀. 插件不阻断任何工具调用, 也不检查模型是否真的完成了反思.

## 配置

```yaml
- name: dsh-time-introspect
  config:
    minOverrunRatio: 0.15
    minOverrunMs: 3000
    locale: zh-CN
```

| 字段 | 默认值 | 含义 |
|:---:|:---:|:---|
| `enabled` | `true` | 总开关; 关闭后不注册投影, 工具与监听器 |
| `minOverrunRatio` | `0.20` | 触发注入所需的最小超出比例 |
| `minOverrunMs` | `5000` | 触发注入所需的最小绝对超出毫秒数 |
| `maxTurnHistory` | `12` | 投影保留的已完成轮数上限 |
| `locale` | `zh-CN` | 模型可见文案语言, 可选 `zh-CN` 或 `en-US` |

气泡自动展开时长固定为 3 秒, 历史调用自动展开窗口固定为 15 秒, 不提供配置.

## 口径与判定

- 实际耗时: `turn/end` 事件时间减去 `turn/start` 事件时间
- 工具耗时: 按 `callId` 配对 `tool/call` 与 `tool/result`
- 反思窗口: `time_introspect_start` 的工具结果到 `time_introspect_stop` 的工具调用开始
- 反思窗口内全部耗时计入反思开销; 窗口内的普通工具与插件工具进入 `introspect.details.tool`, 不再进入顶层 `tool.details`
- 本插件自身工具与其他工具一样进入 `tool.details`, 不单列插件开销
- 顶层关系: `time_consume_total_ms = tool.total_ms + model.total_ms + introspect.total_ms`
- 每层 `ratio` 相对该层父级总量, 4 位小数, 缺失差值补给最大项
- 恢复产生的零时长轮次不参与注入判定

## 状态

| 状态 | 行为 | 迁入 | 迁出 |
|:---:|:---|:---|:---|
| active | 正常判定并注入 | 初始状态, 或模型重启 | 模型调用 `time_introspect_shut` |
| dormant | 不注入, 不累计反思 | 模型调用 `time_introspect_shut` | 模型调用 `time_introspect_waken` |

没有自动冷却, 没有自动休眠. 是否让插件安静由模型决定.

## 用户可见气泡

- 气泡做进对话记录, 不覆盖输入框, 不阻塞模型或用户操作, 随聊天记录滚动
- 每个本插件工具调用位置都有一个红点按钮; 红点只是位置标记, 不表示调用失败
- 新调用出现时自动展开一行简要提示, 3 秒后收起; 红点保留
- 只有挂载时距调用时间不超过 15 秒的调用会自动展开; 历史记录中的调用只显示红点, 避免打开旧会话时同时弹出大量气泡
- 点击红点展开或收起详细信息; 展开后不会自动收起, 直到再次点击
- 详情包含工具名, 阶段, 时间, 轮次, 参数与结果; 结束反思会显示本次反思耗时, 状态查询会显示结果 JSON
- 文案跟随 Web UI 语言

## 与时钟插件的关系

本插件不替代 `dsh-time-context` 或 `dsh-time-reminder`. 那两者负责"让模型知道时间", 本插件负责"在超时后告诉模型时间去了哪, 并让反思本身有成本". 三者可以同时挂载.

## 兼容性

| 项目 | 说明 |
|:---:|:---|
| dsh | `0.2.0-rc.2`, `0.2.1-rc.1`, `0.2.1-rc.2` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 判定方式 | `engines.dsh` 与所有 `@deepseek-ai/dsh*` peer 声明同一组受支持版本; 0.2.1-rc.1 起存在 `engines.dsh` 时以它为准 |

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm run pack
```

构建产物在 `lib/`, 入口为 `lib/index.js`, 客户端入口为 `lib/client.js`. `npm run build` 同时生成 host 与 client; `npm run build:client` 只重建客户端. `npm run pack` 把 tgz 产物统一放进 `release/`. 机制细节见 [docs/mechanism.md](./docs/mechanism.md).

目录结构:

```text
dsh-time-introspect/
├── .gitignore            # git 忽略规则
├── COPYRIGHT             # 版权声明
├── LICENSE               # Apache-2.0 许可证
├── README.md             # 中文 README
├── README_en-US.md       # 英文 README
├── client/               # 浏览器半端: 红点气泡
├── cordis.patch.yml      # 组合包 patch 层
├── docs/                 # 项目文档与官方开发文档快照
├── package.json          # 包清单
├── scripts/              # 辅助脚本
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
- 不自动冷却, 不自动休眠
- 不写自定义会话事件, 状态完全由官方事件日志折叠得到
- 只对主会话生效

## 许可证

[Apache-2.0](./LICENSE)