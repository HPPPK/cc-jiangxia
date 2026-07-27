import { describe, expect, it } from 'bun:test'

import { resolveGitBashPath } from './windowsBashRuntime.js'

describe('resolveGitBashPath', () => {
  it('keeps an explicitly configured user Bash path ahead of system or bundled runtimes', () => {
    const configured = 'D:\\Tools\\bash.exe'
    expect(resolveGitBashPath({
      configuredPath: configured,
      systemGitPath: 'C:\\Program Files\\Git\\cmd\\git.exe',
      bundledBashPath: 'C:\\App\\mingit\\bin\\bash.exe',
      pathExists: (candidate) => candidate === configured,
    })).toBe(configured)
  })

  it('uses an existing system Git Bash before the packaged fallback', () => {
    const systemGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
    const systemBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(resolveGitBashPath({
      systemGitPath: systemGit,
      bundledBashPath: 'C:\\App\\mingit\\bin\\bash.exe',
      pathExists: (candidate) => candidate === systemBash,
    })).toBe(systemBash)
  })

  it('uses the packaged Bash only when no usable system Git Bash exists', () => {
    const bundled = 'C:\\App\\mingit\\bin\\bash.exe'
    expect(resolveGitBashPath({
      systemGitPath: null,
      bundledBashPath: bundled,
      pathExists: (candidate) => candidate === bundled,
    })).toBe(bundled)
  })
})

