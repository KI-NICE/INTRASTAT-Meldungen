const STEP_LABELS = [
  'Mustertabelle',
  'Gewichtsliste',
  'Bezugsmonat',
  'Rechnungen',
  'Analyse',
  'Prüfung',
  'Vorschau',
  'Export',
]

export function StepNav({ currentStep }: { currentStep: number }) {
  return (
    <ol className="step-nav">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1
        const state = stepNumber === currentStep ? 'active' : stepNumber < currentStep ? 'done' : 'pending'
        return (
          <li key={label} className={`step-nav__item step-nav__item--${state}`}>
            <span className="step-nav__number">{stepNumber}</span>
            <span className="step-nav__label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
