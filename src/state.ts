/* 会话投影: 从持久事件折叠出逐会话耗时记账与插件状态. */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Config } from './config.js'
import {
  ESTIMATE_ARGUMENT_KEY,
  ESTIMATE_TOOL,
  MAX_ARCHIVE_TURNS,
  MAX_ESTIMATE_MS,
  MAX_REASON_CHARS,
  PROJECTION_KEY,
  PROJECTION_STATE_VERSION,
  SHUT_TOOL,
  SOURCE_KIND,
  START_TOOL,
  STOP_TOOL,
  WAKEN_TOOL,
} from './constants.js'
import type { IntrospectState, OpenCall, ToolAggregate, TurnRecord } from './state-types.js'
import type { InjectionRecord } from './report-types.js'
import { buildArchiveEntry } from './render.js'
import './types.js'

const aggregateSchema = z.object({
  ms: z.number(),
  calls: z.number().int(),
})

const turnSchema = z.object({
  turn: z.number().int(),
  startTime: z.number(),
  endTime: z.number().nullable(),
  estimateMs: z.number().int().nullable(),
  toolMs: z.record(z.string(), aggregateSchema),
  introspectionMs: z.number(),
  introspectionTools: z.record(z.string(), aggregateSchema),
  introspectionOpen: z.boolean(),
  introspectionStarted: z.boolean(),
  introspectionStartTime: z.number().nullable(),
  injectionDone: z.boolean(),
})

const injectionSchema = z.object({
  turn: z.number().int(),
  time: z.number(),
  aboutTurn: z.number().int(),
  estimate_ms: z.number().int().nullable(),
  actual_ms: z.number(),
  overrun_ms: z.number().int().nullable(),
  overrun_ratio: z.number().nullable(),
  started: z.boolean(),
  completed: z.boolean(),
  introspection_ms: z.number(),
  outcome: z.enum(['pending', 'open', 'completed', 'incomplete', 'not_started', 'aborted']),
})

const openCallSchema = z.object({
  name: z.string(),
  time: z.number(),
  arguments: z.string(),
  inIntrospection: z.boolean(),
})

/** 投影状态的持久化 schema. */
export const introspectStateSchema = z.object({
  turns: z.array(turnSchema),
  openCalls: z.record(z.string(), openCallSchema),
  state: z.enum(['active', 'dormant']),
  wakenPending: z.boolean(),
  wakenReason: z.string().nullable(),
  archive: z.array(z.any()),
  injections: z.array(injectionSchema),
})

/** 空日志对应的初始状态. */
export function initialIntrospectState(): IntrospectState {
  return {
    turns: [],
    openCalls: {},
    state: 'active',
    wakenPending: false,
    wakenReason: null,
    archive: [],
    injections: [],
  }
}

/** 注册耗时反思投影; 返回的 disposer 随插件卸载自动回收. */
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
      return onToolCall(state, event.data, event.time)
    case 'tool/result':
      return onToolResult(state, event.data, event.time)
    default:
      return state
  }
}

function onTurnStart(state: IntrospectState, turn: number, time: number): IntrospectState {
  const index = findTurnIndex(state.turns, turn)
  const record = newTurnRecord(turn, time)
  const turns = index >= 0
    ? state.turns.map((candidate, position) => (position === index ? record : candidate))
    : [...state.turns, record]
  return { ...state, turns, openCalls: {} }
}

function onTurnEnd(state: IntrospectState, turn: number, time: number, config: Config): IntrospectState {
  const index = findTurnIndex(state.turns, turn)
  const previous = state.turns[index]
  if (index < 0 || previous === undefined) return state
  /* 严格配对: 轮次结束时仍未 stop 的窗口丢弃, 窗口内工具回到普通工具分桶. */
  const settled = previous.introspectionOpen ? foldIntrospectionTools(previous) : previous
  const record: TurnRecord = { ...settled, endTime: time, introspectionOpen: false, introspectionStartTime: null }
  const turns = state.turns.map((candidate, position) => (position === index ? record : candidate))
  const archive = [...state.archive, buildArchiveEntry(record, config, state.wakenPending ? state.wakenReason : null)]
    .slice(-MAX_ARCHIVE_TURNS)
  return {
    ...state,
    turns: turns.slice(-config.maxTurnHistory),
    archive,
    injections: finalizeInjections(state.injections, turn).slice(-MAX_ARCHIVE_TURNS),
    openCalls: {},
  }
}

function onUserMessage(
  state: IntrospectState,
  source: { readonly kind: string },
  time: number,
): IntrospectState {
  if (source.kind !== SOURCE_KIND) return state
  const index = findCurrentTurnIndex(state.turns)
  const current = state.turns[index]
  const turns = current === undefined
    ? state.turns
    : state.turns.map((candidate, position) => (position === index ? { ...candidate, injectionDone: true } : candidate))
  let injections = state.injections
  if (current !== undefined && !state.injections.some((record) => record.turn === current.turn)) {
    const previous = previousCompletedTurn(state.turns, current.turn)
    const actual = previous === null || previous.endTime === null ? 0 : Math.max(0, previous.endTime - previous.startTime)
    const estimate = previous?.estimateMs ?? null
    const overrun = estimate === null ? null : actual - estimate
    const ratio = estimate === null || estimate <= 0 || overrun === null ? null : overrun / estimate
    const record: InjectionRecord = {
      turn: current.turn,
      time,
      aboutTurn: previous?.turn ?? current.turn - 1,
      estimate_ms: estimate,
      actual_ms: actual,
      overrun_ms: overrun,
      overrun_ratio: ratio,
      started: false,
      completed: false,
      introspection_ms: 0,
      outcome: 'pending',
    }
    injections = [...state.injections, record].slice(-MAX_ARCHIVE_TURNS)
  }
  return { ...state, turns, injections, wakenPending: false, wakenReason: null }
}

function onToolCall(
  state: IntrospectState,
  data: { turn: number; callId: string; name: string; arguments: string },
  time: number,
): IntrospectState {
  const index = findTurnIndex(state.turns, data.turn)
  const record = state.turns[index]
  const inIntrospection = record !== undefined && record.introspectionOpen
  const call: OpenCall = {
    name: data.name,
    time,
    arguments: data.arguments,
    inIntrospection,
  }
  return { ...state, openCalls: { ...state.openCalls, [data.callId]: call } }
}

function onToolResult(
  state: IntrospectState,
  data: { turn: number; message: { isError?: boolean; source: { callId: string } }; error?: unknown },
  time: number,
): IntrospectState {
  const callId = data.message.source.callId
  const call = state.openCalls[callId]
  if (call === undefined) return state
  const index = findTurnIndex(state.turns, data.turn)
  const previous = state.turns[index]
  if (index < 0 || previous === undefined) {
    const openCalls = { ...state.openCalls }
    delete openCalls[callId]
    return { ...state, openCalls }
  }
  const success = data.message.isError !== true && data.error === undefined
  const duration = Math.max(0, time - call.time)
  const record = addToolUse(previous, call, duration)
  const next = success ? applyToolSuccess(state, record, index, call, time) : { ...state, turns: replaceAt(state.turns, index, record) }
  const openCalls = { ...next.openCalls }
  delete openCalls[callId]
  return { ...next, openCalls }
}

/** 把一次工具调用的耗时放入对应分桶. start/stop 永远属于普通工具. */
function addToolUse(record: TurnRecord, call: OpenCall, duration: number): TurnRecord {
  const introspection = call.inIntrospection && call.name !== START_TOOL && call.name !== STOP_TOOL
  if (introspection) {
    return { ...record, introspectionTools: addAggregate(record.introspectionTools, call.name, duration) }
  }
  return { ...record, toolMs: addAggregate(record.toolMs, call.name, duration) }
}

function applyToolSuccess(
  state: IntrospectState,
  record: TurnRecord,
  index: number,
  call: OpenCall,
  time: number,
): IntrospectState {
  switch (call.name) {
    case ESTIMATE_TOOL: {
      const estimateMs = parseEstimate(call.arguments)
      if (estimateMs === null) return { ...state, turns: replaceAt(state.turns, index, record) }
      return { ...state, turns: replaceAt(state.turns, index, { ...record, estimateMs }) }
    }
    case START_TOOL: {
      if (state.state !== 'active' || !record.injectionDone || record.introspectionOpen || record.introspectionStarted) {
        return { ...state, turns: replaceAt(state.turns, index, record) }
      }
      const started: TurnRecord = {
        ...record,
        introspectionOpen: true,
        introspectionStarted: true,
        introspectionStartTime: time,
        introspectionMs: 0,
        introspectionTools: {},
      }
      return {
        ...state,
        turns: replaceAt(state.turns, index, started),
        injections: updateInjection(state.injections, record.turn, { started: true, outcome: 'open' }),
      }
    }
    case STOP_TOOL: {
      if (!record.introspectionOpen) return { ...state, turns: replaceAt(state.turns, index, record) }
      const startTime = record.introspectionStartTime ?? call.time
      const introspectionMs = Math.max(0, call.time - startTime)
      const stopped: TurnRecord = { ...record, introspectionMs, introspectionOpen: false, introspectionStartTime: null }
      return {
        ...state,
        turns: replaceAt(state.turns, index, stopped),
        injections: updateInjection(state.injections, record.turn, {
          completed: true,
          introspection_ms: introspectionMs,
          outcome: 'completed',
        }),
      }
    }
    case SHUT_TOOL: {
      const settled = record.introspectionOpen ? foldIntrospectionTools(record) : record
      return {
        ...state,
        turns: replaceAt(state.turns, index, settled),
        state: 'dormant',
        wakenPending: false,
        wakenReason: null,
        injections: settleInjectionOnShut(state.injections, record.turn),
      }
    }
    case WAKEN_TOOL: {
      const turns = replaceAt(state.turns, index, record)
      if (state.state !== 'dormant') return { ...state, turns }
      return {
        ...state,
        turns,
        state: 'active',
        wakenPending: true,
        wakenReason: parseReason(call.arguments),
      }
    }
    default:
      return { ...state, turns: replaceAt(state.turns, index, record) }
  }
}

function updateInjection(
  injections: InjectionRecord[],
  turn: number,
  update: Partial<InjectionRecord>,
): InjectionRecord[] {
  return injections.map((record) => (record.turn === turn ? { ...record, ...update } : record))
}

function finalizeInjections(injections: InjectionRecord[], turn: number): InjectionRecord[] {
  return injections.map((record) => {
    if (record.turn !== turn || record.outcome === 'completed' || record.outcome === 'aborted') return record
    if (!record.started) return { ...record, outcome: 'not_started' }
    if (!record.completed) return { ...record, outcome: 'incomplete' }
    return record
  })
}

function settleInjectionOnShut(injections: InjectionRecord[], turn: number): InjectionRecord[] {
  return injections.map((record) => {
    if (record.turn !== turn || record.outcome === 'completed') return record
    if (record.started && !record.completed) return { ...record, outcome: 'aborted' }
    return { ...record, outcome: 'not_started' }
  })
}

function previousCompletedTurn(turns: readonly TurnRecord[], turn: number): TurnRecord | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const candidate = turns[index]
    if (candidate !== undefined && candidate.turn < turn && candidate.endTime !== null) return candidate
  }
  return null
}

function foldIntrospectionTools(record: TurnRecord): TurnRecord {
  const toolMs = { ...record.toolMs }
  for (const [name, aggregate] of Object.entries(record.introspectionTools)) {
    const previous = toolMs[name] ?? { ms: 0, calls: 0 }
    toolMs[name] = { ms: previous.ms + aggregate.ms, calls: previous.calls + aggregate.calls }
  }
  return {
    ...record,
    toolMs,
    introspectionMs: 0,
    introspectionTools: {},
    introspectionOpen: false,
    introspectionStartTime: null,
  }
}

function addAggregate(
  aggregates: Record<string, ToolAggregate>,
  name: string,
  ms: number,
): Record<string, ToolAggregate> {
  const previous = aggregates[name] ?? { ms: 0, calls: 0 }
  return { ...aggregates, [name]: { ms: previous.ms + ms, calls: previous.calls + 1 } }
}

function replaceAt(turns: TurnRecord[], index: number, record: TurnRecord): TurnRecord[] {
  return turns.map((candidate, position) => (position === index ? record : candidate))
}

function findTurnIndex(turns: readonly TurnRecord[], turn: number): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.turn === turn) return index
  }
  return -1
}

function findCurrentTurnIndex(turns: readonly TurnRecord[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.endTime === null) return index
  }
  return turns.length - 1
}

function newTurnRecord(turn: number, time: number): TurnRecord {
  return {
    turn,
    startTime: time,
    endTime: null,
    estimateMs: null,
    toolMs: {},
    introspectionMs: 0,
    introspectionTools: {},
    introspectionOpen: false,
    introspectionStarted: false,
    introspectionStartTime: null,
    injectionDone: false,
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
    return typeof value === 'string' ? value.trim().slice(0, MAX_REASON_CHARS) : ''
  } catch {
    return ''
  }
}