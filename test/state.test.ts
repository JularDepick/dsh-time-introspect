/* 投影折叠测试. */

import { describe, expect, test } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { SHUT_TOOL, SOURCE_KIND, START_TOOL, STOP_TOOL, WAKEN_TOOL, ESTIMATE_TOOL } from '../src/constants.js'
import { initialIntrospectState, reduceIntrospect } from '../src/state.js'
import type { IntrospectState } from '../src/state-types.js'
import { ev, makeConfig, toolCall, toolResult } from './helpers.js'

function injection(time: number): SessionEvent {
  return ev(
    'user/message',
    {
      role: 'user',
      id: 'u',
      content: [],
      source: { kind: SOURCE_KIND, form: 'snapshot', sections: [] },
    } as unknown as SessionEventMap['user/message'],
    time,
  )
}

function start(time: number): SessionEvent {
  return ev('turn/start', { turn: 1 } as unknown as SessionEventMap['turn/start'], time)
}

function end(turn: number, time: number): SessionEvent {
  return ev('turn/end', { turn } as unknown as SessionEventMap['turn/end'], time)
}

function apply(events: SessionEvent[], config = makeConfig()): IntrospectState {
  let state = initialIntrospectState()
  for (const event of events) state = reduceIntrospect(state, event, config)
  return state
}

describe('基础折叠', () => {
  test('登记预估并聚合工具耗时', () => {
    const state = apply([
      start(1_000),
      toolCall(1, 'e', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_100),
      toolResult(1, 'e', 1_200),
      toolCall(1, 'b', 'bash', {}, 1_300),
      toolResult(1, 'b', 31_300),
      end(1, 52_000),
    ])
    expect(state.turns[0]?.estimateMs).toBe(30_000)
    expect(state.turns[0]?.toolMs.bash).toEqual({ ms: 30_000, calls: 1 })
    expect(state.turns[0]?.endTime).toBe(52_000)
  })

  test('同一轮多次预估以最后一次为准', () => {
    const state = apply([
      start(1_000),
      toolCall(1, 'e1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_100),
      toolResult(1, 'e1', 1_150),
      toolCall(1, 'e2', ESTIMATE_TOOL, { estimateMs: 20_000 }, 1_200),
      toolResult(1, 'e2', 1_250),
    ])
    expect(state.turns[0]?.estimateMs).toBe(20_000)
  })

  test('失败的预估结果不写账', () => {
    const state = apply([
      start(1_000),
      toolCall(1, 'e', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_100),
      toolResult(1, 'e', 1_150, true),
    ])
    expect(state.turns[0]?.estimateMs).toBeNull()
  })
})

describe('反思窗口', () => {
  test('start 结果到 stop 调用之间计为反思, 窗口内工具进入反思明细', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 's', START_TOOL, {}, 200),
      toolResult(1, 's', 250),
      toolCall(1, 'r', 'read', {}, 300),
      toolResult(1, 'r', 1_300),
      toolCall(1, 'p', STOP_TOOL, {}, 2_000),
      toolResult(1, 'p', 2_100),
      end(1, 5_000),
    ])
    const record = state.turns[0]
    expect(record?.reflectionMs).toBe(1_750)
    expect(record?.reflectionTools.read).toEqual({ ms: 1_000, calls: 1 })
    expect(record?.toolMs[START_TOOL]).toEqual({ ms: 50, calls: 1 })
    expect(record?.toolMs[STOP_TOOL]).toEqual({ ms: 100, calls: 1 })
    expect(record?.reflectionOpen).toBe(false)
  })

  test('没有注入时 start 成功也不开窗', () => {
    const state = apply([
      start(0),
      toolCall(1, 's', START_TOOL, {}, 200),
      toolResult(1, 's', 250),
    ])
    expect(state.turns[0]?.reflectionOpen).toBe(false)
  })

  test('同一轮 stop 后不能再次开始', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 's1', START_TOOL, {}, 200),
      toolResult(1, 's1', 250),
      toolCall(1, 'p1', STOP_TOOL, {}, 600),
      toolResult(1, 'p1', 650),
      toolCall(1, 's2', START_TOOL, {}, 700),
      toolResult(1, 's2', 750),
    ])
    const record = state.turns[0]
    expect(record?.reflectionStarted).toBe(true)
    expect(record?.reflectionOpen).toBe(false)
    expect(record?.reflectionMs).toBe(350)
  })

  test('没有开始就 stop 不产生窗口', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 'p', STOP_TOOL, {}, 2_000),
      toolResult(1, 'p', 2_100),
    ])
    expect(state.turns[0]?.reflectionOpen).toBe(false)
    expect(state.turns[0]?.reflectionMs).toBe(0)
  })

  test('轮次结束仍未 stop 的窗口丢弃, 工具回到普通分桶', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 's', START_TOOL, {}, 200),
      toolResult(1, 's', 250),
      toolCall(1, 'r', 'read', {}, 300),
      toolResult(1, 'r', 1_300),
      end(1, 5_000),
    ])
    const record = state.turns[0]
    expect(record?.reflectionMs).toBe(0)
    expect(record?.reflectionTools).toEqual({})
    expect(record?.toolMs.read).toEqual({ ms: 1_000, calls: 1 })
    expect(record?.reflectionOpen).toBe(false)
  })
})

describe('休眠与重启', () => {
  test('休眠折叠未闭合窗口并清空待展示原因', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 's', START_TOOL, {}, 200),
      toolResult(1, 's', 250),
      toolCall(1, 'r', 'read', {}, 300),
      toolResult(1, 'r', 1_300),
      toolCall(1, 'h', SHUT_TOOL, { reason: '够了' }, 2_000),
      toolResult(1, 'h', 2_010),
    ])
    const record = state.turns[0]
    expect(state.state).toBe('dormant')
    expect(record?.reflectionOpen).toBe(false)
    expect(record?.reflectionMs).toBe(0)
    expect(record?.toolMs.read).toEqual({ ms: 1_000, calls: 1 })
    expect(state.wakenPending).toBe(false)
  })

  test('重启记录原因, 注入后清空', () => {
    const state = apply([
      start(0),
      toolCall(1, 'h', SHUT_TOOL, { reason: '够了' }, 100),
      toolResult(1, 'h', 110),
      toolCall(1, 'w', WAKEN_TOOL, { reason: '继续' }, 200),
      toolResult(1, 'w', 210),
    ])
    expect(state.state).toBe('active')
    expect(state.wakenPending).toBe(true)
    expect(state.wakenReason).toBe('继续')
    const afterInjection = reduceIntrospect(state, injection(300), makeConfig())
    expect(afterInjection.wakenPending).toBe(false)
    expect(afterInjection.wakenReason).toBeNull()
  })

  test('已活动时重启不写待展示原因', () => {
    const state = apply([
      start(0),
      toolCall(1, 'w', WAKEN_TOOL, { reason: '继续' }, 200),
      toolResult(1, 'w', 210),
    ])
    expect(state.state).toBe('active')
    expect(state.wakenPending).toBe(false)
  })
})

describe('历史截断', () => {
  test('超过 maxTurnHistory 时丢弃最旧轮次', () => {
    const events: SessionEvent[] = []
    for (let turn = 1; turn <= 3; turn += 1) {
      events.push(ev('turn/start', { turn } as unknown as SessionEventMap['turn/start'], turn * 10_000))
      events.push(end(turn, turn * 10_000 + 5_000))
    }
    const state = apply(events, makeConfig({ maxTurnHistory: 2 }))
    expect(state.turns.map((turn) => turn.turn)).toEqual([2, 3])
  })
})