/* 投影状态的数据形状, 必须保持为纯 JSON. */

/** 反思的三种生命周期状态. */
export type ReflectionStatus = 'active' | 'cooling' | 'dormant'

/** 注入消息的形态; notice 只用于休眠通知. */
export type InjectionForm = 'reflection' | 'notice'

/** 单轮耗时记账. */
export interface TurnRecord {
  turn: number
  startTime: number
  endTime: number | null
  estimateMs: number | null
  /** 按工具名聚合的实际执行耗时; 反思工具不计入. */
  toolMs: Record<string, number>
  toolCalls: number
  /** 从注入时刻到反思阶段结束的可观测耗时. */
  reflectionMs: number
  injectionTime: number | null
  injectionForm: InjectionForm | null
  /** 反思窗口是否仍等待结束标记. */
  windowOpen: boolean
}

/** 一个尚未返回结果的工具调用. */
export interface OpenCall {
  name: string
  time: number
}

/** 逐会话折叠状态. */
export interface IntrospectState {
  turns: TurnRecord[]
  openCalls: Record<string, OpenCall>
  status: ReflectionStatus
  coolingRemaining: number
  cooldownCount: number
  highStreak: number
  conservativeRemaining: number
  noticePending: boolean
  noticeEmitted: boolean
  restartReason: string | null
  restartPrefixPending: boolean
  everInjected: boolean
}
