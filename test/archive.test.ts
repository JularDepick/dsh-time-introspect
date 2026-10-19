/* profile 归档路径与落盘测试. */

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { registerArchiveWriter, resolveProfileDir } from '../src/archive.js'

const root = join(process.cwd(), 'temp', 'archive-writer-test')
const profileDir = join(root, 'profiles', 'demo')

function fakeContext(baseUrl: string | undefined) {
  const listeners: Array<(session: any, event: any) => void> = []
  return {
    listeners,
    baseUrl,
    get: () => undefined,
    logger: { warn: () => undefined },
    on(event: string, listener: (session: any, payload: any) => void) {
      if (event === 'session/event') listeners.push(listener)
      return () => {}
    },
    sessionProjections: {
      stateOf: () => ({
        archive: [{ type: 'time_introspect', turn: 1 }],
        injections: [{ turn: 2 }],
      }),
    },
  }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveProfileDir', () => {
  test('从 profile 目录或包目录向上找到 profiles/<name>', () => {
    mkdirSync(profileDir, { recursive: true })
    const profileUrl = pathToFileURL(profileDir + '/').href
    expect(resolveProfileDir(fakeContext(profileUrl) as never)).toBe(profileDir)
    const packageUrl = pathToFileURL(join(profileDir, 'node_modules', 'dsh-time-introspect') + '/').href
    expect(resolveProfileDir(fakeContext(packageUrl) as never)).toBe(profileDir)
    expect(resolveProfileDir(fakeContext(undefined) as never)).toBeNull()
  })
})

describe('registerArchiveWriter', () => {
  test('turn/end 后把归档与会话记录写入 profile', async () => {
    mkdirSync(profileDir, { recursive: true })
    const ctx = fakeContext(pathToFileURL(profileDir + '/').href)
    registerArchiveWriter(ctx as never)
    expect(ctx.listeners).toHaveLength(1)
    const session = { id: 'session-1', header: { delegationDepth: 0 } }
    ctx.listeners[0]?.(session, { type: 'turn/end' })
    await new Promise((resolve) => setTimeout(resolve, 40))
    const file = join(profileDir, 'time-introspect', 'session-1.json')
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    expect(payload.type).toBe('time_introspect_archive')
    expect(payload.sessionId).toBe('session-1')
    expect(payload.archive[0].turn).toBe(1)
    expect(payload.injections[0].turn).toBe(2)
  })
})