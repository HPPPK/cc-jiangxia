import { useState } from 'react'
import { useTranslation } from '../../i18n'
import type { ModeChangeSummary } from './MessageList'

type ModeChangeSummaryCardProps = {
  summary: ModeChangeSummary
}

export function ModeChangeSummaryCard({ summary }: ModeChangeSummaryCardProps) {
  const t = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <section
      className="mx-auto mb-5 w-full max-w-[860px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
      aria-label={t('chat.modeChangesCardLabel')}
    >
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('chat.modeChangesTitle', { count: summary.files.length })}
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--color-success)]">
            +{summary.insertions}
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--color-error)]">
            -{summary.deletions}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
          {t('chat.modeChangesSubtitle', { count: summary.turnCount })}
        </div>
      </div>

      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-md)] text-left text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            {isExpanded ? 'keyboard_arrow_down' : 'chevron_right'}
          </span>
          {t('chat.modeChangesShowFiles', { count: summary.files.length })}
        </button>

        {isExpanded ? (
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
            {summary.files.map((path) => (
              <li key={path} className="px-3 py-2 font-mono text-[12px] text-[var(--color-text-secondary)]">
                {path}
              </li>
            ))}
          </ul>
        ) : null}

        {summary.turnCount > 1 ? (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
            {t('chat.modeChangesCumulativeNote')}
          </p>
        ) : null}
      </div>
    </section>
  )
}
