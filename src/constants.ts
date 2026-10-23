/* 插件标识, 工具名与边界常量. */

/** Cordis 插件名, 同时作为注入消息的来源 kind. */
export const PLUGIN_NAME = 'dsh-time-introspect'

/** 注入消息的来源 kind. */
export const SOURCE_KIND = PLUGIN_NAME

/** 会话投影 key. */
export const PROJECTION_KEY = 'timeIntrospect'

/** 投影状态版本; 折叠语义或字段变化时递增. */
export const PROJECTION_STATE_VERSION = 5

/** 工具名统一前缀. */
export const TOOL_PREFIX = 'time_introspect_'

/** 登记本轮预估. */
export const ESTIMATE_TOOL = `${TOOL_PREFIX}estimate`

/** 开始反思计时. */
export const START_TOOL = `${TOOL_PREFIX}start`

/** 结束反思计时. */
export const STOP_TOOL = `${TOOL_PREFIX}stop`

/** 让插件休眠. */
export const SHUT_TOOL = `${TOOL_PREFIX}shut`

/** 重启插件. */
export const WAKEN_TOOL = `${TOOL_PREFIX}waken`

/** 只读状态查询. */
export const STATUS_TOOL = `${TOOL_PREFIX}status`

/** 全部工具名, 用于子代理隐藏与提示. */
export const ALL_TOOLS = [
  ESTIMATE_TOOL,
  START_TOOL,
  STOP_TOOL,
  SHUT_TOOL,
  WAKEN_TOOL,
  STATUS_TOOL,
] as const

/** 单条预估允许的最大值(24 小时). */
export const MAX_ESTIMATE_MS = 24 * 60 * 60 * 1000

/** 归档与注入记录保留的最大轮数. */
export const MAX_ARCHIVE_TURNS = 200

/** reason 参数的最大长度. */
export const MAX_REASON_CHARS = 500

/** 预估工具参数中的毫秒字段名. */
export const ESTIMATE_ARGUMENT_KEY = 'estimateMs'