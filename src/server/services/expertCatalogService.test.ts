import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExpertCategoryService, getExpertCategoryStoragePath } from './expertCatalogService.js'

const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
const tempRoots: string[] = []

async function useTemporaryConfigDir(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'expert-categories-'))
  tempRoots.push(root)
  process.env.CLAUDE_CONFIG_DIR = root
}

describe('ExpertCategoryService', () => {
  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('provides editable default categories before a catalog exists', async () => {
    await useTemporaryConfigDir()
    const categories = await new ExpertCategoryService().listCategories()
    expect(categories.map((category) => category.id)).toEqual(['product', 'development', 'design', 'uncategorized'])
  })

  it('persists a user-managed category order and preserves the uncategorized fallback', async () => {
    await useTemporaryConfigDir()
    const service = new ExpertCategoryService()
    const saved = await service.updateCategories([
      { id: 'research', name: '研究' },
      { id: 'development', name: '开发工程' },
    ])

    expect(saved.map((category) => category.id)).toEqual(['research', 'development', 'uncategorized'])
    expect(getExpertCategoryStoragePath()).toContain(path.join('cc-jiangxia', 'experts', 'categories.json'))
    expect((await service.listCategories()).map((category) => category.name)).toEqual(['研究', '开发工程', '未分类'])
  })
})
