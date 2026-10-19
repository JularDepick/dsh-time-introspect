/* JSON 注入与渲染测试. */

import { describe, expect, test } from 'vitest'
import { buildInjection, distributedRatios, formatJson, formatMs, renderInjection, renderStatus } from '../src/render.js'
import { buildStatusReport, planInjection } from '../src/policy.js'
import { makeConfig, stateWith, turnRecord } from './helpers.js'

function plan(overrides = {}) {
  const state = stateWith(turnRecord({
    turn: 3,
    startTime: 1_000,
    endTime: 53_000,
    estimateMs: 30_000,
    toolMs: { bash: { ms: 30_000, calls: 3 } },
    reflectionMs: 4_800,
    reflectionTools: { read: { ms: 1_200, calls: 1 } },
    ...overrides,
  }))
  const value = planInjection(state, 4, makeConfig())
  if (value === null) throw new Error('expected plan')
  return value
}

describe('格式化与占比', () => {
  test('耗时文本', () => {
    expect(formatMs(500)).toBe('500ms')
    expect(formatMs(1_500)).toBe('1.5s')
    expect(formatMs(125_000)).toBe('2.1m')
  })

  test('每层占比保留 4 位并把差额补给最大项', () => {
    const ratios = distributedRatios([10_000, 100_000, 20_000])
    expect(ratios).toEqual([0.0769, 0.7693, 0.1538])
    expect(ratios.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  })

  test('零总量返回全零', () => {
    expect(distributedRatios([0, 0])).toEqual([0, 0])
  })
})

describe('注入 JSON', () => {
  test('顶层字段与三类明细', () => {
    const value = buildInjection(plan(), makeConfig())
    expect(value.type).toBe('time_introspect')
    expect(value.turn).toBe(3)
    expect(value.estimate_ms).toBe(30_000)
    expect(value.overrun_ms).toBe(22_000)
    expect(value.overrun_ratio).toBe(0.7333)
    expect(value.time_consume_total_ms).toBe(52_000)
    expect(value.time_consume_details.tool.total_ms).toBe(30_000)
    expect(value.time_consume_details.model.total_ms).toBe(17_200)
    expect(value.time_consume_details.introspect.total_ms).toBe(4_800)
    expect(value.time_consume_details.introspect.details.tool.total_ms).toBe(1_200)
    expect(value.time_consume_details.introspect.details.model.total_ms).toBe(3_600)
    expect(value.time_consume_details.tool.desc).toContain('反思窗口外')
    expect(value.time_consume_details.model.desc).toContain('不含任何工具耗时')
    expect(value.time_consume_details.introspect.desc).toContain('反思窗口内')
    expect(value.time_consume_details.introspect.details.tool.desc).toContain('本插件工具')
    expect(value.time_consume_details.introspect.details.model.desc).toContain('不含窗口内工具耗时')
    expect(value.time_consume_details.introspect.details.tool.ratio).toBe(0.25)
    expect(value.time_consume_details.introspect.details.model.ratio).toBe(0.75)
    expect(value.waken).toBeUndefined()
  })

  test('顶层三桶与每层明细各自归一', () => {
    const value = buildInjection(plan(), makeConfig())
    const buckets = [
      value.time_consume_details.tool.ratio,
      value.time_consume_details.model.ratio,
      value.time_consume_details.introspect.ratio,
    ]
    expect(buckets.reduce((sum, entry) => sum + entry, 0)).toBeCloseTo(1, 10)
    const work = value.time_consume_details.tool.details
    expect(work.reduce((sum, entry) => sum + entry.ratio, 0)).toBeCloseTo(1, 10)
    const reflection = value.time_consume_details.introspect.details.tool.details
    expect(reflection.reduce((sum, entry) => sum + entry.ratio, 0)).toBeCloseTo(1, 10)
  })

  test('英文 locale 输出英文 desc', () => {
    const value = buildInjection(plan(), makeConfig({ locale: 'en-US' }))
    expect(value.time_consume_details.tool.desc).toContain('outside the reflection window')
    expect(value.time_consume_details.introspect.desc).toContain('inside the reflection window')
  })

  test('重启原因存在时带 waken 对象', () => {
    const value = buildInjection({ ...plan(), wakenReason: '继续' }, makeConfig())
    expect(value.waken).toEqual({ reason: '继续' })
  })

  test('注入文本是合法 JSON, details 每个对象占一行', () => {
    const text = renderInjection(plan(), makeConfig())
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.type).toBe('time_introspect')
    const lines = text.split('\n').filter((line) => line.includes('"name": "bash"'))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.trim().startsWith('{ "name": "bash"')).toBe(true)
    expect(lines[0]?.trim().endsWith('}')).toBe(true)
  })

  test('formatJson 对简单对象内联', () => {
    const text = formatJson({ a: { b: 1, c: 'x' }, list: [{ d: 2 }] })
    expect(text).toContain('{ "b": 1, "c": "x" }')
    expect(text).toContain('    { "d": 2 }')
    expect(JSON.parse(text)).toEqual({ a: { b: 1, c: 'x' }, list: [{ d: 2 }] })
  })
})

describe('状态结果', () => {
  test('渲染为 JSON 文本', () => {
    const report = buildStatusReport(stateWith(turnRecord()))
    const text = renderStatus(report)
    expect(JSON.parse(text)).toEqual(report)
    expect(report.state).toBe('active')
  })
})