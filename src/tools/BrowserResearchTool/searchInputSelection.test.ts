import { describe, expect, test } from 'bun:test'

import { findVisibleEditableSearchInput } from './searchInputSelection.js'

type FakeInput = {
  isVisible: () => Promise<boolean>
  isEditable: () => Promise<boolean>
  fill: (value: string) => Promise<void>
  press: (key: string) => Promise<void>
}

function fakeInput(visible: boolean, editable: boolean): FakeInput {
  return {
    isVisible: async () => visible,
    isEditable: async () => editable,
    fill: async () => undefined,
    press: async () => undefined,
  }
}

describe('findVisibleEditableSearchInput', () => {
  test('skips a hidden first selector match and returns a later visible editable input', async () => {
    const hidden = fakeInput(false, false)
    const visible = fakeInput(true, true)
    const selected = await findVisibleEditableSearchInput({
      count: async () => 2,
      nth: (index) => [hidden, visible][index]!,
    }, 'Baidu', 50)

    expect(selected).toBe(visible)
  })

  test('does not accept a visible but non-editable candidate', async () => {
    const disabled = fakeInput(true, false)
    const visible = fakeInput(true, true)
    const selected = await findVisibleEditableSearchInput({
      count: async () => 2,
      nth: (index) => [disabled, visible][index]!,
    }, '360 Search', 50)

    expect(selected).toBe(visible)
  })
})
