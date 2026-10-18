/* 投影折叠的单元测试. */

import { describe, expect, test } from 'vitest'
import { initialIntrospectState, introspectStateSchema, reduceIntrospect } from '../src/state.js'
import { makeConfig, ev } from './helpers.js'
import { SOURCE_KIND } from '../src/constants.js'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { IntrospectState } from '../src/state-types.js'

const config = makeConfig()

function toolCall(time: number, callId: string, name: string, args = '{}', turn = 1): SessionEvent {
  const data = { turn, step: 1, callId, name, arguments: args } as unknown as SessionEventMap['tool/call']
  return ev('tool/call', data, time)
}

function toolResult(time: number, callId: string, turn = 1): SessionEvent {
  const data = {
    turn,
    step: 1,
    message: { role: 'tool', id: callId, content: [], source: { kind: 'tool', callId } },
  } as unknown as SessionEventMap['tool/result']
  return ev('tool/result', data, time)
}

function injected(time: number, form: 'snapshot' | 'notice' = 'snapshot'): SessionEvent {
  const source =
    form === 'notice'
      ? { kind: SOURCE_KIND, form: 'notice', summary: 'dormant' }
      : { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text: 'x' }] }
  return ev('user/message', { role: 'user', id: 'm', content: [{ type: 'text', text: 'x' }], source } as unknown as SessionEventMap['user/message'], time)
}

function run(events: SessionEvent[], initial: IntrospectState = initialIntrospectState()): IntrospectState {
  return events.reduce((state, event) => reduceIntrospect(state, event, config), initial)
}

describe('投影折叠', () => {
  test('按工具名聚合耗时并配对调用开始时间', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      toolCall(1_100, 'a', 'bash'),
      toolResult(2_100, 'a'),
      toolCall(2_200, 'b', 'bash'),
      toolResult(2_700, 'b'),
      toolCall(2_800, 'c', 'read'),
      toolResult(3_300, 'c'),
    ])
    const record = state.turns[0]
    expect(record?.toolMs).toEqual({ bash: 1_500, read: 500 })
    expect(record?.toolCalls).toBe(3)
  })

  test('task_estimate 参数被记为该轮预估, 同轮以最后一次为准', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      toolCall(1_100, 'a', 'task_estimate', '{"estimateMs":30000}'),
      toolResult(1_200, 'a'),
      toolCall(1_300, 'b', 'task_estimate', '{"estimateMs":45000}'),
      toolResult(1_400, 'b'),
    ])
    expect(state.turns[0]?.estimateMs).toBe(45_000)
  })

  test('非法预估参数被忽略', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      toolCall(1_100, 'a', 'task_estimate', '{"estimateMs":0}'),
      toolResult(1_200, 'a'),
    ])
    expect(state.turns[0]?.estimateMs).toBeNull()
  })

  test('反思窗口从注入时刻到 report_reflection_cost 结束', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      injected(2_000),
      toolCall(3_000, 'r', 'report_reflection_cost', '{"summary":"ok"}'),
      toolResult(3_400, 'r'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } } as unknown as SessionEventMap['turn/end'], 5_000),
    ])
    const record = state.turns[0]
    expect(record?.reflectionMs).toBe(3_400 - 2_000)
    expect(record?.toolMs).toEqual({})
  })

  test('反思后第一个普通工具调用在开始时刻关闭窗口', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      injected(2_000),
      toolCall(2_500, 'a', 'bash'),
      toolResult(3_500, 'a'),
    ])
    const record = state.turns[0]
    expect(record?.reflectionMs).toBe(500)
    expect(record?.toolMs).toEqual({ bash: 1_000 })
  })

  test('休眠状态下反思工具的耗时进入普通工具分桶', () => {
    const dormant = { ...initialIntrospectState(), status: 'dormant' as const }
    const state = run(
      [
        ev('turn/start', { turn: 1 }, 1_000),
        toolCall(1_100, 'r', 'report_reflection_cost'),
        toolResult(1_600, 'r'),
      ],
      dormant,
    )
    expect(state.turns[0]?.reflectionMs).toBe(0)
    expect(state.turns[0]?.toolMs).toEqual({ report_reflection_cost: 500 })
  })

  test('轮次结束后按上限裁剪历史', () => {
    const events: SessionEvent[] = []
    for (let turn = 1; turn <= 5; turn += 1) {
      events.push(ev('turn/start', { turn }, turn * 1_000))
      events.push(ev('turn/end', { turn, reason: { kind: 'completed' } } as unknown as SessionEventMap['turn/end'], turn * 1_000 + 500))
    }
    const unlimited = run(events, initialIntrospectState())
    expect(unlimited.turns).toHaveLength(5)
    const limited = events.reduce((acc, event) => reduceIntrospect(acc, event, makeConfig({ maxTurnHistory: 4 })), initialIntrospectState())
    expect(limited.turns).toHaveLength(4)
    expect(limited.turns.at(-1)?.turn).toBe(5)
  })

  test('休眠通知被记为已发出', () => {
    const state = run(
      [ev('turn/start', { turn: 1 }, 1_000), injected(1_100, 'notice')],
      { ...initialIntrospectState(), status: 'dormant', noticePending: true },
    )
    expect(state.noticePending).toBe(false)
    expect(state.noticeEmitted).toBe(true)
    expect(state.turns[0]?.injectionForm).toBe('notice')
  })

  test('resume_reflection 重置自约束状态并记录原因', () => {
    const dormant = { ...initialIntrospectState(), status: 'dormant' as const, cooldownCount: 2, noticePending: true }
    const state = run(
      [
        toolCall(1_000, 'resume', 'resume_reflection', '{"reason":"步骤越来越冗杂"}'),
        toolResult(1_100, 'resume'),
      ],
      dormant,
    )
    expect(state.status).toBe('active')
    expect(state.cooldownCount).toBe(0)
    expect(state.conservativeRemaining).toBe(config.conservativeTurns)
    expect(state.restartReason).toBe('步骤越来越冗杂')
    expect(state.restartPrefixPending).toBe(true)
    expect(state.noticePending).toBe(false)
  })

  test('投影 schema 接受初始状态并拒绝未知状态', () => {
    expect(() => introspectStateSchema.parse(initialIntrospectState())).not.toThrow()
    expect(() => introspectStateSchema.parse({ ...initialIntrospectState(), status: 'paused' })).toThrow()
  })

  test('同轮重复 turn/start 重置该轮记录而不追加', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      toolCall(1_100, 'a', 'bash'),
      ev('turn/start', { turn: 1 }, 2_000),
    ])
    expect(state.turns).toHaveLength(1)
    expect(state.turns[0]?.startTime).toBe(2_000)
  })

  test('未配对的工具结果被安全忽略', () => {
    const state = run([ev('turn/start', { turn: 1 }, 1_000), toolResult(2_000, 'missing')])
    expect(state.turns[0]?.toolMs).toEqual({})
  })

  test('turn/end 关闭仍然开放的反思窗口且不计入开销', () => {
    const state = run([
      ev('turn/start', { turn: 1 }, 1_000),
      injected(2_000),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } } as unknown as SessionEventMap['turn/end'], 9_000),
    ])
    expect(state.turns[0]?.windowOpen).toBe(false)
    expect(state.turns[0]?.reflectionMs).toBe(0)
  })
})