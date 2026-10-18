/* 注入消息来源, 投影状态与会话事件相关类型. */

import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { IntrospectState } from './state-types.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /* 由 dsh-time-introspect 注入的耗时反思与休眠通知; 字面量必须与 constants.ts 的 SOURCE_KIND 一致. */
    'dsh-time-introspect': {
      readonly kind: 'dsh-time-introspect'
    } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /* 逐会话的耗时反思折叠状态. */
    timeIntrospect: IntrospectState
  }
}