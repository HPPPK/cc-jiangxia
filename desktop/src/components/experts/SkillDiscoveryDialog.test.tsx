import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expertsApi } from '../../api/experts'
import { SkillDiscoveryDialog } from './SkillDiscoveryDialog'

vi.mock('../../api/experts', () => ({
  expertsApi: { discoverSkills: vi.fn() },
}))

describe('SkillDiscoveryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches selected sources and renders links without adding an import action', async () => {
    vi.mocked(expertsApi.discoverSkills).mockResolvedValue({
      query: 'market research',
      source: 'qclaw',
      provider: 'tavily',
      results: [{ title: 'QClaw Product Manager', url: 'https://qclaw.qq.com/as/example', source: 'qclaw' }],
    })
    render(<SkillDiscoveryDialog open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: ' market research ' } })
    fireEvent.change(screen.getByLabelText('来源'), { target: { value: 'qclaw' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    await waitFor(() => expect(expertsApi.discoverSkills).toHaveBeenCalledWith('market research', 'qclaw'))
    const link = await screen.findByRole('link', { name: 'QClaw Product Manager' })
    expect(link).toHaveAttribute('href', 'https://qclaw.qq.com/as/example')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/不会自动导入或执行远程 Skill/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /导入|安装/ })).not.toBeInTheDocument()
  })

  it('validates an empty query locally instead of calling discovery', async () => {
    render(<SkillDiscoveryDialog open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入要搜索的 Skill')
    expect(expertsApi.discoverSkills).not.toHaveBeenCalled()
  })

  it('surfaces provider configuration errors to the user', async () => {
    vi.mocked(expertsApi.discoverSkills).mockRejectedValue(
      new Error('Online Skill discovery needs a Tavily or Brave API key in Web Search settings.'),
    )
    render(<SkillDiscoveryDialog open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'market research' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tavily or Brave API key')
  })
})
