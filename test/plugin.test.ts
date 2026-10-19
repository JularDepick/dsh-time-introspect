/* 插件装配, 注入时机与工具行为测试. */

import { describe, expect, test } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { apply, name } from '../src/index.js'
import { Config, validateConfig } from '../src/config.js'
import { ALL_TOOLS, PROJECTION_KEY, SOURCE_KIND } from '../src/constants.js'
import { initialIntrospectState } from '../src/state.js'
import type { IntrospectState } from '../src/state-types.js'
import { ev, makeConfig, stateWith, toolCall, toolResult, turnRecord } from './helpers.js'

function makeFakeContext() {
  const listeners = new Map<string, Array<(payload: any, next: any) => unknown>>()
  const tools: any[] = []
  const definitions: any[] = []
  const states = new WeakMap<object, Map<string, unknown>>()
  const ctx = {
    on(event: string, listener: any, options?: { prepend?: boolean }) {
      const list = listeners.get(event) ?? []
      if (options?.prepend === true) list.unshift(listener)
      else list.push(listener)
      listeners.set(event, list)
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

function mainSession(): any {
  return { id: 'main', header: { delegationDepth: 0 } }
}

function subSession(): any {
  return { id: 'sub', header: { delegationDepth: 1, origin: 'subagent' } }
}

function qualifiedEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 } as unknown as SessionEventMap['turn/start'], 1_000),
    toolCall(1, 'e', 'time_introspect_estimate', { estimateMs: 30_000 }, 1_100),
    toolResult(1, 'e', 1_200),
    toolCall(1, 'b', 'bash', {}, 1_300),
    toolResult(1, 'b', 31_300),
    ev('turn/end', { turn: 1 } as unknown as SessionEventMap['turn/end'], 52_000),
  ]
}

function prepare(session: object = mainSession()) {
  const fake = makeFakeContext()
  apply(fake.ctx as never, makeConfig())
  const definition = fake.definitions[0]
  let state = definition.init()
  for (const event of qualifiedEvents()) state = definition.apply(state, event)
  fake.states.set(session, new Map([[PROJECTION_KEY, state]]))
  const listener = fake.listeners.get('agent/pre-step')?.[0]
  if (listener === undefined) throw new Error('missing agent/pre-step listener')
  return { ...fake, definition, listener, session }
}

function setState(fake: ReturnType<typeof makeFakeContext>, session: object, state: IntrospectState): void {
  fake.states.set(session, new Map([[PROJECTION_KEY, state]]))
}

const enterDecision = async () => ({ kind: 'enter', messages: [] })

describe('插件装配', () => {
  test('注册投影, 六个工具与两个监听器', () => {
    const { tools, definitions, listeners } = prepare()
    expect(definitions).toHaveLength(1)
    expect(definitions[0].key).toBe(PROJECTION_KEY)
    expect(tools.map((tool) => tool.name)).toEqual([
      'time_introspect_estimate',
      'time_introspect_start',
      'time_introspect_stop',
      'time_introspect_shut',
      'time_introspect_waken',
      'time_introspect_status',
    ])
    expect(listeners.get('agent/pre-step')).toHaveLength(1)
    expect(listeners.get('agent/created')).toHaveLength(1)
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
    expect(resolved.maxTurnHistory).toBe(12)
    expect(resolved.locale).toBe('zh-CN')
    expect(() => validateConfig(resolved)).not.toThrow()
  })

  test('非法配置在加载期失败', () => {
    expect(() => validateConfig(makeConfig({ minOverrunRatio: 1.5 }))).toThrow(/minOverrunRatio/)
    expect(() => validateConfig(makeConfig({ minOverrunMs: -1 }))).toThrow(/minOverrunMs/)
    expect(() => validateConfig(makeConfig({ maxTurnHistory: 0 }))).toThrow(/maxTurnHistory/)
  })
})

describe('子代理隐藏', () => {
  test('子代理创建时拒绝六个工具, 主会话不限制', () => {
    const { listeners } = prepare()
    const listener = listeners.get('agent/created')?.[0]
    if (listener === undefined) throw new Error('missing agent/created listener')
    const calls: unknown[] = []
    const subAgent = { session: subSession(), ctx: { tools: { restrict: (filter: unknown) => { calls.push(filter); return () => {} } } } }
    listener({ agent: subAgent }, undefined)
    expect(calls).toEqual([{ deny: [...ALL_TOOLS] }])
    const mainAgent = { session: mainSession(), ctx: { tools: { restrict: (filter: unknown) => { calls.push(filter); return () => {} } } } }
    listener({ agent: mainAgent }, undefined)
    expect(calls).toHaveLength(1)
  })
})

describe('注入时机', () => {
  test('上一轮超时后, 在主会话下一轮 step 1 注入 JSON', async () => {
    const { listener, session } = prepare()
    const decision: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(1)
    const message = decision.messages[0]
    expect(message.source.kind).toBe(SOURCE_KIND)
    expect(message.source.form).toBe('snapshot')
    const json = JSON.parse(message.content[0].text)
    expect(json.type).toBe('time_introspect')
    expect(json.estimate_ms).toBe(30_000)
    expect(json.overrun_ms).toBe(21_000)
    expect(json.time_consume_total_ms).toBe(51_000)
  })

  test('非 step 1, 中止或下游拒绝时不注入', async () => {
    const { listener, session } = prepare()
    const later: any = await listener({ agent: { session }, turn: 2, step: 2, signal: { aborted: false } }, enterDecision)
    expect(later.messages).toHaveLength(0)
    const aborted: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: true } }, enterDecision)
    expect(aborted.messages).toHaveLength(0)
    const rejected: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, async () => ({ kind: 'reject' }))
    expect(rejected.kind).toBe('reject')
  })

  test('子代理会话不注入', async () => {
    const session = subSession()
    const { listener } = prepare(session)
    const decision: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })

  test('同一批次已有本插件消息时不重复注入', async () => {
    const { listener, session } = prepare()
    const existing = { role: 'user', id: 'i', content: [], source: { kind: SOURCE_KIND, form: 'snapshot', sections: [] } }
    const decision: any = await listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, async () => ({
      kind: 'enter',
      messages: [existing],
    }))
    expect(decision.messages).toHaveLength(1)
  })

  test('没有投影状态的会话不注入', async () => {
    const { listener } = prepare()
    const decision: any = await listener({ agent: { session: mainSession() }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })

  test('本轮已注入过时不重复注入', async () => {
    const session = mainSession()
    const fake = prepare(session)
    let state = fake.definition.init()
    for (const event of qualifiedEvents()) state = fake.definition.apply(state, event)
    state = {
      ...state,
      turns: [...state.turns, turnRecord({ turn: 2, startTime: 53_000, endTime: null, injectionDone: true })],
    }
    setState(fake, session, state)
    const decision: any = await fake.listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })

  test('dormant 不注入', async () => {
    const session = mainSession()
    const fake = prepare(session)
    let state = fake.definition.init()
    for (const event of qualifiedEvents()) state = fake.definition.apply(state, event)
    setState(fake, session, { ...state, state: 'dormant' })
    const decision: any = await fake.listener({ agent: { session }, turn: 2, step: 1, signal: { aborted: false } }, enterDecision)
    expect(decision.messages).toHaveLength(0)
  })
})

describe('工具行为', () => {
  function toolOf(fake: ReturnType<typeof makeFakeContext>, name: string): any {
    return fake.tools.find((tool) => tool.name === name)
  }

  test('预估校验取值范围', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = mainSession()
    setState(fake, session, stateWith(turnRecord()))
    const tool = toolOf(fake, 'time_introspect_estimate')
    await expect(tool.execute({ estimateMs: 30_000 }, { agent: { session } })).resolves.toEqual({ recorded: true, estimate_ms: 30_000 })
    await expect(tool.execute({ estimateMs: 0 }, { agent: { session } })).rejects.toThrow(/预估/)
    await expect(tool.execute({ estimateMs: 25 * 60 * 60 * 1000 }, { agent: { session } })).rejects.toThrow(/预估/)
  })

  test('开始反思要求本轮有注入且窗口未打开', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = mainSession()
    setState(fake, session, stateWith(turnRecord({ injectionDone: false })))
    const tool = toolOf(fake, 'time_introspect_start')
    await expect(tool.execute({}, { agent: { session } })).rejects.toThrow(/尚未收到/)
    setState(fake, session, stateWith(turnRecord({ injectionDone: true })))
    await expect(tool.execute({}, { agent: { session } })).resolves.toEqual({ started: true })
    setState(fake, session, stateWith(turnRecord({ injectionDone: true, introspectionOpen: true })))
    await expect(tool.execute({}, { agent: { session } })).rejects.toThrow(/已经开始/)
    setState(fake, session, stateWith(turnRecord({ injectionDone: true, introspectionStarted: true })))
    await expect(tool.execute({}, { agent: { session } })).rejects.toThrow(/已经开始/)
    setState(fake, session, { ...stateWith(turnRecord({ injectionDone: true })), state: 'dormant' })
    await expect(tool.execute({}, { agent: { session } })).rejects.toThrow(/已休眠/)
  })

  test('结束反思要求窗口已打开', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = mainSession()
    const tool = toolOf(fake, 'time_introspect_stop')
    setState(fake, session, stateWith(turnRecord({ introspectionOpen: false })))
    await expect(tool.execute({}, { agent: { session } })).rejects.toThrow(/没有进行中的反思/)
    setState(fake, session, stateWith(turnRecord({ introspectionOpen: true })))
    await expect(tool.execute({}, { agent: { session } })).resolves.toEqual({ stopped: true })
  })

  test('休眠与重启幂等, 并要求原因', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = mainSession()
    const shut = toolOf(fake, 'time_introspect_shut')
    const waken = toolOf(fake, 'time_introspect_waken')
    setState(fake, session, stateWith(turnRecord()))
    await expect(shut.execute({ reason: '  ' }, { agent: { session } })).rejects.toThrow(/reason/)
    await expect(shut.execute({ reason: '够了' }, { agent: { session } })).resolves.toEqual({ state: 'dormant', changed: true })
    setState(fake, session, { ...stateWith(turnRecord()), state: 'dormant' })
    await expect(shut.execute({ reason: '够了' }, { agent: { session } })).resolves.toEqual({ state: 'dormant', changed: false })
    await expect(waken.execute({ reason: '继续' }, { agent: { session } })).resolves.toEqual({ state: 'active', changed: true })
    setState(fake, session, stateWith(turnRecord()))
    await expect(waken.execute({ reason: '继续' }, { agent: { session } })).resolves.toEqual({ state: 'active', changed: false })
  })

  test('状态查询返回结构并渲染 JSON', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = mainSession()
    setState(fake, session, stateWith(turnRecord({ turn: 3, toolMs: { bash: { ms: 30_000, calls: 3 } }, introspectionMs: 4_800 })))
    const tool = toolOf(fake, 'time_introspect_status')
    const value = await tool.execute({}, { agent: { session } })
    expect(value.last_turn.turn).toBe(3)
    expect(value.totals.tool_ms).toBe(30_000)
    const rendered = tool.output.render({}, value)[0].text
    expect(JSON.parse(rendered).last_turn.turn).toBe(3)
  })

  test('子代理调用任何工具都报仅主会话', async () => {
    const fake = makeFakeContext()
    apply(fake.ctx as never, makeConfig())
    const session = subSession()
    setState(fake, session, stateWith(turnRecord({ injectionDone: true })))
    for (const tool of fake.tools) {
      await expect(tool.execute({ estimateMs: 1_000, reason: 'x' }, { agent: { session } })).rejects.toThrow(/仅对主会话/)
    }
  })
})