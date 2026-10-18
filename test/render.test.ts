/* 模型可见文案的测试. */

import { describe, expect, test } from 'vitest'
import { planInjection } from '../src/policy.js'
import type { ReflectionPlan } from '../src/policy.js'
import { distributionOf, formatMs, formatPercent, renderDormantNotice, renderReflection } from '../src/render.js'
import { makeConfig, stateWith, turnRecord } from './helpers.js'

const config = makeConfig()

function examplePlan(locale: 'zh-CN' | 'en-US' = 'zh-CN'): ReflectionPlan {
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
  const plan = planInjection(state, 2, makeConfig({ locale }))
  if (plan === null || plan.kind !== 'reflection') throw new Error('expected a reflection plan')
  return plan
}

describe('格式化', () => {
  test('耗时按量级选择单位', () => {
    expect(formatMs(500)).toBe('500ms')
    expect(formatMs(12_200)).toBe('12.2s')
    expect(formatMs(90_000)).toBe('1m 30s')
    expect(formatMs(-5)).toBe('0ms')
  })

  test('占比四舍五入并保留极小非零值', () => {
    expect(formatPercent(50, 100)).toBe('50%')
    expect(formatPercent(1, 300)).toBe('<1%')
    expect(formatPercent(0, 0)).toBe('0%')
  })
})

describe('耗时分布', () => {
  test('模型自身处理参与降序排序', () => {
    const entries = distributionOf(examplePlan(), config)
    expect(entries.map((entry) => entry.label)).toEqual(['bash', '模型自身处理', 'read'])
    expect(entries[1]?.ms).toBe(15_700)
  })

  test('超出上限的工具合并为其他工具', () => {
    const entries = distributionOf(examplePlan(), makeConfig({ topTools: 1 }))
    expect(entries.map((entry) => entry.label)).toContain('其他工具')
    expect(entries.find((entry) => entry.label === '其他工具')?.ms).toBe(9_400)
  })
})

describe('反思注入文案', () => {
  test('包含四类核心信息与首次提示', () => {
    const text = renderReflection(examplePlan(), config)
    expect(text).toContain('[耗时反思] 第 1 轮: 预估 30.0s, 实际 52.0s')
    expect(text).toContain('超出 73%')
    expect(text).toContain('耗时分布: bash 22.1s (43%) / 模型自身处理 15.7s (30%) / read 9.4s (18%)')
    expect(text).toContain('模型自身处理: 15.7s (30%)')
    expect(text).toContain('反思开销: 4.8s, 占该轮总耗时 9%')
    expect(text).toContain('task_estimate')
  })

  test('重启前缀携带自述原因', () => {
    const plan = examplePlan()
    const text = renderReflection({ ...plan, restartReason: '步骤越来越冗杂', firstInjection: false }, config)
    expect(text.startsWith('本次反思由模型主动重启, 自述原因: 步骤越来越冗杂.')).toBe(true)
    expect(text).not.toContain('提示: 任务开始时用')
  })

  test('英文文案可用于非中文会话', () => {
    const text = renderReflection(examplePlan('en-US'), makeConfig({ locale: 'en-US' }))
    expect(text).toContain('[time reflection] Turn 1')
    expect(text).toContain('Time distribution:')
    expect(text).toContain('Model self-processing:')
    expect(text).toContain('Reflection cost:')
  })
})

describe('休眠通知', () => {
  test('说明原因与重启通道', () => {
    const text = renderDormantNotice(config)
    expect(text).toContain('[耗时反思休眠]')
    expect(text).toContain('resume_reflection')
    expect(renderDormantNotice(makeConfig({ locale: 'en-US' }))).toContain('resume_reflection')
  })
})