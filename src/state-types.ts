/* 投影状态的数据形状, 必须保持为纯 JSON. */

import type { InjectionJson, InjectionRecord } from './report-types.js'

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
  introspectionMs: number
  /** 反思窗口内的工具耗时, 用于反思内部明细. */
  introspectionTools: Record<string, ToolAggregate>
  introspectionOpen: boolean
  /** 本轮是否已经用过一次反思机会; 关闭后也不再允许重新开始. */
  introspectionStarted: boolean
  introspectionStartTime: number | null
  /** 本轮是否已经注入过耗时报告. */
  injectionDone: boolean
}

/** 一个尚未返回结果的工具调用. */
export interface OpenCall {
  name: string
  time: number
  arguments: string
  /** 调用开始时是否处于反思窗口内. */
  inIntrospection: boolean
  /** PTC 子调用的父调用 id; 原生调用为 null. */
  parentCallId: string | null
  /** 已结算子调用的累计耗时, 结算时从自身耗时中扣除. */
  nestedMs: number
}

/** 逐会话折叠状态. */
export interface IntrospectState {
  turns: TurnRecord[]
  openCalls: Record<string, OpenCall>
  state: PluginState
  wakenPending: boolean
  wakenReason: string | null
  /** 每轮耗时报告归档, 只用于用户展示. */
  archive: InjectionJson[]
  /** 每次注入与注入后反思状态的用户侧记录. */
  injections: InjectionRecord[]
}