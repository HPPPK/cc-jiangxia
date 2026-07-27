import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expertsApi } from '../api/experts'
import { useExpertStore } from './expertStore'

describe('expertStore', () => {
  const initialState = useExpertStore.getInitialState()

  beforeEach(() => {
    useExpertStore.setState(initialState, true)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    useExpertStore.setState(initialState, true)
    vi.restoreAllMocks()
  })

  it('keeps expert selection available with default categories when an older sidecar lacks the category endpoint', async () => {
    vi.spyOn(expertsApi, 'listExperts').mockResolvedValue({ experts: [{ id: 'product-research', name: '产品研究专家' }] as never })
    vi.spyOn(expertsApi, 'listPacks').mockResolvedValue({ packs: [{ packId: 'product-pack', name: '产品专家包' }] as never })
    vi.spyOn(expertsApi, 'listCategories').mockRejectedValue(new Error('Unknown experts resource: categories'))

    await useExpertStore.getState().loadExperts()

    expect(useExpertStore.getState().experts).toHaveLength(1)
    expect(useExpertStore.getState().packs).toHaveLength(1)
    expect(useExpertStore.getState().categories.map((category) => category.id)).toEqual(['product', 'development', 'design', 'uncategorized'])
    expect(useExpertStore.getState().expertsError).toBeNull()
  })
})
