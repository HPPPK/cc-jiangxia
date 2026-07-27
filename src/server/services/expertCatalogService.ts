import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAppStoragePath } from '../../utils/appIdentity.js'

export type ExpertCategory = {
  id: string
  name: string
  description?: string
  icon?: string
}

const DEFAULT_EXPERT_CATEGORIES: ExpertCategory[] = [
  { id: 'product', name: '产品经理', description: '调研、洞察、策略与产品规划', icon: 'explore' },
  { id: 'development', name: '开发', description: '工程实现、代码审查与技术诊断', icon: 'terminal' },
  { id: 'design', name: 'UI 设计', description: '界面、体验与视觉表达', icon: 'palette' },
  { id: 'uncategorized', name: '未分类', description: '等待进一步归类的专家', icon: 'more_horiz' },
]

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function getExpertCategoryStoragePath(): string {
  return getAppStoragePath(getConfigDir(), 'experts', 'categories.json')
}

function normalizeId(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    : ''
}

function normalizeCategories(value: unknown): ExpertCategory[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item): ExpertCategory[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    const id = normalizeId(raw.id)
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      name,
      ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim() } : {}),
      ...(typeof raw.icon === 'string' && raw.icon.trim() ? { icon: raw.icon.trim() } : {}),
    }]
  })
}

export class ExpertCategoryService {
  async listCategories(): Promise<ExpertCategory[]> {
    try {
      const raw = JSON.parse(await fs.readFile(getExpertCategoryStoragePath(), 'utf8')) as { categories?: unknown }
      const categories = normalizeCategories(raw.categories)
      return categories.length > 0 ? categories : structuredClone(DEFAULT_EXPERT_CATEGORIES)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_EXPERT_CATEGORIES)
      return structuredClone(DEFAULT_EXPERT_CATEGORIES)
    }
  }

  async updateCategories(categories: unknown): Promise<ExpertCategory[]> {
    const normalized = normalizeCategories(categories)
    if (normalized.length === 0) throw new Error('At least one expert category is required.')
    if (!normalized.some((category) => category.id === 'uncategorized')) {
      normalized.push(DEFAULT_EXPERT_CATEGORIES.find((category) => category.id === 'uncategorized')!)
    }
    const target = getExpertCategoryStoragePath()
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, categories: normalized }, null, 2) + '\n', 'utf8')
    return normalized
  }
}
