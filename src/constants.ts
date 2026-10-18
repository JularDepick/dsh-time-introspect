/* 插件在 dsh 运行时中的稳定标识与工具名. */

/** Cordis 插件名, 同时作为注入消息的来源 kind. */
export const PLUGIN_NAME = 'dsh-time-introspect'

/** 注入消息的来源 kind, 必须非空且不等于保留值 plugin. */
export const SOURCE_KIND = PLUGIN_NAME

/** 会话投影 key, 只在本插件内使用. */
export const PROJECTION_KEY = 'timeIntrospect'

/** 投影状态版本; 折叠语义或字段变化时递增. */
export const PROJECTION_STATE_VERSION = 1

/** 模型用于登记耗时预估的工具名. */
export const ESTIMATE_TOOL = 'task_estimate'

/** 模型用于结束反思阶段计时的工具名. */
export const REFLECTION_COST_TOOL = 'report_reflection_cost'

/** 模型用于在休眠后主动重启反思的工具名. */
export const RESUME_TOOL = 'resume_reflection'

/** 单条预估允许的最大值(24 小时), 防止异常参数污染统计. */
export const MAX_ESTIMATE_MS = 24 * 60 * 60 * 1000

/** 预估工具参数中的毫秒字段名. */
export const ESTIMATE_ARGUMENT_KEY = 'estimateMs'
