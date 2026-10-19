/* 插件入口: 注册投影, 工具与归档写盘, 只对主会话在每轮 step 1 决定是否注入耗时报告. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerArchiveWriter } from './archive.js'
import { Config, validateConfig } from './config.js'
import { ALL_TOOLS, PLUGIN_NAME, PROJECTION_KEY, SOURCE_KIND } from './constants.js'
import { planInjection } from './policy.js'
import { renderInjection } from './render.js'
import { isMainHeader } from './session.js'
import { createIntrospectProjection } from './state.js'
import { registerTools } from './tools.js'
import './types.js'

export { Config }

export const name = PLUGIN_NAME

export const inject = ['tools', 'sessionProjections']

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  if (!config.enabled) return

  ctx.sessionProjections.register(createIntrospectProjection(config))
  registerTools(ctx, config)
  registerArchiveWriter(ctx)

  /*
   * 子代理会话完全隐藏插件工具. restrict 只过滤继承层, 因此工具 execute
   * 内还会再做一次主会话检查, 作为兜底.
   */
  ctx.on('agent/created', ({ agent }) => {
    if (isMainHeader(agent.session.header)) return undefined
    agent.ctx.tools.restrict({ deny: [...ALL_TOOLS] })
    return undefined
  })

  /*
   * 前置监听器先委派下游, 确认该步骤会进入后再追加一条带来源的 user 消息.
   * 注入内容不阻断任何工具调用, 模型可以采纳或忽略.
   */
  ctx.on(
    'agent/pre-step',
    async ({ agent, turn, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      if (step !== 1) return decision
      if (!isMainHeader(agent.session.header)) return decision
      if (decision.messages.some((message) => message.source.kind === SOURCE_KIND)) return decision
      const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY)
      if (state === undefined) return decision
      const current = state.turns[state.turns.length - 1]
      if (current !== undefined && current.turn === turn && current.injectionDone) return decision
      const plan = planInjection(state, turn, config)
      if (plan === null) return decision
      const text = renderInjection(plan, config)
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: SOURCE_KIND,
          form: 'snapshot',
          sections: [{ name: SOURCE_KIND, text }],
        },
      })
      return { ...decision, messages: [...decision.messages, message] }
    },
    { prepend: true },
  )
}