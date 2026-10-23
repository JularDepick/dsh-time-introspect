/* 测试共用的配置, 状态与事件构造. */

import type { SessionEvent, SessionEventMap, SessionEventType, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Config } from '../src/config.js'
import type { IntrospectState, TurnRecord } from '../src/state-types.js'

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    enabled: true,
    minOverrunRatio: 0.2,
    minOverrunMs: 5000,
    maxTurnHistory: 12,
    locale: 'zh-CN',
    ...overrides,
  }
}

export function ev<T extends SessionEventType>(type: T, data: SessionEventMap[T], time: number): SessionEvent {
  return { type, data, time, seq: time as unknown as SessionSeq } as SessionEvent
}

export function turnRecord(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turn: 1,
    startTime: 0,
    endTime: 50_000,
    estimateMs: 30_000,
    toolMs: {},
    introspectionMs: 0,
    introspectionTools: {},
    introspectionOpen: false,
    introspectionStarted: false,
    introspectionStartTime: null,
    injectionDone: false,
    ...overrides,
  }
}

export function stateWith(...turns: TurnRecord[]): IntrospectState {
  return {
    turns,
    openCalls: {},
    state: 'active',
    wakenPending: false,
    wakenReason: null,
    archive: [],
    injections: [],
  }
}

export function toolCall(turn: number, callId: string, name: string, args: unknown, time: number): SessionEvent {
  return ev(
    'tool/call',
    { turn, step: 1, callId, name, arguments: JSON.stringify(args) } as unknown as SessionEventMap['tool/call'],
    time,
  )
}

/* 旧版宿主可能没有对应的事件类型, 这里用原始形状构造. */
export function rawSessionEvent(type: string, data: unknown, time: number): SessionEvent {
  return { type, data, time, seq: time as unknown as SessionSeq } as unknown as SessionEvent
}

export function ptcStart(parentCallId: string, subCallId: string, name: string, args: unknown, time: number): SessionEvent {
  return rawSessionEvent(
    'tool/ptc-dispatch-start',
    { rootCallId: parentCallId, parentCallId, subCallId, name, arguments: JSON.stringify(args) },
    time,
  )
}

export function ptcSettle(
  parentCallId: string,
  subCallId: string,
  name: string,
  args: unknown,
  time: number,
  isError = false,
): SessionEvent {
  return rawSessionEvent(
    'tool/ptc-dispatch',
    {
      rootCallId: parentCallId,
      parentCallId,
      subCallId,
      name,
      arguments: JSON.stringify(args),
      isError,
      content: [],
    },
    time,
  )
}

export function toolResult(turn: number, callId: string, time: number, isError = false): SessionEvent {
  return ev(
    'tool/result',
    {
      turn,
      step: 1,
      message: {
        role: 'tool',
        id: `msg-${callId}`,
        content: [],
        source: { kind: 'tool', callId },
        ...(isError ? { isError: true } : {}),
      },
    } as unknown as SessionEventMap['tool/result'],
    time,
  )
}