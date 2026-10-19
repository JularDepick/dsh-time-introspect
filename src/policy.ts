/* 注入判定与派生统计, 全部为纯函数. */

import type { Config } from './config.js'
import type { IntrospectState, ToolAggregate, TurnRecord } from './state-types.js'

/** 一次注入所需的全部可观测数据. */
export interface InjectionPlan {
  record: TurnRecord
  actualMs: number
  estimateMs: number
  overrunMs: number
  overrunRatio: number
  toolTotalMs: number
  introspectTotalMs: number
  modelTotalMs: number
  wakenReason: string | null
}

/** 汇总一组工具聚合的毫秒数. */
export function aggregateTotal(aggregates: Record<string, ToolAggregate>): number {
  let total = 0
  for (const value of Object.values(aggregates)) total += value.ms
  return total
}

/** 汇总一组工具聚合的调用次数. */
export function aggregateCalls(aggregates: Record<string, ToolAggregate>): number {
  let total = 0
  for (const value of Object.values(aggregates)) total += value.calls
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

/** 找到最近一个已闭合的轮次. */
export function lastCompletedTurn(state: IntrospectState): TurnRecord | null {
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const candidate = state.turns[index]
    if (candidate !== undefined && candidate.endTime !== null) return candidate
  }
  return null
}

/**
 * 判断本轮是否应当注入.
 * 只有 active, 上一轮有预估且同时超过比例与绝对下限时才返回计划.
 */
export function planInjection(state: IntrospectState, turn: number, config: Config): InjectionPlan | null {
  if (state.state !== 'active') return null
  const record = previousTurn(state, turn)
  if (record === null || record.endTime === null || record.estimateMs === null) return null
  const actualMs = record.endTime - record.startTime
  /* 崩溃恢复合成的 closer 会复用最后事件时间, 零时长轮次不参与判定. */
  if (actualMs <= 0) return null
  const overrunMs = actualMs - record.estimateMs
  const overrunRatio = overrunMs / record.estimateMs
  if (overrunMs < config.minOverrunMs || overrunRatio < config.minOverrunRatio) return null
  const toolTotalMs = aggregateTotal(record.toolMs)
  const introspectTotalMs = Math.max(0, record.reflectionMs)
  const modelTotalMs = Math.max(0, actualMs - toolTotalMs - introspectTotalMs)
  return {
    record,
    actualMs,
    estimateMs: record.estimateMs,
    overrunMs,
    overrunRatio,
    toolTotalMs,
    introspectTotalMs,
    modelTotalMs,
    wakenReason: state.wakenPending ? state.wakenReason : null,
  }
}
/** 状态查询里的最近一轮总账. */
export interface StatusLastTurn {
  turn: number
  estimate_ms: number | null
  actual_ms: number
  overrun_ms: number | null
  overrun_ratio: number | null
  time_consume_total_ms: number
}

/** 状态查询返回的结构. */
export interface StatusReport {
  state: 'active' | 'dormant'
  dormant: boolean
  reflection_open: boolean
  last_turn: StatusLastTurn | null
  totals: {
    tool_ms: number
    model_ms: number
    introspect_ms: number
  }
}

/** 从投影状态组装只读状态报告. */
export function buildStatusReport(state: IntrospectState): StatusReport {
  const current = state.turns[state.turns.length - 1]
  const completed = lastCompletedTurn(state)
  if (completed === null || completed.endTime === null) {
    return {
      state: state.state,
      dormant: state.state === 'dormant',
      reflection_open: current?.reflectionOpen === true,
      last_turn: null,
      totals: { tool_ms: 0, model_ms: 0, introspect_ms: 0 },
    }
  }
  const actualMs = Math.max(0, completed.endTime - completed.startTime)
  const toolMs = aggregateTotal(completed.toolMs)
  const introspectMs = Math.max(0, completed.reflectionMs)
  const modelMs = Math.max(0, actualMs - toolMs - introspectMs)
  const estimateMs = completed.estimateMs
  const overrunMs = estimateMs === null ? null : actualMs - estimateMs
  const overrunRatio = estimateMs === null || estimateMs <= 0 || overrunMs === null
    ? null
    : Math.round((overrunMs / estimateMs) * 10000) / 10000
  return {
    state: state.state,
    dormant: state.state === 'dormant',
    reflection_open: current?.reflectionOpen === true,
    last_turn: {
      turn: completed.turn,
      estimate_ms: estimateMs,
      actual_ms: actualMs,
      overrun_ms: overrunMs,
      overrun_ratio: overrunRatio,
      time_consume_total_ms: actualMs,
    },
    totals: { tool_ms: toolMs, model_ms: modelMs, introspect_ms: introspectMs },
  }
}
