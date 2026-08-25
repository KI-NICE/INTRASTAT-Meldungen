/**
 * Vergleicht die aus einer "Zusammenfassenden Meldung" gelesenen
 * Rechnungsnummern mit den hochgeladenen Rechnungsdateien – VOR der
 * eigentlichen Analyse durch Claude (siehe App.tsx, Schritt 2). Die
 * Rechnungsnummer einer hochgeladenen Datei wird dafür aus ihrem Dateinamen
 * abgeleitet (Ziffernfolgen ab 5 Stellen), da zu diesem Zeitpunkt noch keine
 * Analyseergebnisse vorliegen.
 */

/** Alle Ziffernfolgen ab 5 Stellen in einem Dateinamen (mögliche Rechnungsnummern-Kandidaten). */
export function extractCandidateNumbersFromFileName(fileName: string): string[] {
  return fileName.match(/\d{5,}/g) ?? []
}

export type MeldungExtraEntry = { fileIndex: number; fileName: string }

export type MeldungComparison = {
  /** Rechnungsnummern aus der Meldung, zu denen keine hochgeladene Datei passt. */
  missing: string[]
  /** Hochgeladene Dateien, deren Dateiname auf keine der Meldungs-Rechnungsnummern passt. */
  extra: MeldungExtraEntry[]
}

/**
 * Dateien ohne erkennbare Ziffernfolge werden weder als "fehlt" noch als
 * "zusätzlich" gewertet, da sich für sie keine Rechnungsnummer bestimmen
 * lässt – ein falscher Alarm wäre hier irreführender als gar keiner.
 */
export function compareMeldungWithFiles(meldungNumbers: string[], files: File[]): MeldungComparison {
  const fileCandidates = files.map((file) => extractCandidateNumbersFromFileName(file.name))

  const missing = meldungNumbers.filter(
    (number) => !fileCandidates.some((candidates) => candidates.includes(number)),
  )

  const extra: MeldungExtraEntry[] = []
  files.forEach((file, fileIndex) => {
    const candidates = fileCandidates[fileIndex]
    if (candidates.length > 0 && !candidates.some((c) => meldungNumbers.includes(c))) {
      extra.push({ fileIndex, fileName: file.name })
    }
  })

  return { missing, extra }
}
