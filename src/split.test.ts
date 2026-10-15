import { describe, expect, it } from 'vitest'
import { splitBill } from './split.ts'

describe('splitBill', () => {
  it('splits bill plus tip evenly', () => {
    expect(splitBill(100, 20, 4)).toBe(30)
  })

  it('returns null for zero people', () => {
    expect(splitBill(100, 20, 0)).toBeNull()
  })

  it('rounds each share up to the cent', () => {
    expect(splitBill(100, 0, 3)).toBe(33.34)
    expect(splitBill(19.99, 15, 2)).toBe(11.5)
  })
})
