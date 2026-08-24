import { useRef } from 'react'

type UploadButtonProps = {
  label: string
  accept: string
  onFile: (file: File) => void
}

/** Schlichter Button, der beim Klick einen Datei-Auswahldialog öffnet (kein Drag&Drop-Feld). */
export function UploadButton({ label, accept, onFile }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </>
  )
}
