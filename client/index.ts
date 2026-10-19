/* 浏览器半端: 在每条本插件工具调用处渲染红点气泡. */

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

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}

function shortTool(toolName: string): string {
  return toolName.startsWith('time_introspect_') ? toolName.slice('time_introspect_'.length) : toolName
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