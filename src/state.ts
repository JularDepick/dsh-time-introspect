/* 会话投影: 从持久事件折叠出逐会话耗时记账与反思状态. */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Config } from './config.js'
import {
  ESTIMATE_ARGUMENT_KEY,
  ESTIMATE_TOOL,
  MAX_ESTIMATE_MS,
  PROJECTION_KEY,
  PROJECTION_STATE_VERSION,
  REFLECTION_COST_TOOL,
  RESUME_TOOL,
  SOURCE_KIND,
} from './constants.js'
import { settleTurn } from './policy.js'
import type { IntrospectState, TurnRecord } from './state-types.js'
import './types.js'

/** 单轮记录的持久化 schema; 状态必须是纯 JSON. */
const turnSchema = z.object({
  turn: z.number().int(),
  startTime: z.number(),
  endTime: z.number().nullable(),
  estimateMs: z.number().int().nullable(),
  toolMs: z.record(z.string(), z.number()),
  toolCalls: z.number().int(),
  reflectionMs: z.number(),
  injectionTime: z.number().nullable(),
  injectionForm: z.enum(['reflection', 'notice']).nullable(),
  windowOpen: z.boolean(),
})

/** 投影状态的持久化 schema. */
export const introspectStateSchema = z.object({
  turns: z.array(turnSchema),
  openCalls: z.record(z.string(), z.object({ name: z.string(), time: z.number() })),
  status: z.enum(['active', 'cooling', 'dormant']),
  coolingRemaining: z.number().int(),
  cooldownCount: z.number().int(),
  highStreak: z.number().int(),
  conservativeRemaining: z.number().int(),
  noticePending: z.boolean(),
  noticeEmitted: z.boolean(),
  restartReason: z.string().nullable(),
  restartPrefixPending: z.boolean(),
  everInjected: z.boolean(),
})

/** 空日志对应的初始状态. */
export function initialIntrospectState(): IntrospectState {
  return {
    turns: [],
    openCalls: {},
    status: 'active',
    coolingRemaining: 0,
    cooldownCount: 0,
    highStreak: 0,
    conservativeRemaining: 0,
    noticePending: false,
    noticeEmitted: false,
    restartReason: null,
    restartPrefixPending: false,
    everInjected: false,
  }
}

/**
 * 注册耗时反思投影; 返回的 disposer 随插件卸载自动回收.
 * 投影状态完全由会话日志重建, 因此进程重启后无需额外持久化.
 */
export function createIntrospectProjection(config: Config): ProjectionDefinition<'timeIntrospect', IntrospectState> {
  return {
    key: PROJECTION_KEY,
    stateSchema: introspectStateSchema,
    stateVersion: PROJECTION_STATE_VERSION,
    init: () => initialIntrospectState(),
    apply: (state, event) => reduceIntrospect(state, event, config),
  }
}

/** 纯折叠函数: 前序状态 + 一个已提交事件 -> 后继状态. */
export function reduceIntrospect(state: IntrospectState, event: SessionEvent, config: Config): IntrospectState {
  switch (event.type) {
    case 'turn/start':
      return onTurnStart(state, event.data.turn, event.time)
    case 'turn/end':
      return onTurnEnd(state, event.data.turn, event.time, config)
    case 'user/message':
      return onUserMessage(state, event.data.source, event.time)
    case 'tool/call':
      return onToolCall(state, event.data, event.time, config)
    case 'tool/result':
      return onToolResult(state, event.data, event.time, config)
    default:
      return state
  }
}

function onTurnStart(state: IntrospectState, turn: number, time: number): IntrospectState {
  const index = findTurnIndex(state.turns, turn)
  if (index >= 0) {
    return replaceTurn(state, index, newTurnRecord(turn, time))
  }
  return { ...state, turns: [...state.turns, newTurnRecord(turn, time)] }
}

function onTurnEnd(state: IntrospectState, turn: number, time: number, config: Config): IntrospectState {
  const index = findTurnIndex(state.turns, turn)
  const previous = state.turns[index]
  if (index < 0 || previous === undefined) return state
  /* 未闭合的反思窗口在轮次结束时放弃, 不把整轮模型时间记成反思开销. */
  const record: TurnRecord = { ...previous, endTime: time, windowOpen: false }
  const withRecord = replaceTurn(state, index, record)
  const settled = settleTurn(withRecord, record, config)
  return {
    ...settled,
    turns: settled.turns.slice(-config.maxTurnHistory),
    openCalls: {},
  }
}

function onUserMessage(
  state: IntrospectState,
  source: { readonly kind: string; readonly form?: string },
  time: number,
): IntrospectState {
  if (source.kind !== SOURCE_KIND) return state
  const index = state.turns.length - 1
  const previous = state.turns[index]
  if (previous === undefined) return state
  if (source.form === 'notice') {
    return {
      ...state,
      turns: state.turns.map((candidate, position) =>
        position === index
          ? { ...candidate, injectionTime: time, injectionForm: 'notice', windowOpen: false }
          : candidate,
      ),
      noticePending: false,
      noticeEmitted: true,
    }
  }
  return {
    ...state,
    turns: state.turns.map((candidate, position) =>
      position === index
        ? { ...candidate, injectionTime: time, injectionForm: 'reflection', windowOpen: true }
        : candidate,
    ),
    everInjected: true,
    restartPrefixPending: false,
  }
}

function onToolCall(
  state: IntrospectState,
  data: { turn: number; callId: string; name: string; arguments: string },
  time: number,
  config: Config,
): IntrospectState {
  const openCalls = { ...state.openCalls, [data.callId]: { name: data.name, time } }
  let next = state
  const index = findTurnIndex(state.turns, data.turn)
  if (index >= 0 && data.name === ESTIMATE_TOOL) {
    const estimateMs = parseEstimate(data.arguments)
    const record = state.turns[index]
    if (estimateMs !== null && record !== undefined) {
      next = replaceTurn(next, index, { ...record, estimateMs })
    }
  }
  if (data.name === RESUME_TOOL) {
    next = {
      ...next,
      status: 'active',
      coolingRemaining: 0,
      cooldownCount: 0,
      highStreak: 0,
      conservativeRemaining: config.conservativeTurns,
      restartReason: parseReason(data.arguments),
      restartPrefixPending: true,
      noticePending: false,
    }
  }
  const recordIndex = findTurnIndex(next.turns, data.turn)
  const record = next.turns[recordIndex]
  if (record !== undefined && record.windowOpen && !isReflectionTool(data.name, config)) {
    const reflectionMs = record.reflectionMs + Math.max(0, time - (record.injectionTime ?? time))
    next = replaceTurn(next, recordIndex, { ...record, reflectionMs, windowOpen: false })
  }
  return { ...next, openCalls }
}

function onToolResult(
  state: IntrospectState,
  data: { turn: number; message: { source: { callId: string } } },
  time: number,
  config: Config,
): IntrospectState {
  const callId = data.message.source.callId
  const call = state.openCalls[callId]
  if (call === undefined) return state
  const openCalls = { ...state.openCalls }
  delete openCalls[callId]
  const next = reduceToolResult(state, data.turn, call.name, call.time, time, config)
  return { ...next, openCalls }
}

function reduceToolResult(
  state: IntrospectState,
  turn: number,
  name: string,
  startTime: number,
  endTime: number,
  config: Config,
): IntrospectState {
  const index = findTurnIndex(state.turns, turn)
  const record = state.turns[index]
  if (index < 0 || record === undefined) return state
  if (isReflectionTool(name, config) && state.status !== 'dormant') {
    if (record.windowOpen && record.injectionTime !== null) {
      const reflectionMs = record.reflectionMs + Math.max(0, endTime - record.injectionTime)
      return replaceTurn(state, index, { ...record, reflectionMs, windowOpen: false })
    }
    const reflectionMs = record.reflectionMs + Math.max(0, endTime - startTime)
    return replaceTurn(state, index, { ...record, reflectionMs })
  }
  const toolMs = { ...record.toolMs }
  toolMs[name] = (toolMs[name] ?? 0) + Math.max(0, endTime - startTime)
  return replaceTurn(state, index, { ...record, toolMs, toolCalls: record.toolCalls + 1 })
}

function replaceTurn(state: IntrospectState, index: number, record: TurnRecord): IntrospectState {
  return { ...state, turns: state.turns.map((candidate, position) => (position === index ? record : candidate)) }
}

function findTurnIndex(turns: readonly TurnRecord[], turn: number): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.turn === turn) return index
  }
  return -1
}

function newTurnRecord(turn: number, time: number): TurnRecord {
  return {
    turn,
    startTime: time,
    endTime: null,
    estimateMs: null,
    toolMs: {},
    toolCalls: 0,
    reflectionMs: 0,
    injectionTime: null,
    injectionForm: null,
    windowOpen: false,
  }
}

function parseEstimate(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = (parsed as Record<string, unknown>)[ESTIMATE_ARGUMENT_KEY]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_ESTIMATE_MS) {
      return null
    }
    return value
  } catch {
    return null
  }
}

function parseReason(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const value = (parsed as Record<string, unknown>).reason
    return typeof value === 'string' ? value.trim().slice(0, 500) : ''
  } catch {
    return ''
  }
}

function isReflectionTool(name: string, config: Config): boolean {
  return name === REFLECTION_COST_TOOL || config.reflectionTools.includes(name)
}
