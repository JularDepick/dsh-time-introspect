/* 归档落盘: 每个会话在 profile 下写一个 JSON, 只供用户展示. */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { PLUGIN_NAME, PROJECTION_KEY } from './constants.js'
import { isMainHeader } from './session.js'

/** 归档写盘队列, 同一文件按提交顺序串行. */
const queues = new Map<string, Promise<void>>()

/** 注册 turn/end 归档写盘; 进程内失败只告警, 不影响注入与 agent. */
export function registerArchiveWriter(ctx: Context): void {
  const profileDir = resolveProfileDir(ctx)
  if (profileDir === null) {
    ctx.logger?.warn('time-introspect: profile directory not found; archive files will not be written')
    return
  }
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'turn/end') return
    if (!isMainHeader(session.header)) return
    queueMicrotask(() => {
      const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
      if (state === undefined) return
      scheduleWrite(ctx, profileDir, session, state.archive, state.injections)
    })
  })
}

/** 从运行期 baseUrl 或 DSH_HOME 的 profile 清单解析当前 profile 目录. */
export function resolveProfileDir(ctx: Context): string | null {
  const base = ctx.baseUrl
  if (typeof base === 'string') {
    try {
      const normalized = base.endsWith('/') ? base : base + '/'
      let current = resolve(fileURLToPath(new URL('.', normalized)))
      for (let depth = 0; depth < 8; depth += 1) {
        if (basename(dirname(current)) === 'profiles') return current
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
    } catch {
      /* baseUrl 不是文件 URL 时继续尝试 DSH_HOME. */
    }
  }
  const homePath = ctx.get('dshHomePath')
  if (typeof homePath !== 'function') return null
  try {
    const profiles = homePath('profiles')
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(profiles, entry.name, 'package.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          dsh?: { profile?: { bundles?: unknown } }
        }
        const bundles = manifest.dsh?.profile?.bundles
        if (Array.isArray(bundles) && bundles.includes(PLUGIN_NAME)) {
          return join(profiles, entry.name)
        }
      } catch {
        /* 跳过没有可读 manifest 的目录. */
      }
    }
  } catch {
    /* profile 目录不可读时放弃. */
  }
  return null
}

function scheduleWrite(
  ctx: Context,
  profileDir: string,
  session: Session,
  archive: unknown[],
  injections: unknown[],
): void {
  const sessionId = String(session.id)
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
  const dir = join(profileDir, 'time-introspect')
  const file = join(dir, `${safe}.json`)
  const payload = {
    type: 'time_introspect_archive',
    version: 1,
    sessionId,
    updatedAt: Date.now(),
    archive,
    injections,
  }
  const previous = queues.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dir, { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      try {
        await rename(temp, file)
      } catch (error) {
        await unlink(temp).catch(() => undefined)
        throw error
      }
    })
    .catch((error: unknown) => {
      ctx.logger?.warn('time-introspect: failed to write archive', error)
    })
  queues.set(file, next)
}