// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearCountryMappings, saveAddressCountryOverride, lookupAddressCountryOverride } from '../mappingStore'

beforeEach(() => {
  clearCountryMappings()
})

describe('gelernte Länder-Zuordnung über die Adresse', () => {
  it('speichert und liest eine Zuordnung anhand der Adresse', () => {
    saveAddressCountryOverride('Kunde AG\nStr. 1\nB-1000 Bruessel', 'BE')
    expect(lookupAddressCountryOverride('Kunde AG\nStr. 1\nB-1000 Bruessel')).toBe('BE')
  })

  it('gibt null zurück, wenn keine Zuordnung existiert', () => {
    expect(lookupAddressCountryOverride('Unbekannte Adresse')).toBeNull()
    expect(lookupAddressCountryOverride(undefined)).toBeNull()
  })

  it('clearCountryMappings löscht alle gelernten Adress-Zuordnungen', () => {
    saveAddressCountryOverride('Kunde AG\nStr. 1\nB-1000 Bruessel', 'BE')
    clearCountryMappings()
    expect(lookupAddressCountryOverride('Kunde AG\nStr. 1\nB-1000 Bruessel')).toBeNull()
  })
})
