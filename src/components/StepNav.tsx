const STEP_LABELS = ['Bezugsmonat', 'Rechnungen', 'Analyse', 'Prüfung', 'Vorschau', 'Export']

export function StepNav({ currentStep, onNavigate }: { currentStep: number; onNavigate?: (step: number) => void }) {
  return (
    <ol className="step-nav">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1
        const state = stepNumber === currentStep ? 'active' : stepNumber < currentStep ? 'done' : 'pending'
        const clickable = onNavigate && stepNumber < currentStep
        return (
          <li key={label} className={`step-nav__item step-nav__item--${state}`}>
            <button
              type="button"
              className="step-nav__button"
              disabled={!clickable}
              onClick={() => clickable && onNavigate?.(stepNumber)}
            >
              <span className="step-nav__number">{stepNumber}</span>
              <span className="step-nav__label">{label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
