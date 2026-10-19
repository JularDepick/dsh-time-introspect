/* 注入判定与状态报告测试. */

import { describe, expect, test } from 'vitest'
import { aggregateCalls, aggregateTotal, buildStatusReport, planInjection } from '../src/policy.js'
import { makeConfig, stateWith, turnRecord } from './helpers.js'

describe('planInjection', () => {
  test('上一轮超时后返回完整计划', () => {
    const state = stateWith(turnRecord({
      turn: 3,
      startTime: 1_000,
      endTime: 53_000,
      estimateMs: 30_000,
      toolMs: { bash: { ms: 30_000, calls: 3 } },
      introspectionMs: 4_800,
      introspectionTools: { read: { ms: 1_200, calls: 1 } },
    }))
    const plan = planInjection(state, 4, makeConfig())
    expect(plan).not.toBeNull()
    expect(plan?.actualMs).toBe(52_000)
    expect(plan?.overrunMs).toBe(22_000)
    expect(plan?.overrunRatio).toBeCloseTo(22_000 / 30_000)
    expect(plan?.toolTotalMs).toBe(30_000)
    expect(plan?.introspectTotalMs).toBe(4_800)
    expect(plan?.modelTotalMs).toBe(17_200)
  })

  test('dormant 不注入', () => {
    const state = { ...stateWith(turnRecord()), state: 'dormant' as const }
    expect(planInjection(state, 2, makeConfig())).toBeNull()
  })

  test('没有上一轮或没有预估时不注入', () => {
    expect(planInjection(stateWith(), 2, makeConfig())).toBeNull()
    expect(planInjection(stateWith(turnRecord({ estimateMs: null })), 2, makeConfig())).toBeNull()
  })

  test('低于绝对或比例阈值时不注入', () => {
    const lowAbsolute = stateWith(turnRecord({ startTime: 0, endTime: 34_000, estimateMs: 30_000 }))
    expect(planInjection(lowAbsolute, 2, makeConfig())).toBeNull()
    const lowRatio = stateWith(turnRecord({ startTime: 0, endTime: 40_000, estimateMs: 30_000 }))
    expect(planInjection(lowRatio, 2, makeConfig({ minOverrunRatio: 0.5 }))).toBeNull()
  })

  test('重启原因随计划返回', () => {
    const state = {
      ...stateWith(turnRecord()),
      wakenPending: true,
      wakenReason: '工具调用冗余',
    }
    expect(planInjection(state, 2, makeConfig())?.wakenReason).toBe('工具调用冗余')
  })

  test('只取当前轮之前的最近闭合轮次', () => {
    const state = stateWith(
      turnRecord({ turn: 1, startTime: 0, endTime: 10_000, estimateMs: 1_000 }),
      turnRecord({ turn: 3, startTime: 2_000, endTime: 52_000, estimateMs: 30_000 }),
      turnRecord({ turn: 4, startTime: 60_000, endTime: null, estimateMs: null }),
    )
    expect(planInjection(state, 5, makeConfig())?.record.turn).toBe(3)
  })
})

describe('聚合与状态报告', () => {
  test('汇总工具耗时与调用次数', () => {
    const aggregates = { bash: { ms: 1_000, calls: 2 }, read: { ms: 500, calls: 1 } }
    expect(aggregateTotal(aggregates)).toBe(1_500)
    expect(aggregateCalls(aggregates)).toBe(3)
  })

  test('状态报告返回最近一轮总账与三类合计', () => {
    const state = stateWith(turnRecord({
      turn: 3,
      startTime: 1_000,
      endTime: 53_000,
      estimateMs: 30_000,
      toolMs: { bash: { ms: 30_000, calls: 3 } },
      introspectionMs: 4_800,
    }))
    const report = buildStatusReport(state)
    expect(report.state).toBe('active')
    expect(report.last_turn?.turn).toBe(3)
    expect(report.last_turn?.actual_ms).toBe(52_000)
    expect(report.last_turn?.overrun_ms).toBe(22_000)
    expect(report.last_turn?.overrun_ratio).toBe(0.7333)
    expect(report.totals).toEqual({ tool_ms: 30_000, model_ms: 17_200, introspect_ms: 4_800 })
  })

  test('没有完成轮次时 last_turn 为 null', () => {
    const state = stateWith(turnRecord({ endTime: null }))
    const report = buildStatusReport(state)
    expect(report.last_turn).toBeNull()
    expect(report.totals).toEqual({ tool_ms: 0, model_ms: 0, introspect_ms: 0 })
    expect(report.introspection_open).toBe(false)
  })

  test('没有预估时 overrun 字段为 null', () => {
    const report = buildStatusReport(stateWith(turnRecord({ estimateMs: null })))
    expect(report.last_turn?.estimate_ms).toBeNull()
    expect(report.last_turn?.overrun_ms).toBeNull()
    expect(report.last_turn?.overrun_ratio).toBeNull()
  })
})
