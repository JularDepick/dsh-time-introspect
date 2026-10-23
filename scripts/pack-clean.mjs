#!/usr/bin/env node
/* postpack: 把 npm pack 在根目录生成的 tgz 移入 release/, 根目录不保留. */

import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'release')
mkdirSync(destination, { recursive: true })

for (const name of readdirSync(root)) {
  if (!name.endsWith('.tgz')) continue
  const source = join(root, name)
  if (!statSync(source).isFile()) continue
  const target = join(destination, name)
  rmSync(target, { force: true })
  renameSync(source, target)
  console.log(`moved ${name} -> release/`)
}
