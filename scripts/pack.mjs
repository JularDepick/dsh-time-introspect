#!/usr/bin/env node
/* 打包脚本: 把 npm pack 产物统一放进 release/ 目录. */

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'release')
mkdirSync(destination, { recursive: true })

const npmCli = process.env.npm_execpath
const command = npmCli === undefined ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath
const args = npmCli === undefined
  ? ['pack', '--pack-destination', destination]
  : [npmCli, 'pack', '--pack-destination', destination]

const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: npmCli === undefined && process.platform === 'win32',
})
process.exit(result.status ?? 1)
