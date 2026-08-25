// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { compareMeldungWithFiles, extractCandidateNumbersFromFileName } from '../meldungValidation'

function pdf(name: string): File {
  return new File([], name, { type: 'application/pdf' })
}

describe('extractCandidateNumbersFromFileName', () => {
  it('findet Ziffernfolgen ab 5 Stellen, ignoriert kürzere', () => {
    expect(extractCandidateNumbersFromFileName('RE168094_Beispielfelder.pdf')).toEqual(['168094'])
    expect(extractCandidateNumbersFromFileName('Rechnung_2026.pdf')).toEqual([])
  })
})

describe('compareMeldungWithFiles', () => {
  it('meldet keine Abweichung, wenn jede Meldungs-Nummer durch genau eine Datei gedeckt ist', () => {
    const files = [pdf('RE168049.pdf'), pdf('RE167924.pdf')]
    const result = compareMeldungWithFiles(['168049', '167924'], files)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })

  it('meldet eine Meldungs-Nummer als fehlend, wenn keine Datei dazu passt', () => {
    const files = [pdf('RE168049.pdf')]
    const result = compareMeldungWithFiles(['168049', '167924'], files)
    expect(result.missing).toEqual(['167924'])
    expect(result.extra).toEqual([])
  })

  it('meldet eine Datei als zusätzlich, wenn ihre Nummer nicht auf der Meldung steht', () => {
    const files = [pdf('RE168049.pdf'), pdf('RE999999.pdf')]
    const result = compareMeldungWithFiles(['168049'], files)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([{ fileIndex: 1, fileName: 'RE999999.pdf' }])
  })

  it('ignoriert Dateien ohne erkennbare Ziffernfolge (weder fehlend noch zusätzlich)', () => {
    const files = [pdf('Rechnung ohne Nummer.pdf')]
    const result = compareMeldungWithFiles(['168049'], files)
    expect(result.missing).toEqual(['168049'])
    expect(result.extra).toEqual([])
  })

  it('behandelt eine doppelt vorkommende Rechnungsnummer nicht als fehlend', () => {
    const files = [pdf('RE167924_a.pdf'), pdf('RE167924_b.pdf')]
    const result = compareMeldungWithFiles(['167924'], files)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })
})
