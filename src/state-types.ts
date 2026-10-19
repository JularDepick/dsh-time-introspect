/* 投影状态的数据形状, 必须保持为纯 JSON. */

/** 插件生命周期状态. */
export type PluginState = 'active' | 'dormant'

/** 单个工具在本轮内的聚合耗时. */
export interface ToolAggregate {
  ms: number
  calls: number
}

/** 单轮耗时记账. */
export interface TurnRecord {
  turn: number
  startTime: number
  endTime: number | null
  estimateMs: number | null
  /** 反思窗口外的工具耗时. */
  toolMs: Record<string, ToolAggregate>
  /** 反思窗口的可观测总时长. */
  reflectionMs: number
  /** 反思窗口内的工具耗时, 用于反思内部明细. */
  reflectionTools: Record<string, ToolAggregate>
  reflectionOpen: boolean
  /** 本轮是否已经用过一次反思机会; 关闭后也不再允许重新开始. */
  reflectionStarted: boolean
  reflectionStartTime: number | null
  /** 本轮是否已经注入过耗时报告. */
  injectionDone: boolean
}

/** 一个尚未返回结果的工具调用. */
export interface OpenCall {
  name: string
  time: number
  arguments: string
  /** 调用开始时是否处于反思窗口内. */
  inReflection: boolean
}

/** 逐会话折叠状态. */
export interface IntrospectState {
  turns: TurnRecord[]
  openCalls: Record<string, OpenCall>
  state: PluginState
  wakenPending: boolean
  wakenReason: string | null
}