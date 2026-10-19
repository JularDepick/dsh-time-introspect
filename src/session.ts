/* 主会话判定. */

import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** 判断一个会话是否为主会话. 子代理会话一律不启用本插件. */
export function isMainHeader(header: SessionHeader | undefined): boolean {
  if (header === undefined) return false
  return (header.delegationDepth ?? 0) === 0 && header.origin !== 'subagent'
}
