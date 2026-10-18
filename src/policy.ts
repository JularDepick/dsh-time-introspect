/* 反思注入的判定与自约束状态机, 全部为纯函数. */

import type { Config } from './config.js'
import type { IntrospectState, TurnRecord } from './state-types.js'

/** 一次反思注入所需的全部可观测数据. */
export interface ReflectionPlan {
  kind: 'reflection'
  record: TurnRecord
  actualMs: number
  estimateMs: number
  overrunMs: number
  overrunRatio: number
  toolTotalMs: number
  modelMs: number
  reflectionMs: number
  reflectionRatio: number
  restartReason: string | null
  firstInjection: boolean
}

/** 一次投放计划: 休眠通知或耗时反思. */
export type InjectionPlan = { kind: 'notice' } | ReflectionPlan

/** 汇总一轮内所有普通工具的执行耗时. */
export function toolTotalMs(record: TurnRecord): number {
  let total = 0
  for (const value of Object.values(record.toolMs)) total += value
  return total
}

/** 找到当前轮之前最近一个已闭合的轮次. */
export function previousTurn(state: IntrospectState, turn: number): TurnRecord | null {
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const candidate = state.turns[index]
    if (candidate === undefined) continue
    if (candidate.turn < turn && candidate.endTime !== null) return candidate
  }
  return null
}

/**
 * 决定本轮 step 1 是否注入, 以及注入什么.
 * 冷却中不注入; 休眠只在迁移后注入一次通知; 其余情况按预估偏差判定.
 */
export function planInjection(state: IntrospectState, turn: number, config: Config): InjectionPlan | null {
  if (state.status === 'dormant') {
    return state.noticePending ? { kind: 'notice' } : null
  }
  if (state.status === 'cooling') return null
  const record = previousTurn(state, turn)
  if (record === null || record.endTime === null || record.estimateMs === null) return null
  const actualMs = record.endTime - record.startTime
  /* 崩溃恢复合成的 closer 会复用最后事件时间, 零时长轮次不参与判定. */
  if (actualMs <= 0) return null
  const estimateMs = record.estimateMs
  const overrunMs = actualMs - estimateMs
  const overrunRatio = estimateMs > 0 ? overrunMs / estimateMs : 0
  if (overrunMs < config.minOverrunMs || overrunRatio < config.minOverrunRatio) return null
  const toolMs = toolTotalMs(record)
  const reflectionMs = record.reflectionMs
  const modelMs = Math.max(0, actualMs - toolMs - reflectionMs)
  return {
    kind: 'reflection',
    record,
    actualMs,
    estimateMs,
    overrunMs,
    overrunRatio,
    toolTotalMs: toolMs,
    modelMs,
    reflectionMs,
    reflectionRatio: actualMs > 0 ? reflectionMs / actualMs : 0,
    restartReason: state.restartPrefixPending ? state.restartReason : null,
    firstInjection: !state.everInjected,
  }
}

/**
 * 在一轮闭合时推进自约束状态机.
 * 冷却按轮倒计时; 冷却累计到上限后转入休眠; 休眠不再自动恢复.
 */
export function settleTurn(state: IntrospectState, record: TurnRecord, config: Config): IntrospectState {
  if (state.status === 'cooling') {
    const remaining = state.coolingRemaining - 1
    return remaining > 0
      ? { ...state, coolingRemaining: remaining }
      : { ...state, status: 'active', coolingRemaining: 0 }
  }
  if (state.status === 'dormant') return state
  if (record.endTime === null) return state

  const actualMs = record.endTime - record.startTime
  if (actualMs <= 0) return state
  const ratio = record.reflectionMs / actualMs
  const conservative = state.conservativeRemaining > 0
  const threshold = conservative ? config.coolRatioAfterResume : config.coolRatio
  const improved = hasImprovement(state, record, config)
  const highStreak = record.reflectionMs > 0 && ratio > threshold && !improved ? state.highStreak + 1 : 0
  const conservativeRemaining = Math.max(0, state.conservativeRemaining - 1)
  if (highStreak < config.coolAfterHighTurns) {
    return { ...state, highStreak, conservativeRemaining }
  }
  if (state.cooldownCount >= config.dormancyAfterCooldowns) {
    return {
      ...state,
      status: 'dormant',
      coolingRemaining: 0,
      highStreak: 0,
      conservativeRemaining,
      noticePending: true,
    }
  }
  const coolingLength = Math.min(config.coolTurns * 2 ** state.cooldownCount, config.coolTurns * 8)
  return {
    ...state,
    status: 'cooling',
    coolingRemaining: coolingLength,
    cooldownCount: state.cooldownCount + 1,
    highStreak: 0,
    conservativeRemaining,
  }
}

/** 判定本轮相对前序基线是否取得足够改善. */
export function hasImprovement(state: IntrospectState, record: TurnRecord, config: Config): boolean {
  const baseline: number[] = []
  for (const candidate of state.turns) {
    if (candidate.turn === record.turn || candidate.endTime === null) continue
    const actual = candidate.endTime - candidate.startTime
    if (actual > 0) baseline.push(actual)
  }
  if (baseline.length === 0) return false
  const recent = baseline.slice(-config.baselineTurns)
  const median = medianOf(recent)
  if (median <= 0) return false
  const actual = record.endTime === null ? 0 : record.endTime - record.startTime
  return actual <= median * (1 - config.minImprovementRatio)
}

/** 计算一组数值的中位数, 输入不会被修改. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  const lower = sorted[middle - 1] ?? 0
  const upper = sorted[middle] ?? 0
  return (lower + upper) / 2
}