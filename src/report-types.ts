/* 注入与归档共用的耗时报告数据形状. */

/** 单条工具耗时项. */
export interface ToolEntry {
  name: string
  calls: number
  ms: number
  ratio: number
}

/** 注入 JSON 与归档记录共用的完整结构; 归档的非触发轮次用 null 表示缺失的总账字段. */
export interface InjectionJson {
  type: 'time_introspect'
  desc: string
  turn: number
  waken?: { reason: string }
  estimate_ms: number | null
  overrun_ms: number | null
  overrun_ratio: number | null
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

/** 一次注入之后的反思状态. */
export type IntrospectionOutcome = 'pending' | 'open' | 'completed' | 'incomplete' | 'not_started' | 'aborted'

/** 一次耗时报告注入的用户侧记录. */
export interface InjectionRecord {
  /** 注入发生的轮次. */
  turn: number
  /** 注入消息时间. */
  time: number
  /** 被统计的上一轮. */
  aboutTurn: number
  estimate_ms: number | null
  actual_ms: number
  overrun_ms: number | null
  overrun_ratio: number | null
  started: boolean
  completed: boolean
  introspection_ms: number
  outcome: IntrospectionOutcome
}
