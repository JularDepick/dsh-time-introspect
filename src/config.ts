/* 插件配置与加载期校验. */

import Schema from '@deepseek-ai/schemastery'
import { MAX_ESTIMATE_MS } from './constants.js'

export interface Config {
  /** 总开关; 关闭后仍注册工具但不注入任何提示. */
  enabled: boolean
  /** 触发反思注入所需的最小超出比例. */
  minOverrunRatio: number
  /** 触发反思注入所需的最小绝对超出毫秒数. */
  minOverrunMs: number
  /** 反思开销占本轮耗时的冷却阈值. */
  coolRatio: number
  /** 模型主动重启后的前若干轮使用的更严格冷却阈值. */
  coolRatioAfterResume: number
  /** 重启后保守阈值的持续轮数. */
  conservativeTurns: number
  /** 连续多少轮高于阈值且无改善后进入冷却. */
  coolAfterHighTurns: number
  /** 判定为有改善所需的最小耗时下降比例. */
  minImprovementRatio: number
  /** 计算改善基线时回看的已完成轮数. */
  baselineTurns: number
  /** 首次冷却持续的轮数, 之后每次冷却翻倍. */
  coolTurns: number
  /** 累计冷却次数达到该值后进入休眠. */
  dormancyAfterCooldowns: number
  /** 耗时分布中最多单独列出的工具数. */
  topTools: number
  /** 投影保留的已完成轮数上限. */
  maxTurnHistory: number
  /** 模型可见文案的语言. */
  locale: 'zh-CN' | 'en-US'
  /** 额外视为反思工具的已安装工具名. */
  reflectionTools: string[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  minOverrunRatio: Schema.number().default(0.2),
  minOverrunMs: Schema.number().default(5000),
  coolRatio: Schema.number().default(0.15),
  coolRatioAfterResume: Schema.number().default(0.1),
  conservativeTurns: Schema.number().default(2),
  coolAfterHighTurns: Schema.number().default(2),
  minImprovementRatio: Schema.number().default(0.1),
  baselineTurns: Schema.number().default(3),
  coolTurns: Schema.number().default(3),
  dormancyAfterCooldowns: Schema.number().default(2),
  topTools: Schema.number().default(5),
  maxTurnHistory: Schema.number().default(12),
  locale: Schema.union(['zh-CN', 'en-US']).default('zh-CN'),
  reflectionTools: Schema.array(Schema.string()).default([]),
})

/** 校验配置在运行期的取值边界; 非法值在插件加载时直接失败. */
export function validateConfig(config: Config): void {
  assertRatio('minOverrunRatio', config.minOverrunRatio, 0)
  assertRatio('coolRatio', config.coolRatio, 0)
  assertRatio('coolRatioAfterResume', config.coolRatioAfterResume, 0)
  assertRatio('minImprovementRatio', config.minImprovementRatio, 0)
  assertInteger('minOverrunMs', config.minOverrunMs, 0)
  assertInteger('conservativeTurns', config.conservativeTurns, 0)
  assertInteger('coolAfterHighTurns', config.coolAfterHighTurns, 1)
  assertInteger('baselineTurns', config.baselineTurns, 1)
  assertInteger('coolTurns', config.coolTurns, 1)
  assertInteger('dormancyAfterCooldowns', config.dormancyAfterCooldowns, 1)
  assertInteger('topTools', config.topTools, 1)
  assertInteger('maxTurnHistory', config.maxTurnHistory, 4)
  if (config.baselineTurns > config.maxTurnHistory) {
    throw new TypeError('time-introspect: baselineTurns must not exceed maxTurnHistory')
  }
  if (config.reflectionTools.some((name) => name.trim().length === 0)) {
    throw new TypeError('time-introspect: reflectionTools must not contain empty names')
  }
  if (!Number.isSafeInteger(MAX_ESTIMATE_MS) || MAX_ESTIMATE_MS <= 0) {
    throw new TypeError('time-introspect: MAX_ESTIMATE_MS must be a positive safe integer')
  }
}

function assertRatio(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min || value > 1) {
    throw new TypeError(`time-introspect: ${name} must be a finite number within [${min}, 1], got ${String(value)}`)
  }
}

function assertInteger(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`time-introspect: ${name} must be a safe integer >= ${min}, got ${String(value)}`)
  }
}
