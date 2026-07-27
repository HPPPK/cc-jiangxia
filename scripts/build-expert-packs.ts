import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipPackAdapter } from '../src/server/services/zipPackAdapter.js'

type BuildBundledExpertPacksOptions = {
  sourceDir?: string
  outputDir?: string
}

const repoRoot = path.resolve(import.meta.dir, '..')
const defaultSourceDir = path.join(repoRoot, 'experts')
const defaultOutputDir = path.join(repoRoot, 'src', 'server', 'packs', 'experts')
const adapter = new ZipPackAdapter()

export async function buildBundledExpertPacks(options: BuildBundledExpertPacksOptions = {}): Promise<string[]> {
  const sourceDir = path.resolve(options.sourceDir ?? defaultSourceDir)
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir)
  const entries = await readdir(sourceDir, { withFileTypes: true })
  const outputs: string[] = []

  await mkdir(outputDir, { recursive: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue

    const packRoot = path.join(sourceDir, entry.name)
    const manifest = JSON.parse(await readFile(path.join(packRoot, 'manifest.json'), 'utf8')) as {
      packId?: unknown
      type?: unknown
      entrypoints?: { experts?: unknown }
    }
    if (manifest.type !== 'expert-pack' || typeof manifest.packId !== 'string' || !manifest.packId.trim()) {
      throw new Error(`Invalid Expert Pack manifest in ${packRoot}`)
    }
    const expertEntrypoint = Array.isArray(manifest.entrypoints?.experts) ? manifest.entrypoints?.experts[0] : undefined
    if (typeof expertEntrypoint !== 'string' || !expertEntrypoint.startsWith('experts/') || !expertEntrypoint.endsWith('/expert.json')) {
      throw new Error(`Expert Pack must declare one experts/<id>/expert.json entrypoint: ${packRoot}`)
    }

    const expertRoot = path.posix.dirname(expertEntrypoint)
    const files = await collectFiles(packRoot)
    const zipEntries: Record<string, Uint8Array> = {}
    for (const filePath of files) {
      const relativePath = path.relative(packRoot, filePath).replaceAll('\\', '/')
      const zipPath = relativePath === 'manifest.json'
        ? relativePath
        : relativePath.startsWith('tools/')
          ? relativePath
          : `${expertRoot}/${relativePath}`
      zipEntries[zipPath] = new Uint8Array(await readFile(filePath))
    }

    const outputPath = path.join(outputDir, `${manifest.packId}.zip`)
    await writeFile(outputPath, await adapter.write(zipEntries))
    outputs.push(outputPath)
  }

  return outputs
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const resolved = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(resolved))
    else if (entry.isFile()) files.push(resolved)
  }
  return files
}

if (import.meta.main) {
  const outputs = await buildBundledExpertPacks()
  console.log(`[build-expert-packs] Built ${outputs.length} bundled Expert Pack ZIP(s).`)
}
