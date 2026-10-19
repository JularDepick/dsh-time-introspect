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
    reflectionMs: 0,
    reflectionTools: {},
    reflectionOpen: false,
    reflectionStarted: false,
    reflectionStartTime: null,
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
  }
}

export function toolCall(turn: number, callId: string, name: string, args: unknown, time: number): SessionEvent {
  return ev(
    'tool/call',
    { turn, step: 1, callId, name, arguments: JSON.stringify(args) } as unknown as SessionEventMap['tool/call'],
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