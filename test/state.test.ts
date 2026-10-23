/* 投影折叠测试. */

import { describe, expect, test } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { SHUT_TOOL, SOURCE_KIND, START_TOOL, STOP_TOOL, WAKEN_TOOL, ESTIMATE_TOOL } from '../src/constants.js'
import { planInjection } from '../src/policy.js'
import { initialIntrospectState, reduceIntrospect } from '../src/state.js'
import type { IntrospectState } from '../src/state-types.js'
import { ev, makeConfig, ptcSettle, ptcStart, rawSessionEvent, toolCall, toolResult } from './helpers.js'

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
    expect(record?.introspectionMs).toBe(1_750)
    expect(record?.introspectionTools.read).toEqual({ ms: 1_000, calls: 1 })
    expect(record?.toolMs[START_TOOL]).toEqual({ ms: 50, calls: 1 })
    expect(record?.toolMs[STOP_TOOL]).toEqual({ ms: 100, calls: 1 })
    expect(record?.introspectionOpen).toBe(false)
  })

  test('没有注入时 start 成功也不开窗', () => {
    const state = apply([
      start(0),
      toolCall(1, 's', START_TOOL, {}, 200),
      toolResult(1, 's', 250),
    ])
    expect(state.turns[0]?.introspectionOpen).toBe(false)
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
    expect(record?.introspectionStarted).toBe(true)
    expect(record?.introspectionOpen).toBe(false)
    expect(record?.introspectionMs).toBe(350)
  })

  test('没有开始就 stop 不产生窗口', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 'p', STOP_TOOL, {}, 2_000),
      toolResult(1, 'p', 2_100),
    ])
    expect(state.turns[0]?.introspectionOpen).toBe(false)
    expect(state.turns[0]?.introspectionMs).toBe(0)
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
    expect(record?.introspectionMs).toBe(0)
    expect(record?.introspectionTools).toEqual({})
    expect(record?.toolMs.read).toEqual({ ms: 1_000, calls: 1 })
    expect(record?.introspectionOpen).toBe(false)
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
    expect(record?.introspectionOpen).toBe(false)
    expect(record?.introspectionMs).toBe(0)
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

describe('归档与注入记录', () => {
  test('每轮归档, 无预估字段为 null', () => {
    const withEstimate = apply([
      start(1_000),
      toolCall(1, 'e', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_100),
      toolResult(1, 'e', 1_200),
      toolCall(1, 'b', 'bash', {}, 1_300),
      toolResult(1, 'b', 31_300),
      end(1, 52_000),
    ])
    expect(withEstimate.archive).toHaveLength(1)
    const first = withEstimate.archive[0]
    expect(first?.type).toBe('time_introspect')
    expect(first?.estimate_ms).toBe(30_000)
    expect(first?.overrun_ms).toBe(21_000)
    expect(first?.time_consume_total_ms).toBe(51_000)

    const withoutEstimate = apply([
      start(1_000),
      toolCall(1, 'b', 'bash', {}, 1_300),
      toolResult(1, 'b', 31_300),
      end(1, 52_000),
    ])
    const second = withoutEstimate.archive[0]
    expect(second?.estimate_ms).toBeNull()
    expect(second?.overrun_ms).toBeNull()
    expect(second?.overrun_ratio).toBeNull()
  })

  test('注入记录在 start/stop 后标记为已完成', () => {
    const state = apply([
      start(1_000),
      end(1, 52_000),
      ev('turn/start', { turn: 2 } as unknown as SessionEventMap['turn/start'], 53_000),
      injection(53_100),
      toolCall(2, 's', START_TOOL, {}, 53_200),
      toolResult(2, 's', 53_250),
      toolCall(2, 'p', STOP_TOOL, {}, 54_000),
      toolResult(2, 'p', 54_050),
      end(2, 55_000),
    ])
    const record = state.injections[0]
    expect(record?.turn).toBe(2)
    expect(record?.aboutTurn).toBe(1)
    expect(record?.started).toBe(true)
    expect(record?.completed).toBe(true)
    expect(record?.outcome).toBe('completed')
    expect(record?.introspection_ms).toBe(750)
  })

  test('未开始, 未结束与休眠中断分别记录', () => {
    const notStarted = apply([
      ev('turn/start', { turn: 1 } as unknown as SessionEventMap['turn/start'], 1_000),
      end(1, 52_000),
      ev('turn/start', { turn: 2 } as unknown as SessionEventMap['turn/start'], 53_000),
      injection(53_100),
      end(2, 55_000),
    ])
    expect(notStarted.injections[0]?.outcome).toBe('not_started')

    const incomplete = apply([
      ev('turn/start', { turn: 1 } as unknown as SessionEventMap['turn/start'], 1_000),
      end(1, 52_000),
      ev('turn/start', { turn: 2 } as unknown as SessionEventMap['turn/start'], 53_000),
      injection(53_100),
      toolCall(2, 's', START_TOOL, {}, 53_200),
      toolResult(2, 's', 53_250),
      end(2, 55_000),
    ])
    expect(incomplete.injections[0]?.outcome).toBe('incomplete')

    const aborted = apply([
      ev('turn/start', { turn: 1 } as unknown as SessionEventMap['turn/start'], 1_000),
      end(1, 52_000),
      ev('turn/start', { turn: 2 } as unknown as SessionEventMap['turn/start'], 53_000),
      injection(53_100),
      toolCall(2, 's', START_TOOL, {}, 53_200),
      toolResult(2, 's', 53_250),
      toolCall(2, 'h', SHUT_TOOL, { reason: '够了' }, 54_000),
      toolResult(2, 'h', 54_010),
    ])
    expect(aborted.injections[0]?.outcome).toBe('aborted')
  })
})


describe('PTC 子调用', () => {
  test('子调用预估写入当前轮并参与下一轮注入判定', () => {
    const config = makeConfig()
    const state = apply([
      start(1_000),
      toolCall(1, 'rc', 'run_code', {}, 1_100),
      ptcStart('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_200),
      ptcSettle('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 1_210),
      toolResult(1, 'rc', 40_000),
      end(1, 51_500),
    ])
    expect(state.turns[0]?.estimateMs).toBe(30_000)
    const plan = planInjection(state, 2, config)
    expect(plan?.estimateMs).toBe(30_000)
    expect(plan?.actualMs).toBe(50_500)
  })

  test('父调用扣除子调用耗时, 总账不重复计数', () => {
    const state = apply([
      start(0),
      toolCall(1, 'rc', 'run_code', {}, 100),
      ptcStart('rc', 'rc:ptc:1', 'bash', {}, 200),
      ptcSettle('rc', 'rc:ptc:1', 'bash', {}, 900),
      ptcStart('rc', 'rc:ptc:2', 'read', {}, 1_000),
      ptcSettle('rc', 'rc:ptc:2', 'read', {}, 1_200),
      toolResult(1, 'rc', 1_500),
    ])
    const record = state.turns[0]
    expect(record?.toolMs.bash).toEqual({ ms: 700, calls: 1 })
    expect(record?.toolMs.read).toEqual({ ms: 200, calls: 1 })
    expect(record?.toolMs.run_code).toEqual({ ms: 500, calls: 1 })
  })

  test('子调用休眠与重启迁移状态', () => {
    const sleeping = apply([
      start(0),
      toolCall(1, 'rc', 'run_code', {}, 100),
      ptcStart('rc', 'rc:ptc:1', SHUT_TOOL, { reason: '够了' }, 200),
      ptcSettle('rc', 'rc:ptc:1', SHUT_TOOL, { reason: '够了' }, 210),
      toolResult(1, 'rc', 300),
    ])
    expect(sleeping.state).toBe('dormant')
    expect(sleeping.wakenPending).toBe(false)

    const wakened = apply([
      start(0),
      toolCall(1, 'rc', 'run_code', {}, 100),
      ptcStart('rc', 'rc:ptc:1', SHUT_TOOL, { reason: '够了' }, 200),
      ptcSettle('rc', 'rc:ptc:1', SHUT_TOOL, { reason: '够了' }, 210),
      ptcStart('rc', 'rc:ptc:2', WAKEN_TOOL, { reason: '继续' }, 260),
      ptcSettle('rc', 'rc:ptc:2', WAKEN_TOOL, { reason: '继续' }, 270),
      toolResult(1, 'rc', 300),
    ])
    expect(wakened.state).toBe('active')
    expect(wakened.wakenPending).toBe(true)
    expect(wakened.wakenReason).toBe('继续')
  })

  test('失败的子调用不写账', () => {
    const state = apply([
      start(0),
      toolCall(1, 'rc', 'run_code', {}, 100),
      ptcStart('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 200),
      ptcSettle('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 210, true),
      toolResult(1, 'rc', 300),
    ])
    expect(state.turns[0]?.estimateMs).toBeNull()
  })

  test('反思窗口内的子调用进入反思明细', () => {
    const state = apply([
      start(0),
      injection(100),
      toolCall(1, 'rc1', 'run_code', {}, 150),
      ptcStart('rc1', 'rc1:ptc:1', START_TOOL, {}, 200),
      ptcSettle('rc1', 'rc1:ptc:1', START_TOOL, {}, 210),
      toolResult(1, 'rc1', 300),
      toolCall(1, 'rc2', 'run_code', {}, 400),
      ptcStart('rc2', 'rc2:ptc:1', 'read', {}, 500),
      ptcSettle('rc2', 'rc2:ptc:1', 'read', {}, 1_500),
      ptcStart('rc2', 'rc2:ptc:2', STOP_TOOL, {}, 2_000),
      ptcSettle('rc2', 'rc2:ptc:2', STOP_TOOL, {}, 2_010),
      toolResult(1, 'rc2', 2_100),
    ])
    const record = state.turns[0]
    expect(record?.introspectionOpen).toBe(false)
    expect(record?.introspectionMs).toBe(1_790)
    expect(record?.introspectionTools.read).toEqual({ ms: 1_000, calls: 1 })
    expect(record?.toolMs[START_TOOL]).toEqual({ ms: 10, calls: 1 })
    expect(record?.toolMs[STOP_TOOL]).toEqual({ ms: 10, calls: 1 })
  })

  test('轮次闭合后到达的子调用被丢弃', () => {
    const state = apply([
      start(1_000),
      end(1, 2_000),
      ptcStart('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 2_100),
      ptcSettle('rc', 'rc:ptc:1', ESTIMATE_TOOL, { estimateMs: 30_000 }, 2_110),
    ])
    expect(state.turns[0]?.estimateMs).toBeNull()
    expect(state.openCalls).toEqual({})
  })

  test('子调用参数为对象时同样解析', () => {
    const state = apply([
      start(0),
      toolCall(1, 'rc', 'run_code', {}, 100),
      rawSessionEvent(
        'tool/ptc-dispatch-start',
        { rootCallId: 'rc', parentCallId: 'rc', subCallId: 'rc:ptc:1', name: ESTIMATE_TOOL, arguments: { estimateMs: 12_000 } },
        200,
      ),
      rawSessionEvent(
        'tool/ptc-dispatch',
        {
          rootCallId: 'rc',
          parentCallId: 'rc',
          subCallId: 'rc:ptc:1',
          name: ESTIMATE_TOOL,
          arguments: { estimateMs: 12_000 },
          isError: false,
          content: [],
        },
        210,
      ),
      toolResult(1, 'rc', 300),
    ])
    expect(state.turns[0]?.estimateMs).toBe(12_000)
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