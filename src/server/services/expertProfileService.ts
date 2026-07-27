import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAppStoragePath } from '../../utils/appIdentity.js'
import {
  ExpertPackRegistryService,
  normalizeExpertProfile,
  type ExpertProfile,
} from './expertPackRegistryService.js'

export type ExpertProfileRecord = {
  schemaVersion: 1
  expertId: string
  profile: ExpertProfile
  updatedAt: string
}

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function getExpertProfileStorageDir(): string {
  return getAppStoragePath(getConfigDir(), 'experts', 'state')
}

function profilePath(expertId: string): string {
  const safeId = expertId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!safeId) throw new Error('Expert ID is required.')
  return path.join(getExpertProfileStorageDir(), `${safeId}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeProfiles(base: ExpertProfile | undefined, override: ExpertProfile | undefined): ExpertProfile {
  const baseSoul = base?.soul
  const overrideSoul = override?.soul
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    ...(baseSoul || overrideSoul ? {
      soul: {
        whoIAm: overrideSoul?.whoIAm ?? baseSoul?.whoIAm ?? '',
        howITalk: overrideSoul?.howITalk ?? baseSoul?.howITalk ?? '',
        boundaries: overrideSoul?.boundaries ?? baseSoul?.boundaries ?? [],
      },
    } : {}),
  }
}

export class ExpertProfileService {
  constructor(private readonly registry = new ExpertPackRegistryService()) {}

  async getProfile(expertId: string): Promise<ExpertProfileRecord> {
    const expert = await this.registry.getExpert(expertId)
    if (!expert) throw new Error('Expert not found.')
    const override = await this.readOverride(expertId)
    return {
      schemaVersion: 1,
      expertId,
      profile: mergeProfiles(expert.profile, override?.profile),
      updatedAt: override?.updatedAt ?? expert.packVersion,
    }
  }

  async updateProfile(expertId: string, profile: unknown): Promise<ExpertProfileRecord> {
    const expert = await this.registry.getExpert(expertId)
    if (!expert) throw new Error('Expert not found.')
    const normalized = normalizeExpertProfile(profile)
    if (!normalized) throw new Error('Expert profile must contain at least one supported field.')
    const record: ExpertProfileRecord = {
      schemaVersion: 1,
      expertId,
      profile: normalized,
      updatedAt: new Date().toISOString(),
    }
    await fs.mkdir(getExpertProfileStorageDir(), { recursive: true })
    await fs.writeFile(profilePath(expertId), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    return {
      ...record,
      profile: mergeProfiles(expert.profile, normalized),
    }
  }

  private async readOverride(expertId: string): Promise<ExpertProfileRecord | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(profilePath(expertId), 'utf8')) as unknown
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.expertId !== expertId) return null
      const profile = normalizeExpertProfile(parsed.profile)
      if (!profile) return null
      return {
        schemaVersion: 1,
        expertId,
        profile,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
