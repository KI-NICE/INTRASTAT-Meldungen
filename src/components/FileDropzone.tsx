import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

type FileDropzoneProps = {
  label: string
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  hint?: string
}

export function FileDropzone({ label, accept, multiple = false, onFiles, hint }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      className={`dropzone ${isDragOver ? 'dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onFiles(files)
          e.target.value = ''
        }}
      />
      <p className="dropzone__label">{label}</p>
      {hint && <p className="dropzone__hint">{hint}</p>}
      <p className="dropzone__cta">Datei(en) auswählen oder hierher ziehen</p>
    </div>
  )
}
