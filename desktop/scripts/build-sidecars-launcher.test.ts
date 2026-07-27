import { describe, expect, it } from 'vitest'
import { shouldUseWindowsAsciiBuildLauncher } from './build-sidecars-launcher.js'

describe('Windows Sidecar build launcher', () => {
  it('uses an ASCII staging workspace when a Windows input path is non-ASCII', () => {
    expect(shouldUseWindowsAsciiBuildLauncher(
      'win32',
      'C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia',
      'C:\\Users\\潘婧瑜\\.bun\\bin\\bun.exe',
      'C:\\Users\\潘婧瑜\\AppData\\Local\\Temp',
    )).toBe(true)
  })

  it('does not stage an all-ASCII Windows invocation', () => {
    expect(shouldUseWindowsAsciiBuildLauncher(
      'win32',
      'C:\\work\\cc-jiangxia',
      'C:\\tools\\bun.exe',
      'C:\\temp',
    )).toBe(false)
  })

  it('does not change non-Windows builds', () => {
    expect(shouldUseWindowsAsciiBuildLauncher(
      'linux',
      '/work/cc-jiangxia',
      '/usr/local/bin/bun',
      '/tmp',
    )).toBe(false)
  })
})
