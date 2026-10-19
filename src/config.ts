/* 插件配置与加载期校验. */

import Schema from '@deepseek-ai/schemastery'
import { MAX_ESTIMATE_MS } from './constants.js'

export interface Config {
  /** 总开关; 关闭后不注册投影, 工具与监听器. */
  enabled: boolean
  /** 触发注入所需的最小超出比例. */
  minOverrunRatio: number
  /** 触发注入所需的最小绝对超出毫秒数. */
  minOverrunMs: number
  /** 投影保留的已完成轮数上限. */
  maxTurnHistory: number
  /** 模型可见文案语言. */
  locale: 'zh-CN' | 'en-US'
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  minOverrunRatio: Schema.number().default(0.2),
  minOverrunMs: Schema.number().default(5000),
  maxTurnHistory: Schema.number().default(12),
  locale: Schema.union(['zh-CN', 'en-US']).default('zh-CN'),
})

/** 校验配置在运行期的取值边界; 非法值在插件加载时直接失败. */
export function validateConfig(config: Config): void {
  if (!Number.isFinite(config.minOverrunRatio) || config.minOverrunRatio < 0 || config.minOverrunRatio > 1) {
    throw new TypeError(`time-introspect: minOverrunRatio must be a finite number within [0, 1], got ${String(config.minOverrunRatio)}`)
  }
  if (!Number.isSafeInteger(config.minOverrunMs) || config.minOverrunMs < 0) {
    throw new TypeError(`time-introspect: minOverrunMs must be a safe integer >= 0, got ${String(config.minOverrunMs)}`)
  }
  if (!Number.isSafeInteger(config.maxTurnHistory) || config.maxTurnHistory < 1) {
    throw new TypeError(`time-introspect: maxTurnHistory must be a safe integer >= 1, got ${String(config.maxTurnHistory)}`)
  }
  if (config.locale !== 'zh-CN' && config.locale !== 'en-US') {
    throw new TypeError(`time-introspect: locale must be zh-CN or en-US, got ${String(config.locale)}`)
  }
  if (!Number.isSafeInteger(MAX_ESTIMATE_MS) || MAX_ESTIMATE_MS <= 0) {
    throw new TypeError('time-introspect: MAX_ESTIMATE_MS must be a positive safe integer')
  }
}
