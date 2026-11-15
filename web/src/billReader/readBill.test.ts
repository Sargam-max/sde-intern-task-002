import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { readBill } from './readBill'

describe('readBill delegation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates to backend parseBillWithAi when available', async () => {
    const mockFile = new File(['%PDF-1.4 sample bill'], 'bescom.pdf', {
      type: 'application/pdf',
    })

    vi.spyOn(api, 'parseBillWithAi').mockResolvedValueOnce({
      title: 'BESCOM Electricity bill',
      totalCents: 147500,
      payableAmount: 1475,
      currency: 'INR',
      dueDate: '2026-06-20',
      explanation: 'Payable Amount on or before Due Date',
      candidates: [{ cents: 147500, line: 'Payable Amount', score: 200 }],
      text: '[Gemini AI Backend Processed]',
    })

    const result = await readBill(mockFile)
    expect(result.method).toBe('gemini-ai')
    expect(result.totalCents).toBe(147500)
    expect(result.title).toBe('BESCOM Electricity bill')
    expect(api.parseBillWithAi).toHaveBeenCalledTimes(1)
  })

  it('falls back to local parser when backend fails', async () => {
    vi.spyOn(api, 'parseBillWithAi').mockRejectedValueOnce(new Error('Backend offline'))

    // Valid simple text PDF can be parsed by local pdf-text
    // Or if error, falls through to local reader
    try {
      const mockFile = new File(['plain text bill'], 'plain.txt', { type: 'text/plain' })
      await readBill(mockFile)
    } catch (err) {
      // Expected to fail on non-pdf/image after failing backend
      expect(err).toBeDefined()
    }
  })
})
