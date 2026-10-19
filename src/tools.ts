/* 六个模型可调用工具: 预估, 开始, 结束, 休眠, 重启, 状态查询. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import {
  ESTIMATE_TOOL,
  MAX_ESTIMATE_MS,
  MAX_REASON_CHARS,
  PROJECTION_KEY,
  SHUT_TOOL,
  START_TOOL,
  STATUS_TOOL,
  STOP_TOOL,
  WAKEN_TOOL,
} from './constants.js'
import { buildStatusReport, type StatusReport } from './policy.js'
import { formatMs, renderStatus, toolDescriptions } from './render.js'
import { isMainHeader } from './session.js'
import { initialIntrospectState } from './state.js'
import type { IntrospectState, TurnRecord } from './state-types.js'

/** 注册本插件提供的工具; 工具随插件卸载自动注销. */
export function registerTools(ctx: Context, config: Config): void {
  const text = toolDescriptions(config.locale)
  const zh = config.locale === 'zh-CN'

  const readState = (session: Session | undefined): IntrospectState => {
    if (session === undefined) return initialIntrospectState()
    const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    return state ?? initialIntrospectState()
  }

  const requireMain = (session: Session | undefined): void => {
    if (session === undefined || !isMainHeader(session.header)) {
      throw new Error(zh ? '本插件仅对主会话生效.' : 'This plugin is available in the main session only.')
    }
  }

  const currentTurn = (state: IntrospectState): TurnRecord | undefined => state.turns[state.turns.length - 1]

  ctx.tools.register(
    defineTool({
      name: ESTIMATE_TOOL,
      description: text.estimate,
      parameters: {
        estimateMs: { type: 'integer', required: true, description: text.estimateArg },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            recorded: { type: 'boolean', required: true },
            estimate_ms: { type: 'integer', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: zh
              ? `已记录本轮预估: ${formatMs(value.estimate_ms)}.`
              : `Estimate recorded for this turn: ${formatMs(value.estimate_ms)}.`,
          },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        const estimateMs = args.estimateMs
        if (!Number.isSafeInteger(estimateMs) || estimateMs <= 0 || estimateMs > MAX_ESTIMATE_MS) {
          throw new Error(
            zh
              ? `预估必须是 1 到 ${MAX_ESTIMATE_MS} 之间的整数毫秒, 收到 ${String(estimateMs)}.`
              : `estimateMs must be an integer between 1 and ${MAX_ESTIMATE_MS}, got ${String(estimateMs)}.`,
          )
        }
        return { recorded: true, estimate_ms: estimateMs }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: START_TOOL,
      description: text.start,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            started: { type: 'boolean', required: true },
          },
          additionalProperties: false,
        },
        render: () => [
          { type: 'text', text: zh ? '反思计时已开始.' : 'Introspection timing started.' },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(_args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        const state = readState(session)
        const record = currentTurn(state)
        if (state.state !== 'active') {
          throw new Error(
            zh
              ? '插件已休眠, 请先调用 time_introspect_waken.'
              : 'The plugin is dormant; call time_introspect_waken first.',
          )
        }
        if (record === undefined || !record.injectionDone) {
          throw new Error(
            zh
              ? '本轮尚未收到耗时报告, 不能开始反思.'
              : 'No time report has arrived in this turn, so introspection cannot start.',
          )
        }
        if (record.introspectionOpen || record.introspectionStarted) {
          throw new Error(zh ? '本轮反思已经开始.' : 'Introspection has already started in this turn.')
        }
        return { started: true }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: STOP_TOOL,
      description: text.stop,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            stopped: { type: 'boolean', required: true },
          },
          additionalProperties: false,
        },
        render: () => [
          { type: 'text', text: zh ? '反思计时已结束.' : 'Introspection timing stopped.' },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(_args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        const state = readState(session)
        const record = currentTurn(state)
        if (record === undefined || !record.introspectionOpen) {
          throw new Error(zh ? '当前没有进行中的反思.' : 'No introspection is currently open.')
        }
        return { stopped: true }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: SHUT_TOOL,
      description: text.shut,
      parameters: {
        reason: { type: 'string', required: true, description: text.shutArg },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            state: { type: 'string', required: true },
            changed: { type: 'boolean', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.changed
              ? (zh ? '插件已休眠.' : 'The plugin is now dormant.')
              : (zh ? '插件已处于休眠.' : 'The plugin is already dormant.'),
          },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        readReason(args.reason, zh)
        const state = readState(session)
        return { state: 'dormant', changed: state.state !== 'dormant' }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: WAKEN_TOOL,
      description: text.waken,
      parameters: {
        reason: { type: 'string', required: true, description: text.wakenArg },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            state: { type: 'string', required: true },
            changed: { type: 'boolean', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.changed
              ? (zh ? '插件已重启.' : 'The plugin is active again.')
              : (zh ? '插件已处于活动状态.' : 'The plugin is already active.'),
          },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        readReason(args.reason, zh)
        const state = readState(session)
        return { state: 'active', changed: state.state === 'dormant' }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: STATUS_TOOL,
      description: text.status,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            state: { type: 'string', required: true },
            dormant: { type: 'boolean', required: true },
            introspection_open: { type: 'boolean', required: true },
            last_turn: {
              required: true,
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  properties: {
                    turn: { type: 'integer', required: true },
                    estimate_ms: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
                    actual_ms: { type: 'integer', required: true },
                    overrun_ms: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
                    overrun_ratio: { required: true, oneOf: [{ type: 'number' }, { type: 'null' }] },
                    time_consume_total_ms: { type: 'integer', required: true },
                  },
                  additionalProperties: false,
                },
              ],
            },
            totals: {
              type: 'object',
              required: true,
              properties: {
                tool_ms: { type: 'integer', required: true },
                model_ms: { type: 'integer', required: true },
                introspect_ms: { type: 'integer', required: true },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          { type: 'text', text: renderStatus(value as StatusReport) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const session = exec.agent?.session
        requireMain(session)
        return buildStatusReport(readState(session))
      },
    }),
  )
}

function readReason(value: string, zh: boolean): string {
  const reason = value.trim().slice(0, MAX_REASON_CHARS)
  if (reason.length === 0) {
    throw new Error(zh ? 'reason 不能为空.' : 'reason must be a non-empty string.')
  }
  return reason
}