import { copyFile, lstat, mkdir, rm, rmdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = import.meta.dir ?? path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(moduleDir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const buildScript = path.join(desktopRoot, 'scripts', 'build-sidecars.ts')

function isAsciiPath(value: string | undefined): boolean {
  return !!value && /^[\x00-\x7F]+$/.test(value)
}

export function shouldUseWindowsAsciiBuildLauncher(
  platform: NodeJS.Platform = process.platform,
  workspacePath = repoRoot,
  executablePath = process.execPath,
  tempPath = process.env.TEMP || process.env.TMP,
): boolean {
  if (platform !== 'win32') return false
  return ![workspacePath, executablePath, tempPath].every(isAsciiPath)
}

async function removeOwnedJunction(junctionPath: string): Promise<void> {
  try {
    const metadata = await lstat(junctionPath)
    if (!metadata.isSymbolicLink()) {
      throw new Error(`Refusing to remove non-junction temporary path: ${junctionPath}`)
    }
    await rmdir(junctionPath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function runThroughAsciiWorkspace(): Promise<void> {
  const stageRoot = path.join('C:\\', `ccj-sidecar-build-${process.pid}-${Date.now()}`)
  const stagedBun = path.join(stageRoot, 'bun.exe')
  const stagedTemp = path.join(stageRoot, 'temp')
  const sourceJunction = path.join(stageRoot, 'source')

  await mkdir(stagedTemp, { recursive: true })
  await copyFile(process.execPath, stagedBun)
  await symlink(repoRoot, sourceJunction, 'junction')

  try {
    const inheritedPath = process.env.Path || process.env.PATH || ''
    const child = Bun.spawn({
      cmd: [stagedBun, 'run', './scripts/build-sidecars.ts'],
      cwd: path.join(sourceJunction, 'desktop'),
      env: {
        ...process.env,
        BUN_INSTALL: stageRoot,
        PATH: [stageRoot, inheritedPath].filter(Boolean).join(';'),
        Path: [stageRoot, inheritedPath].filter(Boolean).join(';'),
        TEMP: stagedTemp,
        TMP: stagedTemp,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await child.exited
    if (exitCode !== 0) {
      throw new Error(`[build-sidecars] ASCII launcher child exited with code ${exitCode}`)
    }
  } finally {
    await removeOwnedJunction(sourceJunction)
    await rm(stagedBun, { force: true })
    await rm(stagedTemp, { recursive: true, force: true })
    await rmdir(stageRoot).catch((error: any) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

export async function runBuildSidecars(): Promise<void> {
  if (!shouldUseWindowsAsciiBuildLauncher()) {
    await import('./build-sidecars.ts')
    return
  }

  console.log('[build-sidecars] Windows Unicode path detected; using a temporary ASCII Bun/workspace launcher.')
  await runThroughAsciiWorkspace()
}

if (import.meta.main) {
  await runBuildSidecars()
}
