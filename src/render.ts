/* 模型可见文案的渲染; 中文为主, 英文为可选语言. */

import type { Config } from './config.js'
import type { ReflectionPlan } from './policy.js'
import type { TurnRecord } from './state-types.js'

/** 紧凑的耗时文本: 毫秒 / 秒 / 分秒. */
export function formatMs(ms: number): string {
  const value = Math.max(0, ms)
  if (value < 1000) return `${Math.round(value)}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`
}

/** 占比文本; 极小的非零占比显示为 <1%. */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0%'
  const percent = (Math.max(0, part) / total) * 100
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}

/** 单条耗时分布项. */
interface DistributionEntry {
  label: string
  ms: number
}

/** 组装降序的耗时分布, 模型自身处理作为独立项参与排序. */
export function distributionOf(plan: ReflectionPlan, config: Config): DistributionEntry[] {
  const record: TurnRecord = plan.record
  const entries: DistributionEntry[] = Object.entries(record.toolMs)
    .map(([label, ms]) => ({ label, ms }))
    .sort((left, right) => right.ms - left.ms)
  const head = entries.slice(0, config.topTools)
  const tail = entries.slice(config.topTools)
  const others = tail.reduce((total, entry) => total + entry.ms, 0)
  if (others > 0) head.push({ label: config.locale === 'en-US' ? 'other tools' : '其他工具', ms: others })
  head.push({ label: config.locale === 'en-US' ? 'model self-processing' : '模型自身处理', ms: plan.modelMs })
  return head.sort((left, right) => right.ms - left.ms)
}

/** 渲染一次耗时反思注入. */
export function renderReflection(plan: ReflectionPlan, config: Config): string {
  const zh = config.locale === 'zh-CN'
  const lines: string[] = []
  if (plan.restartReason !== null) {
    const reason = plan.restartReason.trim()
    if (reason.length > 0) {
      lines.push(zh ? `本次反思由模型主动重启, 自述原因: ${reason}.` : `This reflection was restarted by the model. Stated reason: ${reason}.`)
    } else {
      lines.push(zh ? '本次反思由模型主动重启.' : 'This reflection was restarted by the model.')
    }
  }
  lines.push(
    zh
      ? `[耗时反思] 第 ${plan.record.turn} 轮: 预估 ${formatMs(plan.estimateMs)}, 实际 ${formatMs(plan.actualMs)}, 超出 ${formatPercent(plan.overrunMs, plan.estimateMs)} (+${formatMs(plan.overrunMs)}).`
      : `[time reflection] Turn ${plan.record.turn}: estimated ${formatMs(plan.estimateMs)}, actual ${formatMs(plan.actualMs)}, over by ${formatPercent(plan.overrunMs, plan.estimateMs)} (+${formatMs(plan.overrunMs)}).`,
  )
  lines.push('')
  const items = distributionOf(plan, config)
    .map((entry) => `${entry.label} ${formatMs(entry.ms)} (${formatPercent(entry.ms, plan.actualMs)})`)
    .join(zh ? ' / ' : ' / ')
  lines.push(zh ? `耗时分布: ${items}` : `Time distribution: ${items}`)
  lines.push('')
  const modelHint = zh
    ? '若此项偏高, 优先压缩思考链, 而不是调整工具编排.'
    : 'If this is high, shorten the reasoning chain before changing tool orchestration.'
  lines.push(
    zh
      ? `模型自身处理: ${formatMs(plan.modelMs)} (${formatPercent(plan.modelMs, plan.actualMs)}). ${modelHint}`
      : `Model self-processing: ${formatMs(plan.modelMs)} (${formatPercent(plan.modelMs, plan.actualMs)}). ${modelHint}`,
  )
  lines.push('')
  lines.push(
    zh
      ? `反思开销: ${formatMs(plan.reflectionMs)}, 占该轮总耗时 ${formatPercent(plan.reflectionMs, plan.actualMs)}.`
      : `Reflection cost: ${formatMs(plan.reflectionMs)}, ${formatPercent(plan.reflectionMs, plan.actualMs)} of the turn.`,
  )
  if (plan.firstInjection) {
    lines.push('')
    lines.push(
      zh
        ? '提示: 任务开始时用 task_estimate 记录预估; 反思分析结束后调用 report_reflection_cost 标记结束.'
        : 'Tip: record your estimate with task_estimate at task start, and call report_reflection_cost when the reflection analysis ends.',
    )
  }
  return lines.join('\n')
}

/** 渲染休眠通知, 每个休眠周期只出现一次. */
export function renderDormantNotice(config: Config): string {
  if (config.locale === 'en-US') {
    return [
      '[time reflection dormant] Reflection prompts are paused because reflection overhead stayed high without clear improvement.',
      'If you later find work getting harder, time repeatedly running long, or steps getting more tangled, call resume_reflection to turn time reflection back on and state your reasoning.',
    ].join('\n')
  }
  return [
    '[耗时反思休眠] 因反思开销连续偏高且未带来明显改善, 反思提示已暂停.',
    '如果你在后续工作中自己发现耗时反复偏高, 步骤越来越冗杂, 任务推进越来越困难, 可以调用 resume_reflection 重新启用耗时反思, 并说明你的判断依据.',
  ].join('\n')
}

/** 工具描述, 随 locale 切换. */
export function toolDescriptions(locale: Config['locale']) {
  if (locale === 'en-US') {
    return {
      estimate:
        'Record the duration you estimate this turn needs, in milliseconds. Call once at task start. When the actual duration clearly exceeds the estimate, the next turn starts with the previous turn time distribution so you can tell whether time went to tools or to your own reasoning. Later calls in the same turn replace earlier ones.',
      estimateArg: 'Estimated duration in milliseconds (at most 24 hours).',
      estimateNote: 'Optional note to yourself about the basis of the estimate.',
      reflection:
        'Call once after finishing the time reflection analysis to close the reflection phase. The plugin uses this to account for the cost of reflection itself. The optional summary records your conclusion in one line.',
      reflectionArg: 'One-line conclusion, when you have one.',
      reflectionWorthIt: 'Whether the reflection looked worth its cost, when you have an opinion.',
      resume:
        'Call when time reflection is dormant because its own overhead stayed high, and you find work getting harder or durations repeatedly running long. It re-enables reflection and records your reasoning.',
      resumeArg: 'Why you want reflection back; it appears at the start of the next reflection prompt.',
    }
  }
  return {
    estimate:
      '记录你为本轮任务预估的耗时 (毫秒). 在任务开始时调用一次. 若实际耗时明显超出预估, 下一轮开始时你会收到上一轮的耗时分布, 用于判断时间花在工具还是自身推理上. 同一轮多次调用以最后一次为准.',
    estimateArg: '预估耗时 (毫秒, 上限 24 小时).',
    estimateNote: '可选备注, 仅用于你自己回忆预估依据.',
    reflection:
      '耗时反思分析完成后调用一次, 标记反思阶段结束. 插件会据此计算反思本身占用的时间, 并把它计入成本核算. 可选 summary 用一句话概括你的结论.',
    reflectionArg: '一句话结论 (可选).',
    reflectionWorthIt: '你认为这次反思是否值得其开销 (可选).',
    resume:
      '耗时反思因自身开销过高而休眠后, 如果你发现工作越来越难推进, 耗时反复偏高, 调用本工具重新启用反思. reason 必填: 写下你的判断依据.',
    resumeArg: '你希望重新启用反思的判断依据; 它会出现在下一次反思提示的开头.',
  }
}