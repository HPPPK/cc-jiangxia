import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAppStoragePath } from '../../utils/appIdentity.js'
import type { ExpertSessionMetadata } from './expertPackRegistryService.js'

export type ExpertRuntimeSessionRecord = {
  schemaVersion: 1
  sessionId: string
  expert: ExpertSessionMetadata
  updatedAt: string
}

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function getExpertRuntimeSessionStorageDir(): string {
  return getAppStoragePath(getConfigDir(), 'experts', 'runtime-sessions')
}

function recordPath(sessionId: string): string {
  const safeSessionId = sessionId.trim().toLowerCase()
  if (!/^[a-f0-9-]{8,128}$/.test(safeSessionId)) throw new Error('Invalid Expert session ID.')
  return path.join(getExpertRuntimeSessionStorageDir(), `${safeSessionId}.json`)
}

function isActiveExpertRuntime(value: unknown): value is ExpertSessionMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const expert = value as ExpertSessionMetadata
  return expert.mode === 'expert' && expert.status === 'active' && expert.runtimeBinding?.active === true
}

export class ExpertRuntimeSessionStore {
  async save(sessionId: string, expert: ExpertSessionMetadata): Promise<void> {
    if (!isActiveExpertRuntime(expert)) throw new Error('Only an active Expert runtime can be persisted.')
    const record: ExpertRuntimeSessionRecord = {
      schemaVersion: 1,
      sessionId,
      expert,
      updatedAt: new Date().toISOString(),
    }
    await fs.mkdir(getExpertRuntimeSessionStorageDir(), { recursive: true })
    await fs.writeFile(recordPath(sessionId), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  async get(sessionId: string): Promise<ExpertSessionMetadata | undefined> {
    let filePath: string
    try {
      filePath = recordPath(sessionId)
    } catch {
      // Ordinary test/legacy chat IDs may not use UUID formatting. They simply
      // cannot have a persisted Expert runtime fallback.
      return undefined
    }
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const record = parsed as Partial<ExpertRuntimeSessionRecord>
      if (record.schemaVersion !== 1 || record.sessionId !== sessionId || !isActiveExpertRuntime(record.expert)) return undefined
      return record.expert
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async remove(sessionId: string): Promise<void> {
    try {
      await fs.rm(recordPath(sessionId), { force: true })
    } catch {
      // Nothing is stored for a non-standard or already removed session ID.
    }
  }
}

export const expertRuntimeSessionStore = new ExpertRuntimeSessionStore()
