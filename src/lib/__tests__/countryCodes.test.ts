import { describe, it, expect } from 'vitest'
import {
  listKnownCountries,
  countryDisplayName,
  resolveCountryFromVatId,
  crosscheckDestinationCountryWithVatId,
} from '../countryCodes'

describe('resolveCountryFromVatId', () => {
  it('liest das Länderkürzel aus dem Präfix der USt-IdNr.', () => {
    expect(resolveCountryFromVatId('BE0123456789')).toBe('BE')
    expect(resolveCountryFromVatId('de123456789')).toBe('DE')
  })

  it('übersetzt die abweichenden USt-IdNr.-Präfixe (Griechenland, Nordirland)', () => {
    expect(resolveCountryFromVatId('EL123456789')).toBe('GR')
    expect(resolveCountryFromVatId('XI123456789')).toBe('GB')
  })

  it('gibt null zurück, wenn kein gültiges Präfix erkennbar ist', () => {
    expect(resolveCountryFromVatId('XY123456789')).toBeNull()
    expect(resolveCountryFromVatId(undefined)).toBeNull()
    expect(resolveCountryFromVatId('')).toBeNull()
  })
})

describe('crosscheckDestinationCountryWithVatId', () => {
  it('überschreibt das von Claude gelesene Land bei Abweichung von der USt-IdNr.', () => {
    const destination = { code: 'AT', source: 'ai' as const, isManual: false }
    const result = crosscheckDestinationCountryWithVatId(destination, 'BE0123456789')
    expect(result?.code).toBe('BE')
    expect(result?.source).toBe('vat-id-override')
    expect(result?.overriddenAddressCode).toBe('AT')
    expect(result?.needsConfirmation).toBe(false)
  })

  it('lässt das Land unverändert, wenn es zur USt-IdNr. passt', () => {
    const destination = { code: 'BE', source: 'ai' as const, isManual: false }
    const result = crosscheckDestinationCountryWithVatId(destination, 'BE0123456789')
    expect(result).toBe(destination)
  })

  it('überschreibt eine bereits manuell bestätigte Auswahl nicht', () => {
    const destination = { code: 'AT', source: 'manual' as const, isManual: true }
    const result = crosscheckDestinationCountryWithVatId(destination, 'BE0123456789')
    expect(result).toBe(destination)
  })

  it('lässt das Land unverändert, wenn die USt-IdNr. kein gültiges Präfix hat', () => {
    const destination = { code: 'AT', source: 'ai' as const, isManual: false }
    expect(crosscheckDestinationCountryWithVatId(destination, undefined)).toBe(destination)
    expect(crosscheckDestinationCountryWithVatId(destination, 'XY0123456789')).toBe(destination)
  })
})

describe('listKnownCountries', () => {
  it('liefert eindeutige, alphabetisch sortierte Länder mit ISO-Code', () => {
    const list = listKnownCountries()
    expect(list.length).toBeGreaterThan(25)
    const codes = list.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(list[0].name.localeCompare(list[1].name, 'de')).toBeLessThanOrEqual(0)
  })
})

describe('countryDisplayName', () => {
  it('liefert den Anzeigenamen zu einem bekannten Code', () => {
    expect(countryDisplayName('BE')).toBe('Belgien')
  })

  it('gibt einen Platzhalter zurück, wenn kein Code vorliegt', () => {
    expect(countryDisplayName(null)).toBe('—')
    expect(countryDisplayName(undefined)).toBe('—')
  })
})
