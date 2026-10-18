/* 插件入口: 注册投影与工具, 并在每轮 step 1 决定是否注入耗时反思. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Config, validateConfig } from './config.js'
import { PLUGIN_NAME, PROJECTION_KEY, SOURCE_KIND } from './constants.js'
import { planInjection } from './policy.js'
import { renderDormantNotice, renderReflection } from './render.js'
import { createIntrospectProjection } from './state.js'
import { registerTools } from './tools.js'
import './types.js'

export { Config }

export const name = PLUGIN_NAME

export const inject = ['tools', 'sessionProjections']

const DORMANT_NOTICE_SUMMARY = 'time reflection dormant'

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  if (!config.enabled) return

  ctx.sessionProjections.register(createIntrospectProjection(config))
  registerTools(ctx, config)

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
      if (decision.messages.some((message) => message.source.kind === SOURCE_KIND)) return decision
      const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY)
      if (state === undefined) return decision
      const plan = planInjection(state, turn, config)
      if (plan === null) return decision
      const text = plan.kind === 'notice' ? renderDormantNotice(config) : renderReflection(plan, config)
      const message =
        plan.kind === 'notice'
          ? createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: SOURCE_KIND, form: 'notice', summary: DORMANT_NOTICE_SUMMARY },
            })
          : createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
            })
      return { ...decision, messages: [...decision.messages, message] }
    },
    { prepend: true },
  )
}