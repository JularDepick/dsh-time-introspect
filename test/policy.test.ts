/* 注入判定与自约束状态机的单元测试. */

import { describe, expect, test } from 'vitest'
import { hasImprovement, planInjection, settleTurn } from '../src/policy.js'
import type { IntrospectState } from '../src/state-types.js'
import { makeConfig, stateWith, turnRecord } from './helpers.js'

const config = makeConfig()

describe('planInjection', () => {
  test('没有预估时不注入', () => {
    const state = stateWith(turnRecord({ estimateMs: null }))
    expect(planInjection(state, 2, config)).toBeNull()
  })

  test('低于绝对或相对阈值时不注入', () => {
    const small = stateWith(turnRecord({ startTime: 0, endTime: 33_000, estimateMs: 30_000 }))
    expect(planInjection(small, 2, config)).toBeNull()
    const tiny = stateWith(turnRecord({ startTime: 0, endTime: 66_000, estimateMs: 60_000 }))
    expect(planInjection(tiny, 2, config)).toBeNull()
  })

  test('超过阈值时给出完整计划', () => {
    const state = stateWith(
      turnRecord({
        turn: 1,
        startTime: 0,
        endTime: 52_000,
        estimateMs: 30_000,
        toolMs: { bash: 22_100, read: 9_400 },
        reflectionMs: 4_800,
      }),
    )
    const plan = planInjection(state, 2, config)
    expect(plan).not.toBeNull()
    if (plan === null || plan.kind !== 'reflection') throw new Error('expected reflection plan')
    expect(plan.actualMs).toBe(52_000)
    expect(plan.overrunMs).toBe(22_000)
    expect(plan.toolTotalMs).toBe(31_500)
    expect(plan.modelMs).toBe(52_000 - 31_500 - 4_800)
    expect(plan.reflectionRatio).toBeCloseTo(4_800 / 52_000)
    expect(plan.firstInjection).toBe(true)
  })

  test('冷却中不注入, 休眠时只给一次通知', () => {
    const cooling = { ...stateWith(turnRecord()), status: 'cooling' as const, coolingRemaining: 2 }
    expect(planInjection(cooling, 2, config)).toBeNull()
    const dormant = { ...stateWith(turnRecord()), status: 'dormant' as const, noticePending: true }
    expect(planInjection(dormant, 2, config)?.kind).toBe('notice')
    const quiet = { ...dormant, noticePending: false }
    expect(planInjection(quiet, 2, config)).toBeNull()
  })

  test('零时长的恢复轮次不触发注入', () => {
    const record = turnRecord({ startTime: 1_000, endTime: 1_000, estimateMs: 30_000 })
    expect(planInjection(stateWith(record), 2, config)).toBeNull()
  })

  test('只有 step 1 之前的最近一轮会被比较', () => {
    const state = stateWith(
      turnRecord({ turn: 1, startTime: 0, endTime: 60_000, estimateMs: 60_000 }),
      turnRecord({ turn: 2, startTime: 60_000, endTime: 120_000, estimateMs: 30_000 }),
    )
    const plan = planInjection(state, 3, config)
    expect(plan).not.toBeNull()
    if (plan === null || plan.kind !== 'reflection') throw new Error('expected reflection plan')
    expect(plan.record.turn).toBe(2)
  })
})

describe('settleTurn', () => {
  test('连续两轮反思占比过高且无改善时进入冷却', () => {
    const first = turnRecord({ turn: 1, startTime: 0, endTime: 50_000, reflectionMs: 9_000 })
    const afterFirst = settleTurn(stateWith(first), first, config)
    expect(afterFirst.status).toBe('active')
    expect(afterFirst.highStreak).toBe(1)

    const second = turnRecord({ turn: 2, startTime: 50_000, endTime: 100_000, reflectionMs: 9_000 })
    const afterSecond = settleTurn({ ...stateWith(first, second), highStreak: afterFirst.highStreak }, second, config)
    expect(afterSecond.status).toBe('cooling')
    expect(afterSecond.coolingRemaining).toBe(config.coolTurns)
    expect(afterSecond.cooldownCount).toBe(1)
  })

  test('冷却按轮倒计时后回到 active', () => {
    let state: IntrospectState = { ...stateWith(), status: 'cooling', coolingRemaining: 3, cooldownCount: 1 }
    state = settleTurn(state, turnRecord({ turn: 3, reflectionMs: 0 }), config)
    expect(state.coolingRemaining).toBe(2)
    state = settleTurn(state, turnRecord({ turn: 4, reflectionMs: 0 }), config)
    state = settleTurn(state, turnRecord({ turn: 5, reflectionMs: 0 }), config)
    expect(state.status).toBe('active')
    expect(state.coolingRemaining).toBe(0)
  })

  test('冷却次数达到上限后进入休眠并留下一次性通知', () => {
    const state = {
      ...stateWith(turnRecord({ turn: 1, reflectionMs: 9_000 })),
      status: 'active' as const,
      cooldownCount: 2,
      highStreak: 1,
    }
    const next = settleTurn(state, turnRecord({ turn: 2, startTime: 50_000, endTime: 100_000, reflectionMs: 9_000 }), config)
    expect(next.status).toBe('dormant')
    expect(next.noticePending).toBe(true)
  })

  test('重启后使用更保守的冷却阈值', () => {
    const first = turnRecord({ turn: 1, startTime: 0, endTime: 50_000, reflectionMs: 6_000 })
    const second = turnRecord({ turn: 2, startTime: 50_000, endTime: 100_000, reflectionMs: 6_000 })
    /* 12% 低于常规阈值 15%, 但高于重启后的 10%, 因此连续两轮仍会触发冷却. */
    const state = { ...stateWith(first, second), conservativeRemaining: 1, highStreak: 1 }
    const next = settleTurn(state, turnRecord({ turn: 3, startTime: 100_000, endTime: 150_000, reflectionMs: 6_000 }), config)
    expect(next.status).toBe('cooling')
  })

  test('零时长轮次不改变自约束状态', () => {
    const record = turnRecord({ startTime: 1_000, endTime: 1_000, reflectionMs: 5_000 })
    const state = stateWith()
    expect(settleTurn(state, record, config)).toBe(state)
  })

  test('耗时明显下降视为改善并清空连续计数', () => {
    const baseline = turnRecord({ turn: 1, startTime: 0, endTime: 60_000, reflectionMs: 9_000 })
    const state = { ...stateWith(baseline), highStreak: 1 }
    const improved = turnRecord({ turn: 2, startTime: 60_000, endTime: 100_000, reflectionMs: 9_000 })
    const next = settleTurn(state, improved, config)
    expect(next.highStreak).toBe(0)
    expect(next.status).toBe('active')
  })
})

describe('hasImprovement', () => {
  test('相对中位数下降超过阈值才算改善', () => {
    const baseline = turnRecord({ turn: 1, startTime: 0, endTime: 100_000 })
    const state = stateWith(baseline)
    const record = turnRecord({ turn: 2, startTime: 100_000, endTime: 189_000 })
    expect(hasImprovement(state, record, config)).toBe(true)
    const slower = turnRecord({ turn: 2, startTime: 100_000, endTime: 191_000 })
    expect(hasImprovement(state, slower, config)).toBe(false)
  })
})