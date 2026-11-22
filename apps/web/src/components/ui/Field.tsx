import type { ReactNode } from 'react'

export interface FieldProps {
  label: string
  /** id of the control this label points at. */
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
}

/** Label + control + hint/error, with the label wired to the control id. */
export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="error"> *</span> : null}
      </label>
      {children}
      {error ? (
        <div className="hint text-danger" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  )
}
