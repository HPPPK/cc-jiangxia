import { FormEvent, useState } from 'react'
import { expertsApi, type SkillDiscoveryResponse, type SkillDiscoverySource } from '../../api/experts'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'

type SkillDiscoveryDialogProps = {
  open: boolean
  onClose: () => void
}

const sourceOptions: Array<{ value: SkillDiscoverySource; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'web', label: 'Web' },
  { value: 'qclaw', label: 'QClaw' },
]

/**
 * Link-only discovery surface. It intentionally has no import/install action:
 * remote Skill content must be reviewed by the user before it enters a pack.
 */
export function SkillDiscoveryDialog({ open, onClose }: SkillDiscoveryDialogProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SkillDiscoverySource>('all')
  const [result, setResult] = useState<SkillDiscoveryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      setError('请输入要搜索的 Skill、工作流或使用场景。')
      setResult(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      setResult(await expertsApi.discoverSkills(normalizedQuery, source))
    } catch (cause) {
      setResult(null)
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="搜索在线 Skill"
      width={720}
      footer={<Button type="button" variant="secondary" onClick={onClose}>关闭</Button>}
    >
      <div className="space-y-4">
        <div className="rounded-[8px] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-3 py-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          搜索仅发现公开链接；不会自动导入或执行远程 Skill。请先打开链接审阅来源、许可证、提示词和工具权限，再决定是否手动导入专家包。
        </div>

        <form className="space-y-3" onSubmit={(event) => void handleSearch(event)}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">搜索关键词</span>
            <input
              aria-label="搜索关键词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：新品商业化调研、竞品分析、UI/UX 设计系统"
              className="w-full rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)]"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-40 space-y-1.5">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">来源</span>
              <select
                aria-label="来源"
                value={source}
                onChange={(event) => setSource(event.target.value as SkillDiscoverySource)}
                className="w-full rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)]"
              >
                {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <Button type="submit" loading={loading}>搜索</Button>
          </div>
        </form>

        {error ? (
          <div role="alert" className="rounded-[8px] border border-[var(--color-error)]/30 bg-[var(--color-error)]/8 px-3 py-2 text-sm text-[var(--color-error)]">
            {error}
          </div>
        ) : null}

        {result ? (
          <section aria-live="polite" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]">
              <span>由 {result.provider === 'tavily' ? 'Tavily' : 'Brave'} 返回，关键词：{result.query}</span>
              <span>{result.results.length} 条公开链接</span>
            </div>
            {result.results.length > 0 ? (
              <ul className="divide-y overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
                {result.results.map((item) => (
                  <li key={item.source + ':' + item.url} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-[var(--color-brand)] hover:underline"
                      >
                        {item.title}
                      </a>
                      <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                        {item.source === 'qclaw' ? 'QClaw' : 'Web'}
                      </span>
                    </div>
                    <p className="break-all text-xs text-[var(--color-text-tertiary)]">{item.url}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-5 text-sm text-[var(--color-text-secondary)]">
                没有找到公开链接。请换一个更具体的关键词，或切换来源后再试。
              </div>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
