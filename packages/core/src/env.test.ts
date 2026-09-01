import { describe, expect, it } from 'vitest'
import { mergeEnvironment, parseEnv, setEnvValue } from './env.js'

describe('environment files', () => {
  it('parses without evaluating shell syntax', () => {
    const env = parseEnv("A=one\nB='two words'\nBAD LINE\nC=`touch /tmp/nope`\n")
    expect(Object.fromEntries(env)).toEqual({ A: 'one', B: 'two words', C: '`touch /tmp/nope`' })
  })
  it('lets the process environment win', () => expect(mergeEnvironment(new Map([['A', 'file']]), { A: 'process' }).A).toBe('process'))
  it('updates one key and preserves surrounding text', () => expect(setEnvValue('# x\nA=old\n', 'A', 'new')).toBe('# x\nA=new\n'))
})
