import { describe, it, expect } from 'vitest'
import {
  calculatePositionWeight,
  calculateAmountWithFreight,
  calculateStatisticalValues,
  checkWeightSum,
  isValidCustomsCode,
  referenceMonthMatches,
} from '../calculations'

describe('calculatePositionWeight', () => {
  it('multipliziert Einzelgewicht mit Menge und rundet auf', () => {
    const result = calculatePositionWeight(330, 500) // 330 g * 500 Stück = 165 kg
    expect(result.rawKg).toBeCloseTo(165)
    expect(result.roundedKg).toBe(165)
  })

  it('rundet Bruchteile immer auf volle kg auf', () => {
    const result = calculatePositionWeight(9, 111) // 9g * 111 = 999g = 0.999 kg
    expect(result.roundedKg).toBe(1)
  })
})

describe('calculateAmountWithFreight', () => {
  it('verteilt Frachtkosten anteilig nach Wertanteil und rundet auf', () => {
    const positions = [{ amountEur: 750 }, { amountEur: 250 }]
    const { roundedAmounts } = calculateAmountWithFreight(positions, 100)
    // Anteil 75% / 25% von 100 EUR Frachtkosten -> +75 / +25
    expect(roundedAmounts[0]).toBe(825)
    expect(roundedAmounts[1]).toBe(275)
  })

  it('rundet auch ohne Frachtkosten je Position auf', () => {
    const positions = [{ amountEur: 100.2 }]
    const { roundedAmounts } = calculateAmountWithFreight(positions, undefined)
    expect(roundedAmounts[0]).toBe(101)
  })
})

describe('calculateStatisticalValues', () => {
  it('berechnet 104% des Positionswerts, wertanteilig verteilt, aufgerundet', () => {
    const { roundedValues, totalSurcharge } = calculateStatisticalValues([750, 250])
    expect(totalSurcharge).toBeCloseTo(40) // 4% von 1000
    // 750 + 75%*40 = 780; 250 + 25%*40 = 260
    expect(roundedValues[0]).toBe(780)
    expect(roundedValues[1]).toBe(260)
  })

  it('rundet Bruchteile eines Euro immer auf', () => {
    const { roundedValues } = calculateStatisticalValues([100.01])
    // 100.01 * 1.04 = 104.0104 -> aufrunden auf 105
    expect(roundedValues[0]).toBe(105)
  })
})

describe('checkWeightSum', () => {
  it('erkennt Übereinstimmung bei exakter Summe (Toleranz 0 kg)', () => {
    const result = checkWeightSum(
      [{ calculatedWeightKgRounded: 100 }, { calculatedWeightKgRounded: 50 }],
      150,
    )
    expect(result.withinTolerance).toBe(true)
    expect(result.differenceKg).toBe(0)
  })

  it('erkennt jede Abweichung bei Toleranz 0 kg', () => {
    const result = checkWeightSum([{ calculatedWeightKgRounded: 101 }], 100)
    expect(result.withinTolerance).toBe(false)
    expect(result.differenceKg).toBe(1)
  })
})

describe('isValidCustomsCode', () => {
  it('akzeptiert genau 8-stellige Warennummern', () => {
    expect(isValidCustomsCode('39233010')).toBe(true)
  })

  it('lehnt abweichende Längen ab', () => {
    expect(isValidCustomsCode('3923301')).toBe(false)
    expect(isValidCustomsCode('392330100')).toBe(false)
    expect(isValidCustomsCode(undefined)).toBe(false)
  })
})

describe('referenceMonthMatches', () => {
  it('vergleicht Monat und Jahr', () => {
    expect(referenceMonthMatches('08', '2026', '08', '2026')).toBe(true)
    expect(referenceMonthMatches('07', '2026', '08', '2026')).toBe(false)
    expect(referenceMonthMatches(undefined, undefined, '08', '2026')).toBe(false)
  })
})
