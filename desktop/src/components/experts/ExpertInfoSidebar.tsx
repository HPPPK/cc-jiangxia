import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpenText, Brain, ChevronLeft, ChevronRight, Edit3, FileText, Plus, Save, Sparkles, Workflow, X } from 'lucide-react'
import { expertsApi, type ExpertDefinition, type ExpertProfile } from '../../api/experts'

const SIDEBAR_COLLAPSED_KEY = 'cc-jiangxia-expert-info-sidebar-collapsed'

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
  } catch {
    // The sidebar remains usable when storage is unavailable.
  }
}

function formatKnowledgeBase(profile: ExpertProfile) {
  const knowledgeBase = profile.knowledgeBase
  if (!knowledgeBase) return null
  const parts = [
    typeof knowledgeBase.ruleCount === 'number' ? `${knowledgeBase.ruleCount} 条规则` : null,
    typeof knowledgeBase.styleCount === 'number' ? `${knowledgeBase.styleCount} 种风格` : null,
    typeof knowledgeBase.paletteCount === 'number' ? `${knowledgeBase.paletteCount} 套色板` : null,
    typeof knowledgeBase.componentCount === 'number' ? `${knowledgeBase.componentCount} 类组件` : null,
  ].filter((value): value is string => Boolean(value))
  return parts.length ? `知识库 ${knowledgeBase.version} · ${parts.join(' · ')}` : `知识库 ${knowledgeBase.version}`
}

function cloneProfile(profile: ExpertProfile): ExpertProfile {
  return {
    ...profile,
    soul: profile.soul ? { ...profile.soul, boundaries: [...profile.soul.boundaries] } : undefined,
    starterPrompts: profile.starterPrompts ? [...profile.starterPrompts] : undefined,
    workflow: profile.workflow ? profile.workflow.map((step) => ({ ...step })) : undefined,
    memories: profile.memories ? profile.memories.map((entry) => ({ ...entry })) : undefined,
    diary: profile.diary ? profile.diary.map((entry) => ({ ...entry })) : undefined,
  }
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b border-[var(--color-border)]/70 px-4 py-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ExpertInfoSidebar({ definition }: { definition: ExpertDefinition }) {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference)
  const [profile, setProfile] = useState<ExpertProfile>(() => definition.profile ?? {})
  const [draft, setDraft] = useState<ExpertProfile>(() => cloneProfile(definition.profile ?? {}))
  const [editingSoul, setEditingSoul] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState('')
  const [diaryDraft, setDiaryDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile(definition.profile ?? {})
    setDraft(cloneProfile(definition.profile ?? {}))
    setError(null)
    void expertsApi.getProfile(definition.id)
      .then((record) => {
        if (cancelled) return
        setProfile(record.profile)
        setDraft(cloneProfile(record.profile))
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '专家资料暂时无法加载。')
      })
    return () => { cancelled = true }
  }, [definition.id, definition.profile])

  const knowledgeLabel = useMemo(() => formatKnowledgeBase(profile), [profile])
  const setCollapsedAndPersist = (next: boolean) => {
    setCollapsed(next)
    writeCollapsedPreference(next)
  }

  const saveProfile = async (next: ExpertProfile, closeSoulEditor = false) => {
    setSaving(true)
    setError(null)
    try {
      const record = await expertsApi.updateProfile(definition.id, next)
      setProfile(record.profile)
      setDraft(cloneProfile(record.profile))
      if (closeSoulEditor) setEditingSoul(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存专家资料失败。')
    } finally {
      setSaving(false)
    }
  }

  if (collapsed) {
    return (
      <aside data-testid="expert-info-sidebar" data-collapsed="true" className="flex w-11 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          type="button"
          title="展开专家信息"
          aria-label="展开专家信息"
          onClick={() => setCollapsedAndPersist(false)}
          className="m-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container)] hover:text-[var(--color-text-primary)]"
        >
          <ChevronLeft size={17} />
        </button>
      </aside>
    )
  }

  const soul = profile.soul
  return (
    <aside data-testid="expert-info-sidebar" data-collapsed="false" className="flex w-[328px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">专家信息</span>
        <button
          type="button"
          title="收起专家信息"
          aria-label="收起专家信息"
          onClick={() => setCollapsedAndPersist(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container)] hover:text-[var(--color-text-primary)]"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-[var(--color-border)]/70 px-4 py-4">
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary-container)] text-2xl">
              {profile.avatar || '🎨'}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-[var(--color-text-primary)]">{definition.name}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">{profile.tagline || definition.description || '此专家暂未填写简介。'}</p>
            </div>
          </div>
          {knowledgeLabel ? <p className="mt-3 text-[11px] leading-4 text-[var(--color-text-tertiary)]">{knowledgeLabel}</p> : null}
        </div>

        <Section
          title="简介"
          icon={<BookOpenText size={15} />}
          action={
            editingSoul ? null : (
              <button type="button" aria-label="编辑专家简介" onClick={() => { setDraft(cloneProfile(profile)); setEditingSoul(true) }} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container)] hover:text-[var(--color-text-primary)]">
                <Edit3 size={14} />
              </button>
            )
          }
        >
          {editingSoul ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">简介</label>
              <input value={draft.tagline ?? ''} onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value }))} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs outline-none focus:border-[var(--color-primary)]" />
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">Who I Am</label>
              <textarea value={draft.soul?.whoIAm ?? ''} onChange={(event) => setDraft((current) => ({ ...current, soul: { whoIAm: event.target.value, howITalk: current.soul?.howITalk ?? '', boundaries: current.soul?.boundaries ?? [] } }))} rows={5} className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--color-primary)]" />
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">How I Talk</label>
              <textarea value={draft.soul?.howITalk ?? ''} onChange={(event) => setDraft((current) => ({ ...current, soul: { whoIAm: current.soul?.whoIAm ?? '', howITalk: event.target.value, boundaries: current.soul?.boundaries ?? [] } }))} rows={4} className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--color-primary)]" />
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">Boundaries（每行一条）</label>
              <textarea value={(draft.soul?.boundaries ?? []).join('\n')} onChange={(event) => setDraft((current) => ({ ...current, soul: { whoIAm: current.soul?.whoIAm ?? '', howITalk: current.soul?.howITalk ?? '', boundaries: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) } }))} rows={4} className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--color-primary)]" />
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setDraft(cloneProfile(profile)); setEditingSoul(false) }} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container)]"><X size={13} />取消</button>
                <button type="button" disabled={saving} onClick={() => { void saveProfile(draft, true) }} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-on-primary)] disabled:opacity-60"><Save size={13} />保存</button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-[var(--color-surface-container)] px-3 py-3 text-xs leading-5 text-[var(--color-text-secondary)]">
              {soul?.whoIAm ? <><h4 className="font-semibold text-[var(--color-text-primary)]">Who I Am</h4><p className="mt-1 whitespace-pre-wrap">{soul.whoIAm}</p></> : null}
              {soul?.howITalk ? <><h4 className="mt-3 font-semibold text-[var(--color-text-primary)]">How I Talk</h4><p className="mt-1 whitespace-pre-wrap">{soul.howITalk}</p></> : null}
              {soul?.boundaries?.length ? <><h4 className="mt-3 font-semibold text-[var(--color-text-primary)]">Boundaries</h4><ul className="mt-1 list-disc space-y-1 pl-4">{soul.boundaries.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
              {!soul ? '此专家还没有 SOUL 说明。' : null}
            </div>
          )}
        </Section>

        <Section title="记忆" icon={<Brain size={15} />}>
          <div className="space-y-2">
            {profile.memories?.length ? profile.memories.map((entry) => <div key={entry.id} className="rounded-lg bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"><span className="font-medium text-[var(--color-text-primary)]">{entry.createdAt.slice(0, 10)}</span> · {entry.content}</div>) : <p className="rounded-lg bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">暂无专家级记忆。这里不会读取或改写你的全局项目 Memory。</p>}
            <div className="flex gap-2"><input aria-label="新增专家记忆" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="新增一条专家级记忆" className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs outline-none focus:border-[var(--color-primary)]" /><button type="button" disabled={!memoryDraft.trim() || saving} onClick={() => { const next = { ...profile, memories: [...(profile.memories ?? []), { id: crypto.randomUUID(), content: memoryDraft.trim(), createdAt: new Date().toISOString() }] }; setMemoryDraft(''); void saveProfile(next) }} aria-label="保存专家记忆" className="rounded-lg border border-[var(--color-border)] px-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container)] disabled:opacity-40"><Plus size={15} /></button></div>
          </div>
        </Section>

        <Section title="日记" icon={<FileText size={15} />}>
          <div className="space-y-2">
            {profile.diary?.length ? profile.diary.map((entry) => <div key={entry.id} className="rounded-lg bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"><span className="font-medium text-[var(--color-text-primary)]">{entry.createdAt.slice(0, 10)}</span> · {entry.content}</div>) : <p className="rounded-lg bg-[var(--color-surface-container)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">暂无日记。</p>}
            <div className="flex gap-2"><input aria-label="新增专家日记" value={diaryDraft} onChange={(event) => setDiaryDraft(event.target.value)} placeholder="记录一次人工补充或复盘" className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-2 text-xs outline-none focus:border-[var(--color-primary)]" /><button type="button" disabled={!diaryDraft.trim() || saving} onClick={() => { const next = { ...profile, diary: [...(profile.diary ?? []), { id: crypto.randomUUID(), content: diaryDraft.trim(), createdAt: new Date().toISOString() }] }; setDiaryDraft(''); void saveProfile(next) }} aria-label="保存专家日记" className="rounded-lg border border-[var(--color-border)] px-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container)] disabled:opacity-40"><Plus size={15} /></button></div>
          </div>
        </Section>

        <Section title="技能" icon={<Sparkles size={15} />}>
          <div className="flex flex-wrap gap-1.5">
            {definition.skillIds.length ? definition.skillIds.map((skillId) => <span key={skillId} className="rounded-md bg-[var(--color-primary-container)] px-2 py-1 text-[11px] text-[var(--color-on-primary-container)]">{skillId}</span>) : <p className="text-xs text-[var(--color-text-tertiary)]">这个专家还没有打包技能。</p>}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-[var(--color-text-tertiary)]">仅展示当前 ZIP 内实际打包的技能；工具是否可用仍取决于运行时与模型能力。</p>
        </Section>

        <Section title="工作流程" icon={<Workflow size={15} />}>
          {profile.workflow?.length ? <ol className="space-y-3 border-l border-dashed border-[var(--color-border)] pl-3">{profile.workflow.map((step) => <li key={step.id} className="relative"><span className="absolute -left-[18px] top-1 h-2 w-2 rounded-full border border-[var(--color-primary)] bg-[var(--color-surface)]" /><p className="text-xs font-medium text-[var(--color-text-primary)]">{step.title}</p>{step.description ? <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">{step.description}</p> : null}</li>)}</ol> : <p className="text-xs text-[var(--color-text-tertiary)]">暂无工作流说明。</p>}
        </Section>
        {error ? <p role="alert" className="mx-4 mb-4 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">{error}</p> : null}
      </div>
    </aside>
  )
}
