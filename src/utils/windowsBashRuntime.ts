import * as pathWin32 from 'path/win32'

export type GitBashPathResolution = {
  configuredPath?: string | undefined
  systemGitPath?: string | null | undefined
  bundledBashPath?: string | undefined
  pathExists: (candidate: string) => boolean
}

export function resolveGitBashPath({
  configuredPath,
  systemGitPath,
  bundledBashPath,
  pathExists,
}: GitBashPathResolution): string | null {
  if (configuredPath) {
    return pathExists(configuredPath) ? configuredPath : null
  }

  if (systemGitPath) {
    const systemBashPath = pathWin32.join(systemGitPath, '..', '..', 'bin', 'bash.exe')
    if (pathExists(systemBashPath)) return systemBashPath
  }

  if (bundledBashPath && pathExists(bundledBashPath)) {
    return bundledBashPath
  }

  return null
}

