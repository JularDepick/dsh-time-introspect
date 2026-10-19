/* 模型可见 JSON 注入, 状态结果与工具文案. */

import type { Config } from './config.js'
import { START_TOOL, STOP_TOOL } from './constants.js'
import type { InjectionPlan, StatusReport } from './policy.js'
import type { ToolAggregate } from './state-types.js'

/** 紧凑的耗时文本: 毫秒 / 秒 / 分. */
export function formatMs(ms: number): string {
  const value = Math.max(0, ms)
  if (value < 1000) return `${Math.round(value)}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${(value / 60000).toFixed(1)}m`
}

/** 四舍五入到 4 位小数. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/**
 * 把一组毫秒值换算为占比, 保留 4 位小数.
 * 四舍五入导致的缺失差值补给原始占比最大的项, 保证非零总量下和为 1.
 */
export function distributedRatios(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map((value) => Math.max(0, value) / total)
  const rounded = raw.map(round4)
  const delta = round4(1 - rounded.reduce((sum, value) => sum + value, 0))
  if (delta !== 0) {
    let largest = 0
    for (let index = 1; index < raw.length; index += 1) {
      if ((raw[index] ?? 0) > (raw[largest] ?? 0)) largest = index
    }
    rounded[largest] = round4((rounded[largest] ?? 0) + delta)
  }
  return rounded
}

/** 单条工具耗时项. */
export interface ToolEntry {
  name: string
  calls: number
  ms: number
  ratio: number
}

/** 把工具聚合组装为降序明细, 占比相对本层总量. */
export function toolEntries(
  aggregates: Record<string, ToolAggregate>,
  totalOverride?: number,
): ToolEntry[] {
  const entries = Object.entries(aggregates)
    .map(([name, aggregate]) => ({
      name,
      calls: Math.max(0, Math.round(aggregate.calls)),
      ms: Math.max(0, Math.round(aggregate.ms)),
    }))
    .filter((entry) => entry.ms > 0 || entry.calls > 0)
    .sort((left, right) => (right.ms - left.ms) || left.name.localeCompare(right.name))
  const total = totalOverride === undefined
    ? entries.reduce((sum, entry) => sum + entry.ms, 0)
    : Math.max(0, totalOverride)
  const ratios = distributedRatios(entries.map((entry) => entry.ms))
  return entries.map((entry, index) => ({ ...entry, ratio: total > 0 ? (ratios[index] ?? 0) : 0 }))
}

/** 当反思窗口内的工具总时长超过窗口时长时, 按比例压到窗口内, 避免明细自相矛盾. */
function capEntries(entries: ToolEntry[], cap: number): ToolEntry[] {
  const total = entries.reduce((sum, entry) => sum + entry.ms, 0)
  if (total <= 0 || cap <= 0 || total <= cap) return entries
  const scaled = entries.map((entry) => ({ ...entry, ms: Math.floor((entry.ms * cap) / total) }))
  let remainder = cap - scaled.reduce((sum, entry) => sum + entry.ms, 0)
  for (let index = 0; index < scaled.length && remainder > 0; index += 1) {
    const entry = scaled[index]
    if (entry === undefined) continue
    entry.ms += 1
    remainder -= 1
  }
  return scaled
}

/** 注入 JSON 的完整结构. */
export interface InjectionJson {
  type: 'time_introspect'
  desc: string
  turn: number
  waken?: { reason: string }
  estimate_ms: number
  overrun_ms: number
  overrun_ratio: number
  time_consume_total_ms: number
  time_consume_details: {
    tool: { desc: string; ratio: number; total_ms: number; details: ToolEntry[] }
    model: { desc: string; ratio: number; total_ms: number }
    introspect: {
      desc: string
      ratio: number
      total_ms: number
      details: {
        tool: { desc: string; ratio: number; total_ms: number; details: ToolEntry[] }
        model: { desc: string; ratio: number; total_ms: number }
      }
    }
  }
}

/** 组装注入对象; 所有比例在每一层独立归一. */
export function buildInjection(plan: InjectionPlan, config: Config): InjectionJson {
  const copy = categoryDescriptions(config.locale)
  const actual = plan.actualMs
  const outerRatios = distributedRatios([plan.toolTotalMs, plan.modelTotalMs, plan.introspectTotalMs])
  const workEntries = toolEntries(plan.record.toolMs, plan.toolTotalMs)
  const introspectionDetails = plan.introspectTotalMs > 0
    ? capEntries(toolEntries(plan.record.introspectionTools), plan.introspectTotalMs)
    : []
  const cappedToolTotal = introspectionDetails.reduce((sum, entry) => sum + entry.ms, 0)
  const introspectionModel = Math.max(0, plan.introspectTotalMs - cappedToolTotal)
  const innerRatios = distributedRatios([cappedToolTotal, introspectionModel])
  const detailRatios = distributedRatios(introspectionDetails.map((entry) => entry.ms))
  const details = introspectionDetails.map((entry, index) => ({
    ...entry,
    ratio: cappedToolTotal > 0 ? (detailRatios[index] ?? 0) : 0,
  }))
  const value: InjectionJson = {
    type: 'time_introspect',
    desc: config.locale === 'en-US'
      ? `This JSON was generated automatically by dsh-time-introspect and describes the previous turn time distribution. Whether to introspect is your decision; call ${START_TOOL} to begin and ${STOP_TOOL} when done.`
      : `本 JSON 由 dsh-time-introspect 插件自动统计生成, 内容是上一轮任务的耗时分布报告. 是否据此反思由你决定; 如需反思, 调用 ${START_TOOL} 开始, 完成后调用 ${STOP_TOOL}.`,
    turn: plan.record.turn,
    ...(plan.wakenReason !== null && plan.wakenReason.length > 0 ? { waken: { reason: plan.wakenReason } } : {}),
    estimate_ms: plan.estimateMs,
    overrun_ms: plan.overrunMs,
    overrun_ratio: round4(plan.overrunRatio),
    time_consume_total_ms: actual,
    time_consume_details: {
      tool: {
        desc: copy.tool,
        ratio: outerRatios[0] ?? 0,
        total_ms: plan.toolTotalMs,
        details: workEntries,
      },
      model: {
        desc: copy.model,
        ratio: outerRatios[1] ?? 0,
        total_ms: plan.modelTotalMs,
      },
      introspect: {
        desc: copy.introspect,
        ratio: outerRatios[2] ?? 0,
        total_ms: plan.introspectTotalMs,
        details: {
          tool: {
            desc: copy.introspectTool,
            ratio: innerRatios[0] ?? 0,
            total_ms: cappedToolTotal,
            details,
          },
          model: {
            desc: copy.introspectModel,
            ratio: innerRatios[1] ?? 0,
            total_ms: introspectionModel,
          },
        },
      },
    },
  }
  return value
}

/** 注入消息的完整文本; 纯 JSON, details 数组每个对象占一行. */
export function renderInjection(plan: InjectionPlan, config: Config): string {
  return formatJson(buildInjection(plan, config))
}

/** 状态查询结果的文本. */
export function renderStatus(report: StatusReport): string {
  return JSON.stringify(report, null, 2)
}

/** 把 JSON 值格式化为可读文本; details 数组的每个对象压成一行. */
export function formatJson(value: unknown, level = 0): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const padding = '  '.repeat(level + 1)
    const closing = '  '.repeat(level)
    const items = value.map((item) => (isSimpleObject(item) ? inlineJson(item) : formatJson(item, level + 1)))
    return `[\n${items.map((item) => padding + item).join(',\n')}\n${closing}]`
  }
  const object = value as Record<string, unknown>
  if (level > 0 && isSimpleObject(object)) return inlineJson(object)
  const keys = Object.keys(object)
  if (keys.length === 0) return '{}'
  const padding = '  '.repeat(level + 1)
  const closing = '  '.repeat(level)
  const items = keys.map((key) => `${padding}${JSON.stringify(key)}: ${formatJson(object[key], level + 1)}`)
  return `{\n${items.join(',\n')}\n${closing}}`
}

function isSimpleObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
}

function inlineJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => inlineJson(entry)).join(', ')}]`
  const object = value as Record<string, unknown>
  const entries = Object.entries(object).map(([key, entry]) => `${JSON.stringify(key)}: ${inlineJson(entry)}`)
  return `{ ${entries.join(', ')} }`
}

/** 耗时分层对象的范围描述. */
export interface CategoryDescriptions {
  tool: string
  model: string
  introspect: string
  introspectTool: string
  introspectModel: string
}

/** 按语言返回各耗时层的范围描述. */
export function categoryDescriptions(locale: Config['locale']): CategoryDescriptions {
  if (locale === 'en-US') {
    return {
      tool: 'Tool time outside the introspection window. Tool calls made during introspection are excluded. Calls to this plugin\'s own tools, including the start and stop boundary tools, are included.',
      model: 'Model processing and waiting outside the introspection window. Model time inside introspection and all tool time are excluded.',
      introspect: 'All time inside the introspection window, including tool calls (this plugin\'s tools included) and model processing. The start and stop tools themselves sit outside the window and are not included.',
      introspectTool: 'Tool time inside the introspection window, including this plugin\'s tools. The start and stop tools themselves sit outside the window and are not included.',
      introspectModel: 'Model processing and waiting inside the introspection window, excluding tool time.',
    }
  }
  return {
    tool: '本层是反思窗口外的工具耗时, 不含反思窗口内调用的工具; 含反思窗口外的本插件工具(包括开始与结束边界工具)的调用耗时.',
    model: '本层是反思窗口外的模型自身处理与等待耗时, 不含反思窗口内的模型耗时, 也不含任何工具耗时.',
    introspect: '本层是反思窗口内的全部耗时, 含窗口内调用的工具(包括本插件工具)与模型处理; 开始与结束工具本身在窗口外, 不计入本层.',
    introspectTool: '本层是反思窗口内调用的工具耗时, 含窗口内调用的本插件工具; 开始与结束工具本身在窗口外, 不计入本层.',
    introspectModel: '本层是反思窗口内的模型处理与等待耗时, 不含窗口内工具耗时.',
  }
}

/** 工具描述. */
export interface ToolDescriptions {
  estimate: string
  estimateArg: string
  start: string
  stop: string
  shut: string
  shutArg: string
  waken: string
  wakenArg: string
  status: string
}

/** 按语言返回工具描述. */
export function toolDescriptions(locale: Config['locale']): ToolDescriptions {
  if (locale === 'en-US') {
    return {
      estimate: 'Record the estimated duration of this turn in milliseconds. Only turns with an estimate can receive a time distribution after an overrun. The last call in a turn wins.',
      estimateArg: 'Estimated duration of this turn in milliseconds.',
      start: 'Start introspection timing. An injection must have arrived in this turn, and a turn allows one introspection. While dormant, call waken first. Tools called while the window is open are grouped under the introspection breakdown.',
      stop: 'Stop introspection timing. Fails when no introspection window is open. The next injection reports the introspection cost.',
      shut: 'Put the plugin to sleep. No injection happens until waken is called. Sleeping discards an open introspection window.',
      shutArg: 'Why the plugin should sleep. Shown to the user and carried in the next injection.',
      waken: 'Wake the plugin. The first injection after a wake carries your reason. Idempotent when already active.',
      wakenArg: 'Why the plugin should wake. Shown to the user and carried in the next injection.',
      status: 'Read-only status: current state, the last completed turn totals, and the three top-level totals.',
    }
  }
  return {
    estimate: '登记本轮预估耗时(毫秒). 只有登记过预估的轮次, 超时后才会收到耗时报告; 同一轮多次调用以最后一次为准.',
    estimateArg: '本轮预估耗时, 单位毫秒.',
    start: '开始反思计时. 本轮必须先收到耗时报告注入, 且同一轮只能开始一次. 休眠时不能开始, 需先调用 time_introspect_waken. 反思窗口内调用的工具会计入反思明细.',
    stop: '结束反思计时. 没有打开的反思窗口时调用会报错. 下一次注入会统计本次反思开销.',
    shut: '让插件休眠. 休眠后不再注入耗时报告, 直到调用 waken. 休眠会丢弃未结束的反思窗口.',
    shutArg: '休眠原因. 会展示给用户, 并随下一次注入携带.',
    waken: '重启插件. 重启后的第一次注入会带上你给出的原因. 已活动时调用是幂等的.',
    wakenArg: '重启原因. 会展示给用户, 并随下一次注入携带.',
    status: '只读查询插件状态, 最近一轮总账与三类耗时合计.',
  }
}