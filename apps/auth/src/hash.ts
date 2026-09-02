import { readFileSync } from 'node:fs'
import { hashPassword } from 'portta-core'

const password = readFileSync(0, 'utf8').replace(/[\r\n]+$/, '')
if (!password) throw new Error('no password on stdin')
process.stdout.write(`${await hashPassword(password)}\n`)
