import { describe, expect, it } from 'vitest'
import { parseDollarsToCents } from '../api'
import { findMoney, parseBill } from './parseBill'

describe('parseBill: picks the amount to pay', () => {
  it('reads a utility bill and ignores the account number, dates and usage', () => {
    const bill = parseBill(`
      City Power & Light
      Account number 4410 2231 9087
      Bill date 03/04/2026   Due date 24/04/2026
      Units used 412 kWh
      Energy charges $52.10
      Taxes $4.17
      Total amount due $56.27
      Amount payable after due date $59.27
    `)
    expect(bill.totalCents).toBe(5627)
    expect(bill.title).toBe('Electricity bill')
    expect(bill.candidates.map((c) => c.cents)).toContain(5927)
  })

  it('prefers TOTAL over SUBTOTAL, TAX and CASH on a shop receipt', () => {
    const bill = parseBill(`
      FRESH MART
      Milk 2 x 1.50        3.00
      Bread                2.25
      SUBTOTAL             5.25
      TAX                  0.42
      TOTAL                5.67
      CASH                10.00
      CHANGE               4.33
    `)
    expect(bill.totalCents).toBe(567)
  })

  it('reads Indian bills with rupees and lakh grouping', () => {
    const bill = parseBill(`
      Airtel Broadband
      Plan charges Rs. 999.00
      CGST 89.91  SGST 89.91
      Amount Payable ₹ 1,178.82
    `)
    expect(bill.totalCents).toBe(117882)
    expect(bill.title).toBe('Internet bill')

    expect(parseBill('Net Payable Rs 1,23,456.50').totalCents).toBe(12345650)
  })

  it('takes the value from the next line when OCR splits label and amount', () => {
    const bill = parseBill(`
      Water Board
      Amount Due
      $ 41.20
    `)
    expect(bill.totalCents).toBe(4120)
  })

  it('understands a decimal comma', () => {
    expect(parseBill('Gesamtbetrag\nTotal 123,45 €').totalCents).toBe(12345)
  })

  it('falls back to the largest money value when no label is found', () => {
    const bill = parseBill('Some shop\nItem one $3.20\nItem two $12.80\n$16.00')
    expect(bill.totalCents).toBe(1600)
  })

  it('returns null when there is no amount at all', () => {
    const bill = parseBill('Thank you for your visit!\nCall 555-0199')
    expect(bill.totalCents).toBeNull()
    expect(bill.candidates).toEqual([])
  })

  it('does not treat a phone number, date or time as money', () => {
    const bill = parseBill('Call us 9876543210\nDate 12/03/2026 10:45\nTotal $20.00')
    expect(bill.totalCents).toBe(2000)
    expect(bill.candidates.map((c) => c.cents)).toEqual([2000])
  })

  it('gives at most 5 different candidates, best first, with the line as evidence', () => {
    const bill = parseBill('A $1.00\nB $2.00\nC $3.00\nD $4.00\nE $5.00\nF $6.00\nTotal $21.00')
    expect(bill.candidates).toHaveLength(5)
    expect(bill.candidates[0]).toMatchObject({ cents: 2100, line: 'Total $21.00' })
  })

  it('uses the first name-like line as the title for an unknown kind of bill', () => {
    expect(parseBill('Joe’s Hardware\n123 Main St\nTotal $9.99').title).toBe('Joe’s Hardware')
  })

  it('reads electricity bill with table format and plain integer total', () => {
    const text = `
      ELECTRICITY BILL
      DATE: 01-19-2023
      TENANT NAME: HELLEN
      ACKNOWLEDGEMENT RECEIPT
      BILLING PERIOD DEC 22, 2022 - JAN 18, 2023
      CURRENT KW READING 3699.6
      PREVIOUS KW READING 3668.1
      CONSUMPTION 31.5
      RATE PER KWH 16
      TOTAL AMOUNT DUE 504
      AMOUNT RECEIVED
    `
    const bill = parseBill(text)
    expect(bill.totalCents).toBe(50400)
    expect(bill.title).toBe('Electricity bill')
  })

  it('reads Indian notation with trailing /-', () => {
    expect(parseBill('TOTAL AMOUNT DUE Rs. 504/-').totalCents).toBe(50400)
    expect(parseBill('TOTAL Rs 1,500/-').totalCents).toBe(150000)
  })

  it('reads total split across lines with empty or punctuation line in between', () => {
    const text = 'TOTAL AMOUNT DUE\n:\n504'
    expect(parseBill(text).totalCents).toBe(50400)
  })

  it('handles "Due Amount" and "Payable Amount" label variants', () => {
    expect(parseBill('Due Amount: $504.00').totalCents).toBe(50400)
    expect(parseBill('Payable Amount: Rs. 1500/-').totalCents).toBe(150000)
    expect(parseBill('Net Payable Amount: ₹ 1,234.50').totalCents).toBe(123450)
  })

  it('prefers explicit money values over plain integers like item counts on total line', () => {
    const text = 'TOTAL AMOUNT DUE: $ 504.00    ITEMS: 2'
    expect(parseBill(text).totalCents).toBe(50400)
  })

  it('does not confuse year numbers in dates with bill amounts', () => {
    const text = 'Total $50.00   DATE: 15/11/2026'
    expect(parseBill(text).totalCents).toBe(5000)
  })

  it('corrects OCR typos in numbers such as letter O and S', () => {
    expect(parseBill('Total: $10O.OO').totalCents).toBe(10000)
    expect(parseBill('Total: S50.00').totalCents).toBe(5000)
  })

  it('prefers on-time payable amount over after due date / late payment surcharge', () => {
    const text = `
      BESCOM Electricity Bill
      Due Date: 20-11-2026
      Payable Amount on or before Due Date: 1,475.00
      Payable Amount after Due Date: 1,525.00
    `
    const bill = parseBill(text)
    expect(bill.totalCents).toBe(147500)
    expect(bill.candidates[0]?.cents).toBe(147500)
    expect(bill.candidates[1]?.cents).toBe(152500)
  })
})

describe('findMoney', () => {
  it.each([
    ['$1,234.56', 123456],
    ['1,234', 123400],
    ['12.5', 1250],
    ['1.234,56', 123456],
    ['₹ 450', 45000],
    ['EUR 9,99', 999],
  ])('reads %s', (text, cents) => {
    expect(findMoney(text)[0]?.cents).toBe(cents)
  })

  it('ignores zero and nonsense grouping', () => {
    expect(findMoney('0.00')).toEqual([])
    expect(findMoney('1,2,3')).toEqual([])
    expect(findMoney('1.234.56')).toEqual([])
    expect(findMoney('12,3456')).toEqual([])
  })
})

describe('parseDollarsToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['$12.50', 1250],
    ['$ 10.00', 1000],
    ['1,234.56', 123456],
    ['$1,000.00', 100000],
    ['₹ 500', 50000],
    ['€15.75', 1575],
  ])('parses %s to %i cents', (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected)
  })

  it.each(['-10', '10.555', 'abc', '', '   ', '12.'])('rejects invalid input %j', (input) => {
    expect(parseDollarsToCents(input)).toBeNull()
  })
})
