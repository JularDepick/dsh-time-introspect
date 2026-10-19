/* 浏览器半端: 工具调用红点气泡与耗时自省 Tab. */

import * as React from 'react'

const NS = 'time-introspect'
const PLUGIN_ID = 'dsh-time-introspect'
const TOOL_NAMES = [
  'time_introspect_estimate',
  'time_introspect_start',
  'time_introspect_stop',
  'time_introspect_shut',
  'time_introspect_waken',
  'time_introspect_status',
]
const AUTO_SHOW_MS = 3000
const RECENT_WINDOW_MS = 15000
const autoShown = new Set<string>()

const zh: Record<string, string> = {
  'tool.estimate': '登记预估',
  'tool.start': '开始反思',
  'tool.stop': '结束反思',
  'tool.shut': '插件休眠',
  'tool.waken': '插件重启',
  'tool.status': '查询耗时状态',
  'brief.estimate': '登记本轮预估 {ms}',
  'brief.estimatePending': '登记本轮预估',
  'brief.start': '开始反思',
  'brief.stop': '结束反思',
  'brief.stopMs': '结束反思 · {ms}',
  'brief.shut': '插件休眠 · {reason}',
  'brief.shutNoReason': '插件休眠',
  'brief.waken': '插件重启 · {reason}',
  'brief.wakenNoReason': '插件重启',
  'brief.status': '查询耗时状态',
  'brief.preparing': '准备调用 {tool}',
  'brief.failed': '调用失败',
  'detail.phase': '阶段',
  'detail.time': '时间',
  'detail.turn': '轮次',
  'detail.args': '参数',
  'detail.result': '结果',
  'detail.error': '错误',
  'detail.introspection': '本次反思',
  'detail.state': '插件状态',
  'detail.inspect': '在轨迹中查看',
  'detail.noResult': '暂无结果',
  'phase.preparing': '准备中',
  'phase.start': '已派发',
  'phase.result': '已完成',
  'tab.label': '耗时自省',
  'page.title': '耗时自省',
  'page.subtitle': '每一轮的耗时分布, 以及模型注入后是否真的反思.',
  'section.distribution': '耗时分布',
  'section.injections': '反思记录',
  'summary.turns': '归档轮次',
  'summary.injections': '注入次数',
  'summary.reflected': '已反思',
  'empty.distribution': '还没有归档数据. 完成一轮对话后, 这里会出现耗时分布.',
  'empty.injections': '还没有注入记录. 耗时超出预估后, 这里会出现注入历史.',
  'card.turn': '第 {turn} 轮',
  'card.actual': '实际',
  'card.estimate': '预估',
  'card.overrun': '超出',
  'card.ratio': '超出比例',
  'card.noEstimate': '无预估',
  'card.noOverrun': '未超出',
  'category.tool': '工具',
  'category.model': '模型自身',
  'category.introspect': '反思',
  'details.show': '展开明细',
  'details.hide': '收起明细',
  'details.tools': '工具明细',
  'details.introspectionTools': '反思内工具',
  'table.name': '工具',
  'table.calls': '调用',
  'table.ms': '耗时',
  'table.ratio': '占比',
  'injection.turn': '注入到第 {turn} 轮',
  'injection.about': '统计第 {turn} 轮',
  'injection.outcome': '反思状态',
  'injection.reflection': '反思耗时',
  'injection.started': '已开始',
  'injection.completed': '已结束',
  'injection.time': '注入时间',
  'outcome.pending': '等待中',
  'outcome.open': '反思进行中',
  'outcome.completed': '已反思',
  'outcome.incomplete': '反思未完成',
  'outcome.not_started': '未反思',
  'outcome.aborted': '已中断',
  'value.yes': '是',
  'value.no': '否',
}

const en: Record<string, string> = {
  'tool.estimate': 'Estimate',
  'tool.start': 'Start introspection',
  'tool.stop': 'Stop introspection',
  'tool.shut': 'Sleep plugin',
  'tool.waken': 'Wake plugin',
  'tool.status': 'Query time status',
  'brief.estimate': 'Recorded estimate {ms}',
  'brief.estimatePending': 'Recording estimate',
  'brief.start': 'Started introspection',
  'brief.stop': 'Stopped introspection',
  'brief.stopMs': 'Stopped introspection · {ms}',
  'brief.shut': 'Plugin asleep · {reason}',
  'brief.shutNoReason': 'Plugin asleep',
  'brief.waken': 'Plugin awake · {reason}',
  'brief.wakenNoReason': 'Plugin awake',
  'brief.status': 'Queried time status',
  'brief.preparing': 'Preparing {tool}',
  'brief.failed': 'failed',
  'detail.phase': 'Phase',
  'detail.time': 'Time',
  'detail.turn': 'Turn',
  'detail.args': 'Arguments',
  'detail.result': 'Result',
  'detail.error': 'Error',
  'detail.introspection': 'Introspection',
  'detail.state': 'Plugin state',
  'detail.inspect': 'View in trajectory',
  'detail.noResult': 'No result',
  'phase.preparing': 'preparing',
  'phase.start': 'dispatched',
  'phase.result': 'settled',
  'tab.label': 'Introspection',
  'page.title': 'Time introspection',
  'page.subtitle': 'Per-turn time distribution, and whether the model actually introspected after an injection.',
  'section.distribution': 'Time distribution',
  'section.injections': 'Introspection records',
  'summary.turns': 'Turns archived',
  'summary.injections': 'Injections',
  'summary.reflected': 'Introspected',
  'empty.distribution': 'No archive yet. A time distribution appears here after a turn completes.',
  'empty.injections': 'No injection yet. An injection appears here after a turn exceeds its estimate.',
  'card.turn': 'Turn {turn}',
  'card.actual': 'Actual',
  'card.estimate': 'Estimate',
  'card.overrun': 'Overrun',
  'card.ratio': 'Overrun ratio',
  'card.noEstimate': 'No estimate',
  'card.noOverrun': 'No overrun',
  'category.tool': 'Tools',
  'category.model': 'Model',
  'category.introspect': 'Introspection',
  'details.show': 'Show details',
  'details.hide': 'Hide details',
  'details.tools': 'Tool details',
  'details.introspectionTools': 'Tools during introspection',
  'table.name': 'Tool',
  'table.calls': 'Calls',
  'table.ms': 'Time',
  'table.ratio': 'Share',
  'injection.turn': 'Injected into turn {turn}',
  'injection.about': 'Summarizes turn {turn}',
  'injection.outcome': 'Introspection',
  'injection.reflection': 'Introspection time',
  'injection.started': 'Started',
  'injection.completed': 'Completed',
  'injection.time': 'Injected at',
  'outcome.pending': 'Pending',
  'outcome.open': 'In progress',
  'outcome.completed': 'Introspected',
  'outcome.incomplete': 'Incomplete',
  'outcome.not_started': 'Not started',
  'outcome.aborted': 'Aborted',
  'value.yes': 'Yes',
  'value.no': 'No',
}

export const name = PLUGIN_ID
export const inject = ['slots', 'locale']

/** 注册工具视图与双语文案; 注册项随插件卸载回收. */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'time-introspect: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'time-introspect: en dictionary')
  for (const toolName of TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        { name: 'tool.call.toolview', key: toolName, locale: NS },
        ToolBubble,
      ),
    )
  }
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'time-introspect',
        order: 40,
        locale: NS,
        label: () => {
          try {
            if (typeof ctx.locale.bind === 'function') return ctx.locale.bind(NS)('tab.label')
          } catch {
            /* 词典尚未就绪时使用中文回退. */
          }
          return tr(undefined, 'tab.label')
        },
      },
      IntrospectionTab,
    ),
  )
}

function ToolBubble(props: any) {
  const { callId, toolName, phase, block, useDisclosure, useProjection, t, inspect } = props
  const { expanded, setExpanded, toggle } = useDisclosure()
  const timerRef = React.useRef<any>(null)

  React.useEffect(() => {
    if (autoShown.has(callId)) return
    const time = typeof block?.time === 'number' ? block.time : Date.now()
    if (Date.now() - time > RECENT_WINDOW_MS) return
    setExpanded(true)
    const timer = window.setTimeout(() => {
      autoShown.add(callId)
      if (timerRef.current === timer) timerRef.current = null
      setExpanded(false)
    }, AUTO_SHOW_MS)
    timerRef.current = timer
    return () => {
      if (timerRef.current === timer) {
        window.clearTimeout(timer)
        timerRef.current = null
      }
    }
  }, [callId])

  const projection = (typeof useProjection === 'function' ? useProjection : NO_PROJECTION)('timeIntrospect')
  const turns = Array.isArray(projection?.turns) ? projection.turns : []
  const current = turns[turns.length - 1]
  const args = block?.args
  const estimateMs = readNumber(args, 'estimateMs')
  const reason = readText(args, 'reason')
  const resultText = phase === 'result' ? flattenContent(block?.content) : ''
  const errorText = phase === 'result' ? readError(block) : ''
  const stopMs = toolName === 'time_introspect_stop' ? (current?.introspectionMs ?? 0) : 0
  const toolLabel = tr(t, 'tool.' + shortTool(toolName))
  const brief = makeBrief(t, { toolName, phase, estimateMs, reason, stopMs, block, toolLabel })
  const toolTime = formatTime(block?.time)
  const phaseLabel = tr(t, 'phase.' + phase)
  const turnLabel = typeof block?.turn === 'number'
    ? block.turn + (typeof block?.step === 'number' ? '.' + block.step : '')
    : undefined

  const onClick = (event: any) => {
    event.preventDefault()
    event.stopPropagation()
    autoShown.add(callId)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    toggle()
  }

  return React.createElement(
    'div',
    {
      style: styles.root,
      'data-time-introspect': shortTool(toolName),
      'data-call-id': callId,
    },
    React.createElement(
      'button',
      {
        type: 'button',
        style: styles.dotButton,
        onClick,
        'aria-expanded': expanded,
        'aria-label': toolLabel + ': ' + brief,
        title: toolLabel + ': ' + brief,
      },
      React.createElement('span', { style: expanded ? styles.dotOpen : styles.dot }),
    ),
    expanded
      ? React.createElement(
          'div',
          {
            style: styles.panel,
            role: 'group',
            'aria-label': toolLabel,
            onClick: (event: any) => event.stopPropagation(),
          },
          React.createElement('span', { style: styles.tail, 'aria-hidden': true }),
          React.createElement('div', { style: styles.brief, title: brief }, brief),
          React.createElement(
            'div',
            { style: styles.details },
            detailRow(t, 'detail.phase', phaseLabel),
            detailRow(t, 'detail.time', toolTime),
            turnLabel === undefined ? null : detailRow(t, 'detail.turn', turnLabel),
            argsRow(t, estimateMs, reason),
            toolName === 'time_introspect_stop' && stopMs > 0
              ? detailRow(t, 'detail.introspection', formatMs(stopMs))
              : null,
            toolName === 'time_introspect_shut' || toolName === 'time_introspect_waken'
              ? detailRow(t, 'detail.state', projection?.state ?? '-')
              : null,
            errorText.length > 0
              ? React.createElement(
                  'div',
                  { style: styles.blockRow },
                  React.createElement('div', { style: styles.label }, tr(t, 'detail.error')),
                  React.createElement('pre', { style: styles.preError }, errorText),
                )
              : resultText.length > 0
                ? React.createElement(
                    'div',
                    { style: styles.blockRow },
                    React.createElement('div', { style: styles.label }, tr(t, 'detail.result')),
                    React.createElement('pre', { style: styles.pre }, resultText),
                  )
                : phase === 'result'
                  ? detailRow(t, 'detail.result', tr(t, 'detail.noResult'))
                  : null,
            inspect === undefined
              ? null
              : React.createElement(
                  'button',
                  { type: 'button', style: styles.inspect, onClick: (event: any) => { event.stopPropagation(); inspect() } },
                  tr(t, 'detail.inspect'),
                ),
          ),
        )
      : null,
  )
}

function makeBrief(t: any, input: any): string {
  const { toolName, phase, estimateMs, reason, stopMs, block, toolLabel } = input
  const failed = phase === 'result' && (block?.isError === true || block?.error !== undefined)
  let text: string
  if (phase === 'preparing') {
    text = tr(t, 'brief.preparing', { tool: toolLabel })
  } else if (toolName === 'time_introspect_estimate') {
    text = estimateMs === undefined
      ? tr(t, 'brief.estimatePending')
      : tr(t, 'brief.estimate', { ms: formatMs(estimateMs) })
  } else if (toolName === 'time_introspect_start') {
    text = tr(t, 'brief.start')
  } else if (toolName === 'time_introspect_stop') {
    text = stopMs > 0 ? tr(t, 'brief.stopMs', { ms: formatMs(stopMs) }) : tr(t, 'brief.stop')
  } else if (toolName === 'time_introspect_shut') {
    text = reason ? tr(t, 'brief.shut', { reason: truncate(reason, 60) }) : tr(t, 'brief.shutNoReason')
  } else if (toolName === 'time_introspect_waken') {
    text = reason ? tr(t, 'brief.waken', { reason: truncate(reason, 60) }) : tr(t, 'brief.wakenNoReason')
  } else if (toolName === 'time_introspect_status') {
    text = tr(t, 'brief.status')
  } else {
    text = toolLabel
  }
  return failed ? text + ' · ' + tr(t, 'brief.failed') : text
}

function detailRow(t: any, key: string, value: string) {
  return React.createElement(
    'div',
    { style: styles.row },
    React.createElement('span', { style: styles.label }, tr(t, key)),
    React.createElement('span', { style: styles.value }, value),
  )
}

function argsRow(t: any, estimateMs: number | undefined, reason: string | undefined) {
  if (estimateMs === undefined && !reason) return null
  const values: string[] = []
  if (estimateMs !== undefined) values.push('estimateMs=' + formatMs(estimateMs))
  if (reason) values.push('reason=' + truncate(reason, 500))
  return React.createElement(
    'div',
    { style: styles.row },
    React.createElement('span', { style: styles.label }, tr(t, 'detail.args')),
    React.createElement('span', { style: styles.value }, values.join(' · ')),
  )
}

function tr(t: any, key: string, params?: Record<string, unknown>): string {
  if (typeof t === 'function') {
    try {
      const value = t(key, params)
      if (typeof value === 'string' && value.length > 0 && value !== key) return value
    } catch {
      /* 词典尚未就绪时退回中文. */
    }
  }
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

function readNumber(args: any, key: string): number | undefined {
  if (args === undefined || typeof args.value !== 'function') return undefined
  const value = args.value(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readText(args: any, key: string): string | undefined {
  if (args === undefined || typeof args.text !== 'function') return undefined
  const value = args.text(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function flattenContent(content: any): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block?.text === 'string') parts.push(block.text)
    else if (block !== undefined) {
      try {
        parts.push(JSON.stringify(block))
      } catch {
        /* 非 JSON 块忽略. */
      }
    }
  }
  return parts.join('\n').trim()
}

function readError(block: any): string {
  if (block?.error === undefined || block.error === null) return ''
  try {
    return typeof block.error === 'string' ? block.error : JSON.stringify(block.error)
  } catch {
    return String(block.error)
  }
}

const NO_PROJECTION = () => undefined

function formatMs(ms: number): string {
  const value = Math.max(0, ms)
  if (value < 1000) return Math.round(value) + 'ms'
  if (value < 60000) return (value / 1000).toFixed(1) + 's'
  return (value / 60000).toFixed(1) + 'm'
}

function formatTime(time: unknown): string {
  if (typeof time !== 'number' || !Number.isFinite(time)) return '-'
  try {
    return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return new Date(time).toISOString()
  }
}

function formatDateTime(time: unknown): string {
  if (typeof time !== 'number' || !Number.isFinite(time)) return '-'
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}

function shortTool(toolName: string): string {
  return toolName.startsWith('time_introspect_') ? toolName.slice('time_introspect_'.length) : toolName
}

const h = React.createElement

function IntrospectionTab(props: any) {
  const { useProjection, t } = props
  const projection = (typeof useProjection === 'function' ? useProjection : NO_PROJECTION)('timeIntrospect')
  const archive = Array.isArray(projection?.archive) ? projection.archive : []
  const injections = Array.isArray(projection?.injections) ? projection.injections : []
  const [openArchive, setOpenArchive] = React.useState({})
  const [openInjection, setOpenInjection] = React.useState({})
  const [openDetails, setOpenDetails] = React.useState({})
  const turns = archive.slice().reverse()
  const records = injections.slice().reverse()
  const reflected = injections.filter((record: any) => record?.outcome === 'completed').length

  return h(
    'div',
    { style: styles.page, className: 'dsh-time-introspect-tab' },
    h('style', null, '.dsh-time-introspect-tab::-webkit-scrollbar{display:none}'),
    h(
      'div',
      { style: styles.inner },
      h('h1', { style: styles.title }, tr(t, 'page.title')),
      h('div', { style: styles.subtitle }, tr(t, 'page.subtitle')),
      h(
        'div',
        { style: styles.summary },
        stat(tr(t, 'summary.turns'), String(archive.length)),
        stat(tr(t, 'summary.injections'), String(injections.length)),
        stat(tr(t, 'summary.reflected'), String(reflected)),
      ),
      h(
        'section',
        { style: styles.section },
        h('h2', { style: styles.sectionTitle }, tr(t, 'section.distribution')),
        turns.length === 0
          ? h('div', { style: styles.empty }, tr(t, 'empty.distribution'))
          : turns.map((entry: any) =>
              h(ArchiveCard, {
                key: 'a-' + entry.turn,
                entry,
                t,
                open: openArchive[entry.turn] === true,
                onToggle: () => toggleRecord(setOpenArchive, entry.turn),
                detailsOpen: openDetails[entry.turn] === true,
                onToggleDetails: () => toggleRecord(setOpenDetails, entry.turn),
              }),
            ),
      ),
      h(
        'section',
        { style: styles.section },
        h('h2', { style: styles.sectionTitle }, tr(t, 'section.injections')),
        records.length === 0
          ? h('div', { style: styles.empty }, tr(t, 'empty.injections'))
          : records.map((record: any) => {
              const key = record.turn + '-' + record.time
              return h(InjectionCard, {
                key: 'i-' + key,
                record,
                t,
                open: openInjection[key] === true,
                onToggle: () => toggleRecord(setOpenInjection, key),
              })
            }),
      ),
    ),
  )
}

function ArchiveCard(props: any) {
  const { entry, t, open, onToggle, detailsOpen, onToggleDetails } = props
  const details = entry?.time_consume_details ?? {}
  const tool = details.tool ?? {}
  const model = details.model ?? {}
  const introspection = details.introspect ?? {}
  const toolDetails = Array.isArray(tool.details) ? tool.details : []
  const introspectionToolDetails = Array.isArray(introspection?.details?.tool?.details)
    ? introspection.details.tool.details
    : []
  const hasDetails = toolDetails.length > 0 || introspectionToolDetails.length > 0
  const estimate = typeof entry?.estimate_ms === 'number' ? entry.estimate_ms : null
  const overrun = typeof entry?.overrun_ms === 'number' ? entry.overrun_ms : null
  const ratio = typeof entry?.overrun_ratio === 'number' ? entry.overrun_ratio : null
  const overrunLabel = estimate === null
    ? tr(t, 'card.noEstimate')
    : overrun !== null && overrun > 0
      ? '+' + formatMs(overrun) + ' (' + formatPercent(ratio) + ')'
      : tr(t, 'card.noOverrun')

  return h(
    'div',
    { style: styles.card },
    h(
      'button',
      {
        type: 'button',
        style: styles.cardHeader,
        onClick: onToggle,
        'aria-expanded': open,
      },
      h('span', { style: styles.turnBadge }, '#' + String(entry?.turn ?? '?')),
      h('span', { style: styles.cardTitle }, tr(t, 'card.turn', { turn: entry?.turn ?? '?' })),
      h('span', { style: styles.cardMeta }, tr(t, 'card.actual') + ' ' + formatMs(Number(entry?.time_consume_total_ms ?? 0))),
      h(
        'span',
        { style: { ...styles.badge, ...(overrun === null ? styles.badgeGray : styles.badgeAmber) } },
        overrunLabel,
      ),
      h('span', { style: styles.chevron }, open ? '-' : '+'),
    ),
    open
      ? h(
          'div',
          { style: styles.cardBody },
          infoRow(t, 'card.estimate', estimate === null ? '—' : formatMs(estimate)),
          infoRow(t, 'card.actual', formatMs(Number(entry?.time_consume_total_ms ?? 0))),
          infoRow(t, 'card.overrun', overrun === null ? '—' : formatDelta(overrun)),
          infoRow(t, 'card.ratio', formatPercent(ratio)),
          categoryRow(t, 'category.tool', tool),
          categoryRow(t, 'category.model', model),
          categoryRow(t, 'category.introspect', introspection),
          hasDetails
            ? h(
                'button',
                {
                  type: 'button',
                  style: styles.detailsButton,
                  onClick: onToggleDetails,
                  'aria-expanded': detailsOpen,
                },
                tr(t, detailsOpen ? 'details.hide' : 'details.show'),
              )
            : null,
          detailsOpen ? toolTable(t, toolDetails, 'details.tools') : null,
          detailsOpen ? toolTable(t, introspectionToolDetails, 'details.introspectionTools') : null,
        )
      : null,
  )
}

function InjectionCard(props: any) {
  const { record, t, open, onToggle } = props
  const outcome = record?.outcome ?? 'pending'
  const estimate = typeof record?.estimate_ms === 'number' ? record.estimate_ms : null
  const actual = Number(record?.actual_ms ?? 0)
  const overrun = typeof record?.overrun_ms === 'number' ? record.overrun_ms : null
  const ratio = typeof record?.overrun_ratio === 'number' ? record.overrun_ratio : null
  const introspectionMs = Number(record?.introspection_ms ?? 0)

  return h(
    'div',
    { style: styles.card },
    h(
      'button',
      {
        type: 'button',
        style: styles.cardHeader,
        onClick: onToggle,
        'aria-expanded': open,
      },
      h('span', { style: styles.turnBadge }, '#' + String(record?.turn ?? '?')),
      h('span', { style: styles.cardTitle }, tr(t, 'injection.turn', { turn: record?.turn ?? '?' })),
      h('span', { style: styles.cardMeta }, tr(t, 'injection.about', { turn: record?.aboutTurn ?? '?' })),
      h('span', { style: outcomeBadgeStyle(outcome) }, tr(t, 'outcome.' + outcome)),
      h(
        'span',
        { style: styles.cardMeta },
        record?.completed || introspectionMs > 0 ? formatMs(introspectionMs) : '—',
      ),
      h('span', { style: styles.chevron }, open ? '-' : '+'),
    ),
    open
      ? h(
          'div',
          { style: styles.cardBody },
          infoRow(t, 'card.estimate', estimate === null ? '—' : formatMs(estimate)),
          infoRow(t, 'card.actual', formatMs(actual)),
          infoRow(t, 'card.overrun', overrun === null ? '—' : formatDelta(overrun)),
          infoRow(t, 'card.ratio', formatPercent(ratio)),
          infoRow(t, 'injection.started', tr(t, record?.started ? 'value.yes' : 'value.no')),
          infoRow(t, 'injection.completed', tr(t, record?.completed ? 'value.yes' : 'value.no')),
          infoRow(t, 'injection.reflection', record?.completed || introspectionMs > 0 ? formatMs(introspectionMs) : '—'),
          infoRow(t, 'injection.outcome', tr(t, 'outcome.' + outcome)),
          infoRow(t, 'injection.time', formatDateTime(record?.time)),
        )
      : null,
  )
}

function stat(label: string, value: string) {
  return h(
    'div',
    { style: styles.stat },
    h('div', { style: styles.statValue }, value),
    h('div', { style: styles.statLabel }, label),
  )
}

function infoRow(t: any, labelKey: string, value: string) {
  return h(
    'div',
    { style: styles.row },
    h('span', { style: styles.label }, tr(t, labelKey)),
    h('span', { style: styles.value }, value),
  )
}

function categoryRow(t: any, labelKey: string, category: any) {
  const total = Number(category?.total_ms ?? 0)
  const ratio = typeof category?.ratio === 'number' ? category.ratio : null
  return h(
    'div',
    { style: styles.row },
    h('span', { style: styles.label }, tr(t, labelKey)),
    h('span', { style: styles.value }, formatMs(total) + ' / ' + formatPercent(ratio)),
  )
}

function toolTable(t: any, entries: any[], titleKey: string) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  return h(
    'div',
    null,
    h('div', { style: styles.subheading }, tr(t, titleKey)),
    h(
      'table',
      { style: styles.table },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { style: styles.th }, tr(t, 'table.name')),
          h('th', { style: styles.thNum }, tr(t, 'table.calls')),
          h('th', { style: styles.thNum }, tr(t, 'table.ms')),
          h('th', { style: styles.thNum }, tr(t, 'table.ratio')),
        ),
      ),
      h(
        'tbody',
        null,
        entries.map((entry: any) =>
          h(
            'tr',
            { key: String(entry?.name ?? '') },
            h('td', { style: styles.td }, String(entry?.name ?? '')),
            h('td', { style: styles.tdNum }, String(entry?.calls ?? 0)),
            h('td', { style: styles.tdNum }, formatMs(Number(entry?.ms ?? 0))),
            h('td', { style: styles.tdNum }, formatPercent(typeof entry?.ratio === 'number' ? entry.ratio : null)),
          ),
        ),
      ),
    ),
  )
}

function outcomeBadgeStyle(outcome: string): any {
  const base = { ...styles.badge }
  if (outcome === 'completed') return { ...base, ...styles.badgeGreen }
  if (outcome === 'incomplete') return { ...base, ...styles.badgeAmber }
  if (outcome === 'aborted') return { ...base, ...styles.badgeRed }
  if (outcome === 'open') return { ...base, ...styles.badgeBlue }
  return { ...base, ...styles.badgeGray }
}

function toggleRecord(setter: any, key: string | number) {
  setter((previous: any) => ({ ...previous, [key]: previous[key] !== true }))
}

function formatDelta(ms: number): string {
  if (ms === 0) return '0ms'
  return (ms > 0 ? '+' : '-') + formatMs(Math.abs(ms))
}

function formatPercent(ratio: number | null | undefined): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '—'
  return (ratio * 100).toFixed(1) + '%'
}

const styles: Record<string, any> = {
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    margin: '2px 0',
    minWidth: 0,
    font: 'inherit',
  },
  dotButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    padding: 0,
    marginTop: '2px',
    border: 0,
    background: 'transparent',
    cursor: 'pointer',
    flex: '0 0 auto',
    borderRadius: '50%',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--dsw-alias-state-error-primary, #e5484d)',
    display: 'block',
  },
  dotOpen: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--dsw-alias-state-error-primary, #e5484d)',
    display: 'block',
    boxShadow: '0 0 0 3px rgba(229, 72, 77, 0.18)',
  },
  panel: {
    position: 'relative',
    minWidth: 0,
    maxWidth: '100%',
    flex: '0 1 auto',
    padding: '6px 10px',
    border: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.12))',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2329)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  tail: {
    position: 'absolute',
    left: '-4.5px',
    top: '10px',
    width: '8px',
    height: '8px',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    borderLeft: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.12))',
    borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.12))',
    transform: 'rotate(45deg)',
  },
  brief: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontWeight: 500,
    fontSize: '12px',
  },
  details: {
    marginTop: '4px',
    paddingTop: '4px',
    borderTop: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.08))',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  row: {
    display: 'flex',
    gap: '8px',
    minWidth: 0,
  },
  blockRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  label: {
    flex: '0 0 auto',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    fontSize: '11px',
    minWidth: '48px',
  },
  value: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    wordBreak: 'break-word',
    fontSize: '11px',
  },
  pre: {
    margin: 0,
    padding: '4px 6px',
    maxHeight: '160px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderRadius: '4px',
    background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.03))',
    fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    fontSize: '10.5px',
    lineHeight: 1.45,
  },
  preError: {
    margin: 0,
    padding: '4px 6px',
    maxHeight: '160px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderRadius: '4px',
    background: 'rgba(229, 72, 77, 0.10)',
    color: 'var(--dsw-alias-state-error-primary, #e5484d)',
    fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    fontSize: '10.5px',
    lineHeight: 1.45,
  },
  page: {
    height: '100%',
    overflowY: 'auto',
    padding: '24px 20px 48px',
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary, #1f2329)',
    font: 'inherit',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  inner: {
    maxWidth: '960px',
    margin: '0 auto',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    lineHeight: 1.3,
    fontWeight: 600,
  },
  subtitle: {
    marginTop: '6px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '8px',
    marginTop: '16px',
  },
  stat: {
    padding: '10px 12px',
    border: '0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  },
  statValue: {
    fontSize: '18px',
    lineHeight: 1.2,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: {
    marginTop: '2px',
    fontSize: '11px',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  section: {
    marginTop: '24px',
  },
  sectionTitle: {
    margin: '0 0 10px',
    fontSize: '14px',
    fontWeight: 600,
  },
  empty: {
    padding: '16px 0',
    fontSize: '12px',
    lineHeight: 1.6,
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  card: {
    marginBottom: '10px',
    border: '0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px 12px',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  turnBadge: {
    flex: '0 0 auto',
    padding: '1px 6px',
    border: '0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14))',
    borderRadius: '999px',
    fontSize: '10.5px',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  cardTitle: {
    minWidth: 0,
    fontSize: '12.5px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    fontSize: '11.5px',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    whiteSpace: 'nowrap',
  },
  chevron: {
    marginLeft: 'auto',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    fontSize: '14px',
    lineHeight: 1,
  },
  cardBody: {
    padding: '0 12px 12px',
    borderTop: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.08))',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '3px 0',
    fontSize: '12px',
  },
  label: {
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  value: {
    textAlign: 'right',
    color: 'var(--dsw-alias-label-primary, #1f2329)',
    fontVariantNumeric: 'tabular-nums',
  },
  badge: {
    padding: '1px 6px',
    borderRadius: '999px',
    fontSize: '10.5px',
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  },
  badgeGreen: {
    background: 'rgba(34, 197, 94, 0.12)',
    color: '#15803d',
  },
  badgeAmber: {
    background: 'rgba(245, 158, 11, 0.14)',
    color: '#b45309',
  },
  badgeRed: {
    background: 'rgba(229, 72, 77, 0.12)',
    color: 'var(--dsw-alias-state-error-primary, #e5484d)',
  },
  badgeBlue: {
    background: 'rgba(77, 107, 254, 0.12)',
    color: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
  },
  badgeGray: {
    background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04))',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
  },
  detailsButton: {
    alignSelf: 'flex-start',
    marginTop: '8px',
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '11.5px',
  },
  table: {
    width: '100%',
    marginTop: '6px',
    borderCollapse: 'collapse',
    fontSize: '11.5px',
  },
  th: {
    padding: '4px 6px',
    borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.08))',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    fontWeight: 500,
    textAlign: 'center',
  },
  thNum: {
    padding: '4px 6px',
    borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.08))',
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    fontWeight: 500,
    textAlign: 'center',
  },
  td: {
    padding: '4px 6px',
    borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.06))',
    textAlign: 'center',
  },
  tdNum: {
    padding: '4px 6px',
    borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.06))',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  subheading: {
    marginTop: '8px',
    fontSize: '11.5px',
    fontWeight: 600,
  },
  inspect: {
    alignSelf: 'flex-start',
    marginTop: '2px',
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '11px',
  },
}