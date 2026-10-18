/* 测试共用的配置与事件构造. */

import type { SessionEvent, SessionEventMap, SessionEventType, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Config } from '../src/config.js'
import type { IntrospectState, TurnRecord } from '../src/state-types.js'

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    enabled: true,
    minOverrunRatio: 0.2,
    minOverrunMs: 5000,
    coolRatio: 0.15,
    coolRatioAfterResume: 0.1,
    conservativeTurns: 2,
    coolAfterHighTurns: 2,
    minImprovementRatio: 0.1,
    baselineTurns: 3,
    coolTurns: 3,
    dormancyAfterCooldowns: 2,
    topTools: 5,
    maxTurnHistory: 12,
    locale: 'zh-CN',
    reflectionTools: [],
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
    toolCalls: 0,
    reflectionMs: 0,
    injectionTime: null,
    injectionForm: null,
    windowOpen: false,
    ...overrides,
  }
}

export function stateWith(...turns: TurnRecord[]): IntrospectState {
  return {
    turns,
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
