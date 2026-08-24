// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  deriveReferencePeriod,
  normalizeInvoiceDateInput,
  resolveAmbiguousDateFormat,
  resolveDestinationCountry,
  buildInvoiceFromAi,
  buildManualInvoice,
  buildManualPosition,
  isNonMerchandiseArticleNumber,
} from '../aiInvoiceBuilder'
import { saveAddressCountryOverride, clearCountryMappings } from '../mappingStore'
import type { AiInvoiceFields } from '../../types'

beforeEach(() => {
  clearCountryMappings()
})

describe('deriveReferencePeriod', () => {
  it('leitet Monat und Jahr aus dem Rechnungsdatum ab', () => {
    expect(deriveReferencePeriod('05.08.2026')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod('5.8.26')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod(undefined)).toBeUndefined()
  })

  it('gibt undefined zurück bei unklarem Format', () => {
    expect(deriveReferencePeriod('nicht ein datum')).toBeUndefined()
  })
})

describe('normalizeInvoiceDateInput', () => {
  it('wandelt eine 8-stellige Ziffernfolge in TT.MM.JJJJ um', () => {
    expect(normalizeInvoiceDateInput('01072026')).toBe('01.07.2026')
  })

  it('wandelt eine 6-stellige Ziffernfolge (2-stelliges Jahr) in TT.MM.JJJJ um', () => {
    expect(normalizeInvoiceDateInput('010726')).toBe('01.07.2026')
  })

  it('lässt bereits mit Punkten versehene Eingaben unverändert', () => {
    expect(normalizeInvoiceDateInput('01.07.2026')).toBe('01.07.2026')
  })

  it('lässt unklare Eingaben (weder 6 noch 8 Ziffern) unverändert', () => {
    expect(normalizeInvoiceDateInput('0107202')).toBe('0107202')
    expect(normalizeInvoiceDateInput('')).toBe('')
  })
})

describe('resolveAmbiguousDateFormat', () => {
  it('wählt TT/MM/JJJJ, wenn nur diese Lesart zum gewählten Bezugsmonat passt', () => {
    // 13 kann kein Monat sein -> muss TT/MM/JJJJ sein (13.07.2026).
    expect(resolveAmbiguousDateFormat('13/07/2026', '07')).toBe('13.07.2026')
  })

  it('wählt MM/TT/JJJJ, wenn nur diese Lesart zum gewählten Bezugsmonat passt', () => {
    // "07/13/2026": als TT/MM ergäbe das Monat 13 (ungültig) -> MM/TT, Bezugsmonat 07 bestätigt das.
    expect(resolveAmbiguousDateFormat('07/13/2026', '07')).toBe('13.07.2026')
  })

  it('bevorzugt TT/MM/JJJJ (europäische Konvention), wenn beide Lesarten gültig sind und der Bezugsmonat nicht hilft', () => {
    expect(resolveAmbiguousDateFormat('01/07/2026')).toBe('01.07.2026')
  })

  it('weicht auf MM/TT/JJJJ aus, wenn TT/MM einen ungültigen Monat ergäbe (kein Bezugsmonat vorhanden)', () => {
    // "07/25/2026": als TT/MM ergäbe das Monat 25 (ungültig) -> MM/TT/JJJJ (25.07.2026).
    expect(resolveAmbiguousDateFormat('07/25/2026')).toBe('25.07.2026')
  })

  it('wandelt ein 2-stelliges Jahr in ein 4-stelliges um', () => {
    expect(resolveAmbiguousDateFormat('01/07/26')).toBe('01.07.2026')
  })

  it('lässt bereits punktgetrennte Daten unverändert', () => {
    expect(resolveAmbiguousDateFormat('13.07.2026', '07')).toBe('13.07.2026')
  })

  it('lässt undefined/leer unverändert', () => {
    expect(resolveAmbiguousDateFormat(undefined, '07')).toBeUndefined()
  })
})

describe('resolveDestinationCountry', () => {
  it('verwendet den von Claude gelesenen Code, wenn keine Zuordnung gelernt wurde', () => {
    const result = resolveDestinationCountry('AT', 'Kunde AG\nHandelskaai 12\nA-1010 Wien')
    expect(result.code).toBe('AT')
    expect(result.source).toBe('ai')
    expect(result.isManual).toBe(false)
  })

  it('bevorzugt eine für genau diese Adresse gelernte Zuordnung', () => {
    const address = 'Kunde AG\nHandelskaai 12\nA-1010 Wien'
    saveAddressCountryOverride(address, 'DE')
    const result = resolveDestinationCountry('AT', address)
    expect(result.code).toBe('DE')
    expect(result.source).toBe('gelernte-zuordnung')
  })

  it('markiert das Ergebnis als ungeklärt, wenn nichts vorliegt', () => {
    const result = resolveDestinationCountry(null, null)
    expect(result.code).toBeNull()
    expect(result.source).toBe('unresolved')
    expect(result.needsConfirmation).toBe(true)
  })
})

describe('buildInvoiceFromAi', () => {
  it('sperrt die Rechnung, wenn das Auslesen fehlgeschlagen ist', () => {
    const invoice = buildInvoiceFromAi('id-1', 'rechnung.pdf', 'V', null, 'Netzwerkfehler')
    expect(invoice.status).toBe('error')
    expect(invoice.positions).toHaveLength(0)
    expect(invoice.ai?.status).toBe('fehler')
    expect(invoice.ai?.error).toBe('Netzwerkfehler')
  })

  it('baut die Kopfdaten aus den von Claude gelesenen Feldern auf', () => {
    const fields: AiInvoiceFields = {
      language: 'de',
      invoiceNumber: '4711-2026',
      invoiceDate: '05.08.2026',
      vatId: 'BE 0123456789',
      destinationCountryCode: 'BE',
      destinationAddressUsed: 'lieferadresse',
      destinationAddressText: 'Kunde AG\nRue de la Paix 5\nB-1000 Bruessel',
      netWeightTotalKg: 56,
      freightCostEur: 10,
      positions: [],
      uncertainFields: [],
    }
    const invoice = buildInvoiceFromAi('id-2', 'rechnung.pdf', 'V', { model: 'claude-x', fields }, undefined)

    expect(invoice.invoiceNumber).toBe('4711-2026')
    expect(invoice.referenceMonth).toBe('08')
    expect(invoice.referenceYear).toBe('2026')
    expect(invoice.vatId).toBe('BE0123456789')
    expect(invoice.destinationCountry?.code).toBe('BE')
    expect(invoice.destinationAddressKind).toBe('lieferadresse')
    expect(invoice.netWeightTotal).toBe(56)
    expect(invoice.freightCost).toBe(10)
    expect(invoice.ai?.status).toBe('fertig')
    expect(invoice.ai?.model).toBe('claude-x')
  })

  it('normalisiert die Warennummer und setzt Spalte M bei 39233010', () => {
    const fields: AiInvoiceFields = {
      positions: [
        { positionNumber: '10', productDescription: 'Sprayer K2', customsCode: '3923-5000', quantity: 1000, amountEur: 125 },
        { positionNumber: '20', productDescription: 'Zyl.Flasche', customsCode: '39233010', quantity: 252, amountEur: 75.6 },
      ],
    }
    const invoice = buildInvoiceFromAi('id-3', 'rechnung.pdf', 'V', { model: 'claude-x', fields }, undefined)

    expect(invoice.positions[0].customsCode).toBe('39235000')
    expect(invoice.positions[0].isSpecialUnit).toBe(false)
    expect(invoice.positions[1].isSpecialUnit).toBe(true)
  })

  it('erkennt Frachtkosten-Positionen über die Artikelnummer 090025', () => {
    const fields: AiInvoiceFields = {
      positions: [
        {
          positionNumber: '30',
          productDescription: 'Frachtkosten',
          customsCode: null,
          quantity: null,
          amountEur: -15.5,
          articleNumber: '090025',
        },
      ],
    }
    const invoice = buildInvoiceFromAi('id-4', 'rechnung.pdf', 'V', { model: 'claude-x', fields }, undefined)
    const position = invoice.positions[0]

    expect(position.isTransportCost).toBe(true)
    expect(position.articleNumberRaw).toBe('090025')
    // Trotz negativem Betrag keine Gutschrift/Storno-Markierung, da Frachtkosten-Position.
    expect(position.isCreditOrDiscountOrNegative).toBe(false)
  })

  it('erkennt Gutschrift/Storno über negativen Betrag oder das KI-Flag', () => {
    const fields: AiInvoiceFields = {
      positions: [
        { positionNumber: '10', productDescription: 'Gutschrift', customsCode: '39235000', quantity: 10, amountEur: -5 },
        { positionNumber: '20', productDescription: 'Rabatt', customsCode: '39235000', quantity: 10, amountEur: 5, isCreditOrDiscount: true },
      ],
    }
    const invoice = buildInvoiceFromAi('id-5', 'rechnung.pdf', 'V', { model: 'claude-x', fields }, undefined)

    expect(invoice.positions[0].isCreditOrDiscountOrNegative).toBe(true)
    expect(invoice.positions[1].isCreditOrDiscountOrNegative).toBe(true)
  })

  it('filtert leere Einträge aus den unsicheren Feldern', () => {
    const fields: AiInvoiceFields = { positions: [], uncertainFields: ['vatId', '', '   '] }
    const invoice = buildInvoiceFromAi('id-6', 'rechnung.pdf', 'V', { model: 'claude-x', fields }, undefined)
    expect(invoice.ai?.uncertainFields).toEqual(['vatId'])
  })

  it('übernimmt die übergebene Richtung (Ausgang/Eingang)', () => {
    const ausgang = buildInvoiceFromAi('id-7', 'rechnung.pdf', 'V', { model: 'x', fields: { positions: [] } })
    const eingang = buildInvoiceFromAi('id-8', 'rechnung.pdf', 'E', { model: 'x', fields: { positions: [] } })
    expect(ausgang.richtung).toBe('V')
    expect(eingang.richtung).toBe('E')
  })

  it('behandelt jede Artikelnummer mit Präfix "09" wie eine Frachtkosten-/Zuschlagsposition', () => {
    const fields: AiInvoiceFields = {
      positions: [
        { positionNumber: '10', productDescription: 'Sonstiger Zuschlag', customsCode: null, quantity: null, amountEur: 8, articleNumber: '090099' },
      ],
    }
    const invoice = buildInvoiceFromAi('id-9', 'rechnung.pdf', 'V', { model: 'x', fields })
    expect(invoice.positions[0].isTransportCost).toBe(true)
  })

  it('rechnet eine erkannte Materialteuerungszuschlag-Position der vorangehenden Artikelposition zu', () => {
    // "002000" hat laut MTZ-Artikel.xlsx den Zuschlagsartikel "090040".
    const fields: AiInvoiceFields = {
      positions: [
        { positionNumber: '10', productDescription: 'Sprayer K2', customsCode: '39235000', quantity: 1000, amountEur: 100, articleNumber: '002000' },
        { positionNumber: '20', productDescription: 'Materialteuerungszuschlag', customsCode: null, quantity: null, amountEur: 12, articleNumber: '090040' },
      ],
    }
    const invoice = buildInvoiceFromAi('id-10', 'rechnung.pdf', 'V', { model: 'x', fields })

    const [article, mtz] = invoice.positions
    expect(mtz.isMtzSurcharge).toBe(true)
    expect(mtz.isTransportCost).toBe(false)
    expect(article.isMtzSurcharge).toBe(false)
    expect(article.mtzSurchargeEurRaw).toBe(12)
    // Der Zuschlag wird direkt auf den Positionswert des Artikels aufgeschlagen.
    expect(article.amountEur).toBe(112)
  })

  it('behandelt eine "09"-Position ohne passende Zuordnung weiterhin als allgemeine Frachtkosten-/Zuschlagsposition', () => {
    // "002001" hat laut MTZ-Artikel.xlsx KEINEN Zuschlagsartikel ("-").
    const fields: AiInvoiceFields = {
      positions: [
        { positionNumber: '10', productDescription: 'Sprayer K2', customsCode: '39235000', quantity: 1000, amountEur: 100, articleNumber: '002001' },
        { positionNumber: '20', productDescription: 'Unbekannter Zuschlag', customsCode: null, quantity: null, amountEur: 5, articleNumber: '090099' },
      ],
    }
    const invoice = buildInvoiceFromAi('id-11', 'rechnung.pdf', 'V', { model: 'x', fields })

    const [article, other] = invoice.positions
    expect(other.isMtzSurcharge).toBe(false)
    expect(other.isTransportCost).toBe(true)
    expect(article.amountEur).toBe(100)
  })
})

describe('Spalten E/G/H/I (Versendungsmitgliedstaat/Bestimmungsbundesland/Ursprungsbundesland/Ursprungsland)', () => {
  it('setzt bei Ausgangsrechnungen die fachlich fest hinterlegten Werte, unabhängig von AI-Feldern', () => {
    const fields: AiInvoiceFields = {
      positions: [],
      versendungsmitgliedstaatCode: 'NL',
      ursprungslandCode: 'NL',
    }
    const invoice = buildInvoiceFromAi('id-v', 'rechnung.pdf', 'V', { model: 'x', fields })
    expect(invoice.versendungsMitgliedstaat).toBe('')
    expect(invoice.bestimmungsBundesland).toBe('')
    expect(invoice.ursprungsBundesland).toBe('09')
    expect(invoice.ursprungsland).toBe('DE')
  })

  it('übernimmt bei Eingangsrechnungen E und I von Claude, setzt G fest auf "09" und lässt H leer', () => {
    const fields: AiInvoiceFields = {
      positions: [],
      versendungsmitgliedstaatCode: 'NL',
      ursprungslandCode: 'NL',
    }
    const invoice = buildInvoiceFromAi('id-e', 'rechnung.pdf', 'E', { model: 'x', fields })
    expect(invoice.versendungsMitgliedstaat).toBe('NL')
    expect(invoice.bestimmungsBundesland).toBe('09')
    expect(invoice.ursprungsBundesland).toBe('')
    expect(invoice.ursprungsland).toBe('NL')
  })

  it('lässt E/I bei Eingangsrechnungen leer (undefined), wenn Claude sie nicht lesen konnte', () => {
    const fields: AiInvoiceFields = { positions: [] }
    const invoice = buildInvoiceFromAi('id-e2', 'rechnung.pdf', 'E', { model: 'x', fields })
    expect(invoice.versendungsMitgliedstaat).toBeUndefined()
    expect(invoice.bestimmungsBundesland).toBe('09')
    expect(invoice.ursprungsBundesland).toBe('')
    expect(invoice.ursprungsland).toBeUndefined()
  })

  it('setzt bei manuell erfassten Rechnungen die jeweils festen Werte', () => {
    const ausgang = buildManualInvoice('manual-v', 'V')
    expect(ausgang.ursprungsBundesland).toBe('09')
    expect(ausgang.ursprungsland).toBe('DE')

    const eingang = buildManualInvoice('manual-e', 'E')
    expect(eingang.versendungsMitgliedstaat).toBeUndefined()
    expect(eingang.bestimmungsBundesland).toBe('09')
    expect(eingang.ursprungsBundesland).toBe('')
  })
})

describe('isNonMerchandiseArticleNumber', () => {
  it('erkennt jede Artikelnummer mit Präfix "09"', () => {
    expect(isNonMerchandiseArticleNumber('090025')).toBe(true)
    expect(isNonMerchandiseArticleNumber('090040')).toBe(true)
    expect(isNonMerchandiseArticleNumber('002000')).toBe(false)
    expect(isNonMerchandiseArticleNumber(undefined)).toBe(false)
  })
})

describe('manuelle Erfassung', () => {
  it('buildManualInvoice erzeugt eine leere Rechnung mit gesetzter Richtung', () => {
    const invoice = buildManualInvoice('manual-1', 'E')
    expect(invoice.richtung).toBe('E')
    expect(invoice.isManualEntry).toBe(true)
    expect(invoice.positions).toEqual([])
  })

  it('buildManualPosition erzeugt eine leere, editierbare Position', () => {
    const position = buildManualPosition()
    expect(position.isManualEntry).toBe(true)
    expect(position.productNameRaw).toBe('')
    expect(position.isTransportCost).toBe(false)
    expect(position.isMtzSurcharge).toBe(false)
  })
})
