import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

function readBuildScript() {
  return readFileSync(path.resolve(import.meta.dirname, 'build-sidecars.ts'), 'utf8')
}

function extractWindowsX64BunTarget(source: string) {
  const match = source.match(/case 'x86_64-pc-windows-msvc':[\s\S]*?return '([^']+)'/)
  return match?.[1] ?? null
}

function extractExternalModules(source: string) {
  const match = source.match(/external:\s*\[(.*?)\],\s*compile:/s)
  if (!match) return []

  return [...match[1]!.matchAll(/'([^']+)'/g)].map((item) => item[1]!)
}

describe('build-sidecars Windows x64 target mapping', () => {
  it('keeps the Windows x64 Bun runtime target explicit', () => {
    expect(extractWindowsX64BunTarget(readBuildScript())).toBe('bun-windows-x64')
  })

  it('bundles the IM adapter runtime dependencies into the compiled sidecar', () => {
    const externalModules = extractExternalModules(readBuildScript())

    expect(externalModules).not.toContain('@larksuiteoapi/node-sdk')
    expect(externalModules).not.toContain('grammy')
    expect(externalModules).not.toContain('dingtalk-stream')
  })

  it('builds bundled Expert Pack ZIPs before copying pack resources', () => {
    const source = readBuildScript()

    expect(source).toContain('buildBundledExpertPacks')
    expect(source).toContain("path.join(repoRoot, 'scripts', 'build-expert-packs.ts')")
    expect(source.indexOf('await buildBundledExpertPacks()')).toBeLessThan(source.indexOf('await copyBundledWorkflowPacks()'))
  })

  it('copies workflow packs next to the compiled sidecar', () => {
    const source = readBuildScript()

    expect(source).toContain('copyBundledWorkflowPacks')
    expect(source).toContain("path.join(repoRoot, 'src', 'server', 'packs')")
    expect(source).toContain("path.join(binariesDir, 'packs')")
  })

  it('downloads the target-platform managed Chromium runtime next to the compiled sidecar', () => {
    const source = readBuildScript()

    expect(source).toContain('buildBundledBrowserRuntime')
    expect(source).toContain("path.join(binariesDir, 'browser-runtime', 'playwright')")
    expect(source).toContain('PLAYWRIGHT_BROWSERS_PATH')
    expect(source).toContain("'playwright', 'install', 'chromium-headless-shell'")
  })

  it('downloads a pinned Portable Git runtime into Windows release resources', () => {
    const source = readBuildScript()

    expect(source).toContain('buildBundledGitRuntime')
    expect(source).toContain("path.join(resourceDir, 'portable-git')")
    expect(source).toContain("if (targetTriple !== 'x86_64-pc-windows-msvc')")
    expect(source).toContain("path.join(resourceDir, '.keep')")
    expect(source).toContain('waitForManagedGitRuntime')
    expect(source).toContain("'bin', 'bash.exe'")
    expect(source.indexOf("const MANAGED_GIT_VERSION = '2.55.0.3'")).toBeLessThan(source.indexOf('await buildBundledGitRuntime()'))
    expect(source).toContain("const MANAGED_GIT_VERSION = '2.55.0.3'")
    expect(source).toContain('v2.55.0.windows.3')
    expect(source).toContain('ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d')
    expect(source).toContain("'-y', `-o${cacheDir}`")
  })

  it('copies bundled skill resources next to the compiled sidecar', () => {
    const source = readBuildScript()

    expect(source).toContain('copyBundledSkills')
    expect(source).toContain("path.join(repoRoot, 'src', 'skills', 'bundled')")
    expect(source).toContain("path.join(binariesDir, 'skills', 'bundled')")
  })

})
