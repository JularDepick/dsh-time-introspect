/* 插件装配与注入时机的测试; 使用最小假 Context 代替运行时. */

import { describe, expect, test } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'
import { Config, validateConfig } from '../src/config.js'
import { name } from '../src/index.js'
import { PROJECTION_KEY, SOURCE_KIND } from '../src/constants.js'
import { makeConfig, ev } from './helpers.js'

function makeFakeContext() {
  const listeners = new Map<string, Array<(payload: unknown, next: () => Promise<unknown>) => unknown>>()
  const tools: any[] = []
  const definitions: any[] = []
  const states = new WeakMap<object, Map<string, unknown>>()
  const ctx = {
    on(name: string, listener: any, options?: { prepend?: boolean }) {
      const list = listeners.get(name) ?? []
      if (options?.prepend === true) list.unshift(listener)
      else list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    tools: {
      register(tool: any) {
        tools.push(tool)
      },
    },
    sessionProjections: {
      register(definition: any) {
        definitions.push(definition)
        return () => {}
      },
      stateOf(session: object, key: string) {
        return states.get(session)?.get(key)
      },
    },
  }
  return { ctx, listeners, tools, definitions, states }
}

function qualifiedEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }, 1_000),
    ev(
      'tool/call',
      { turn: 1, step: 1, callId: 'e', name: 'task_estimate', arguments: '{"estimateMs":30000}' } as unknown as SessionEventMap['tool/call'],
      1_100,
    ),
    ev(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: { role: 'tool', id: 'm', content: [], source: { kind: 'tool', callId: 'e' } },
      } as unknown as SessionEventMap['tool/result'],
      1_200,
    ),
    ev(
      'tool/call',
      { turn: 1, step: 1, callId: 'b', name: 'bash', arguments: '{}' } as unknown as SessionEventMap['tool/call'],
      1_300,
    ),
    ev(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: { role: 'tool', id: 'm2', content: [], source: { kind: 'tool', callId: 'b' } },
      } as unknown as SessionEventMap['tool/result'],
      31_300,
    ),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } } as unknown as SessionEventMap['turn/end'], 52_000),
  ]
}

function prepare(session: object = { id: 's1' }) {
  const fake = makeFakeContext()
  apply(fake.ctx as never, makeConfig())
  const definition = fake.definitions[0]
  let state = definition.init()
  for (const event of qualifiedEvents()) state = definition.apply(state, event)
  fake.states.set(session, new Map([[PROJECTION_KEY, state]]))
  const listener = fake.listeners.get('agent/pre-step')?.[0]
  if (listener === undefined) throw new Error('missing agent/pre-step listener')
  return { ...fake, listener, session }
}

const enterDecision = async () => ({ kind: 'enter', messages: [] })

describe('插件装配', () => {
  test('注册投影, 三个工具与一个前置 pre-step 监听器', () => {
    const { tools, definitions, listeners } = prepare()
    expect(definitions).toHaveLength(1)
    expect(definitions[0].key).toBe(PROJECTION_KEY)
    expect(tools.map((tool) => tool.name)).toEqual(['task_estimate', 'report_reflection_cost', 'resume_reflection'])
    expect(listeners.get('agent/pre-step')).toHaveLength(1)
  })

  test('插件名与注入来源 kind 一致', () => {
    expect(name).toBe('dsh-time-introspect')
    expect(SOURCE_KIND).toBe(name)
  })

  test('配置关闭时什么都不注册', () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig({ enabled: false }))
    expect(fake.tools).toHaveLength(0)
    expect(fake.definitions).toHaveLength(0)
    expect(fake.listeners.size).toBe(0)
  })

  test('配置 schema 填充默认值', () => {
    const resolved = Config(undefined)
    expect(resolved.enabled).toBe(true)
    expect(resolved.minOverrunRatio).toBe(0.2)
    expect(resolved.minOverrunMs).toBe(5000)
    expect(resolved.locale).toBe('zh-CN')
    expect(resolved.coolAfterHighTurns).toBe(2)
    expect(() => validateConfig(resolved)).not.toThrow()
  })

  test('非法配置在加载期失败', () => {
    expect(() => validateConfig(makeConfig({ coolRatio: 1.5 }))).toThrow(/coolRatio/)
    expect(() => validateConfig(makeConfig({ minOverrunMs: -1 }))).toThrow(/minOverrunMs/)
    expect(() => validateConfig(makeConfig({ baselineTurns: 20 }))).toThrow(/maxTurnHistory/)
  })
})

describe('注入时机', () => {
  test('上一轮超时后, 在下一轮 step 1 注入一条带来源的消息', async () => {
    const { listener, session } = prepare()
    const decision: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0].source.kind).toBe(SOURCE_KIND)
    expect(decision.messages[0].source.form).toBe('snapshot')
    expect(decision.messages[0].content[0].text).toContain('[耗时反思]')
  })

  test('休眠迁移后只注入一次通知', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const definition = fake.definitions[0]
    const session = { id: 'dormant' }
    fake.states.set(session, new Map([[PROJECTION_KEY, { ...definition.init(), status: 'dormant', noticePending: true }]]))
    const listener = fake.listeners.get('agent/pre-step')?.[0]
    if (listener === undefined) throw new Error('missing listener')
    const first: any = await listener({ agent: { session }, turn: 5, step: 1, signal: { aborted: false } }, enterDecision)
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0].source.form).toBe('notice')
    fake.states.set(session, new Map([[PROJECTION_KEY, { ...definition.init(), status: 'dormant', noticePending: false, noticeEmitted: true }]]))
    const second: any = await listener({ agent: { session }, turn: 6, step: 1, signal: { aborted: false } }, enterDecision)
    expect(second.messages).toHaveLength(0)
  })

  test('非 step 1 不注入', async () => {
    const { listener, session } = prepare()
    const decision: any = await listener({ agent: { session }, turn: 2, step: 2, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })

  test('下游拒绝或中止时不注入', async () => {
    const { listener, session } = prepare()
    const rejected: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, async () => ({ kind: 'reject' }))
    expect(rejected.kind).toBe('reject')
    const aborted: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: true } }, enterDecision)
    expect(aborted.messages).toHaveLength(0)
  })

  test('同一批次已有本插件消息时不重复注入', async () => {
    const { listener, session } = prepare()
    const existing = { role: 'user', id: 'i', content: [], source: { kind: SOURCE_KIND, form: 'notice', summary: 'x' } }
    const decision: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, async () => ({
      kind: 'enter',
      messages: [existing],
    }))
    expect(decision.messages).toHaveLength(1)
  })

  test('没有投影状态的会话不注入', async () => {
    const { listener } = prepare()
    const decision: any = await listener({ agent: { session: { id: 'unknown' } }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })
})

describe('工具行为', () => {
  test('task_estimate 校验取值范围', async () => {
    const { tools } = prepare()
    const tool = tools[0]
    await expect(tool.execute({ estimateMs: 30_000 }, {} as never)).resolves.toEqual({ recorded: true, estimateMs: 30_000 })
    await expect(tool.execute({ estimateMs: 0 }, {} as never)).rejects.toThrow(/estimateMs/)
    await expect(tool.execute({ estimateMs: 25 * 60 * 60 * 1000 }, {} as never)).rejects.toThrow(/estimateMs/)
  })

  test('resume_reflection 要求非空原因并裁剪长度', async () => {
    const { tools } = prepare()
    const tool = tools[2]
    await expect(tool.execute({ reason: '   ' }, {} as never)).rejects.toThrow(/reason/)
    const long = 'x'.repeat(600)
    const value = await tool.execute({ reason: long }, {} as never)
    expect(value.reason).toHaveLength(500)
  })

  test('工具结果渲染为短文本', () => {
    const { tools } = prepare()
    expect(tools[0].output.render({ estimateMs: 30_000 }, { recorded: true, estimateMs: 30_000 })[0].text).toContain('30.0s')
    expect(tools[1].output.render({}, { recorded: true })[0].text).toContain('反思阶段结束')
  })
})