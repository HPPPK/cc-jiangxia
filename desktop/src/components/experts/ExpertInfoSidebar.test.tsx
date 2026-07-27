import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExpertInfoSidebar } from './ExpertInfoSidebar'
import type { ExpertDefinition, ExpertProfile } from '../../api/experts'

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('../../api/experts', () => ({
  expertsApi: api,
}))

const profile: ExpertProfile = {
  avatar: '🎨',
  tagline: '真实可扩展的设计系统专家',
  soul: {
    whoIAm: '我负责把产品方向沉淀为可执行的设计系统。',
    howITalk: '直接给结论并说明取舍。',
    boundaries: ['不虚构验证结果'],
  },
  memories: [{ id: 'memory-1', content: '优先考虑无障碍。', createdAt: '2026-07-22T00:00:00.000Z' }],
  workflow: [{ id: 'audit', title: '体验审计', description: '识别关键问题。' }],
  knowledgeBase: { version: 'v0.1', ruleCount: 12, styleCount: 8, paletteCount: 10 },
}

const definition: ExpertDefinition = {
  id: 'uiux-design-system-expert',
  name: 'UIUX设计系统专家',
  description: '产品体验与设计系统',
  statusLabel: 'Ready',
  profile,
  packId: 'uiux-design-system',
  packName: 'UIUX Design System',
  packVersion: '0.1.0',
  entrypoint: 'experts/uiux/expert.json',
  promptPaths: {},
  formPaths: [],
  skillIds: ['uiux-design-system-method', 'accessibility-review'],
  hostTools: [],
  permissions: [],
  tools: [],
  portable: true,
}

describe('ExpertInfoSidebar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    api.getProfile.mockResolvedValue({ schemaVersion: 1, expertId: definition.id, profile, updatedAt: '2026-07-22T00:00:00.000Z' })
    api.updateProfile.mockImplementation(async (_expertId: string, next: ExpertProfile) => ({ schemaVersion: 1, expertId: definition.id, profile: next, updatedAt: '2026-07-22T01:00:00.000Z' }))
  })

  it('shows only packaged skills and supports collapsing the right sidebar', async () => {
    render(<ExpertInfoSidebar definition={definition} />)
    await screen.findByText('UIUX设计系统专家')
    expect(screen.getByText('uiux-design-system-method')).toBeTruthy()
    expect(screen.getByText('accessibility-review')).toBeTruthy()
    expect(screen.getByText(/知识库 v0.1/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('收起专家信息'))
    expect(screen.getByTestId('expert-info-sidebar').getAttribute('data-collapsed')).toBe('true')
    expect(window.localStorage.getItem('cc-jiangxia-expert-info-sidebar-collapsed')).toBe('true')

    fireEvent.click(screen.getByLabelText('展开专家信息'))
    expect(screen.getByTestId('expert-info-sidebar').getAttribute('data-collapsed')).toBe('false')
  })

  it('saves a user editable SOUL override without editing the expert ZIP', async () => {
    render(<ExpertInfoSidebar definition={definition} />)
    await screen.findByText('Who I Am')
    fireEvent.click(screen.getByLabelText('编辑专家简介'))
    fireEvent.change(screen.getByDisplayValue('我负责把产品方向沉淀为可执行的设计系统。'), { target: { value: '更新后的专家定位' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1))
    const saveCall = api.updateProfile.mock.calls[0]
    expect(saveCall).toBeDefined()
    expect(saveCall![0]).toBe(definition.id)
    expect(saveCall![1].soul?.whoIAm).toBe('更新后的专家定位')
  })
})
