import { describe, it, expect } from 'vitest'
import { resolveCountryCode } from '../countryCodes'

describe('resolveCountryCode', () => {
  it('erkennt gängige Ländernamen', () => {
    expect(resolveCountryCode('Österreich')).toBe('AT')
    expect(resolveCountryCode('Frankreich')).toBe('FR')
    expect(resolveCountryCode('Italien')).toBe('IT')
    expect(resolveCountryCode('Belgien')).toBe('BE')
  })

  it('ist tolerant bei Groß-/Kleinschreibung und Leerzeichen', () => {
    expect(resolveCountryCode('  österreich ')).toBe('AT')
    expect(resolveCountryCode('FRANKREICH')).toBe('FR')
  })

  it('akzeptiert bereits gültige ISO-Codes', () => {
    expect(resolveCountryCode('at')).toBe('AT')
    expect(resolveCountryCode('FR')).toBe('FR')
  })

  it('gibt null zurück, wenn das Land nicht eindeutig erkennbar ist', () => {
    expect(resolveCountryCode('Nirgendland')).toBeNull()
    expect(resolveCountryCode('')).toBeNull()
    expect(resolveCountryCode(undefined)).toBeNull()
    expect(resolveCountryCode('XX')).toBeNull()
  })
})
