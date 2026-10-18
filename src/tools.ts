/* 三个模型可调用工具: 预估, 反思结束标记, 休眠后重启. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { ESTIMATE_TOOL, MAX_ESTIMATE_MS, REFLECTION_COST_TOOL, RESUME_TOOL } from './constants.js'
import { formatMs, toolDescriptions } from './render.js'

/** 注册本插件提供的工具; 工具随插件卸载自动注销. */
export function registerTools(ctx: Context, config: Config): void {
  const text = toolDescriptions(config.locale)
  const zh = config.locale === 'zh-CN'

  ctx.tools.register(
    defineTool({
      name: ESTIMATE_TOOL,
      description: text.estimate,
      parameters: {
        estimateMs: { type: 'integer', required: true, description: text.estimateArg },
        note: { type: 'string', description: text.estimateNote },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            recorded: { type: 'boolean', required: true },
            estimateMs: { type: 'integer', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: zh
              ? `已记录本轮预估: ${formatMs(value.estimateMs)}.`
              : `Recorded this turn's estimate: ${formatMs(value.estimateMs)}.`,
          },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const estimateMs = args.estimateMs
        if (!Number.isSafeInteger(estimateMs) || estimateMs <= 0 || estimateMs > MAX_ESTIMATE_MS) {
          throw new Error(
            `${ESTIMATE_TOOL}: estimateMs must be a safe integer within [1, ${MAX_ESTIMATE_MS}], got ${String(estimateMs)}`,
          )
        }
        return { recorded: true, estimateMs }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: REFLECTION_COST_TOOL,
      description: text.reflection,
      parameters: {
        summary: { type: 'string', description: text.reflectionArg },
        worthIt: { type: 'boolean', description: text.reflectionWorthIt },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            recorded: { type: 'boolean', required: true },
          },
          additionalProperties: false,
        },
        render: () => [
          {
            type: 'text',
            text: zh ? '已标记反思阶段结束, 反思开销已计入本轮耗时.' : 'Reflection phase closed; its cost is counted in this turn.',
          },
        ],
      },
      isConcurrencySafe: () => true,
      async execute() {
        return { recorded: true }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: RESUME_TOOL,
      description: text.resume,
      parameters: {
        reason: { type: 'string', required: true, description: text.resumeArg },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            resumed: { type: 'boolean', required: true },
            reason: { type: 'string', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: zh
              ? `耗时反思已重新启用, 下一次反思提示会附上你的重启依据: ${value.reason}.`
              : `Time reflection is active again. The next reflection prompt will carry your reason: ${value.reason}`,
          },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const reason = args.reason.trim().slice(0, 500)
        if (reason.length === 0) {
          throw new Error(`${RESUME_TOOL}: reason must be a non-empty string`)
        }
        return { resumed: true, reason }
      },
    }),
  )
}