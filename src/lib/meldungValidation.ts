import type { Invoice } from '../types'

/**
 * Vergleicht die aus einer "Zusammenfassenden Meldung" gelesenen
 * Rechnungsnummern mit den bereits aus einer Excel-Datei geparsten
 * Rechnungen (siehe App.tsx, Schritt 2) – über die exakte Rechnungsnummer,
 * die beim Excel-Import sofort bekannt ist.
 */

export type MeldungExtraEntry = { invoiceId: string; invoiceNumber: string }

export type MeldungComparison = {
  /** Rechnungsnummern aus der Meldung, zu denen keine geparste Rechnung passt. */
  missing: string[]
  /** Geparste Rechnungen, deren Nummer nicht auf der Meldung steht. */
  extra: MeldungExtraEntry[]
}

export function compareMeldungWithInvoices(
  meldungNumbers: string[],
  invoices: Pick<Invoice, 'id' | 'invoiceNumber'>[],
): MeldungComparison {
  const invoiceNumbers = invoices.map((inv) => inv.invoiceNumber).filter((n): n is string => !!n)

  const missing = meldungNumbers.filter((number) => !invoiceNumbers.includes(number))

  const extra: MeldungExtraEntry[] = invoices
    .filter((inv) => inv.invoiceNumber && !meldungNumbers.includes(inv.invoiceNumber))
    .map((inv) => ({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber! }))

  return { missing, extra }
}
