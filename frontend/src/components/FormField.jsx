import { Children, cloneElement, isValidElement } from 'react'
import { Check, CircleAlert } from 'lucide-react'

// One labelled form control with its own inline feedback.
//
// This started life inside StudentFormPage, which was the only page in the
// app with field-level validation — everywhere else a bad value came back
// from the server as one sentence at the top of the page, leaving the reader
// to work out which of eleven inputs it meant. Lifting it here is what lets
// the other forms have the same behaviour without each re-deriving it.
//
// **The accessibility half was missing entirely.** The app had no
// `aria-invalid` and no `aria-describedby` anywhere, so an error was purely
// visual: a screen reader read the label, read the input, and never
// mentioned that the value in it was rejected or why. That is fixed here
// rather than at each call site, because wiring two ids by hand on every
// input is the kind of thing that gets done on the first form and forgotten
// on the rest.
//
// The control is passed as `children` and cloned to receive those
// attributes. Exactly one element child is expected — an <input>, <select>
// or <textarea>; anything else is rendered untouched rather than throwing,
// since a missing aria attribute is a smaller failure than a blank page.
export function FormField({ id, icon: Icon, label, required, error, hint, showSuccess, width, children }) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  // The hint is only RENDERED when there is no error (an error replaces it
  // in the same slot), so its id must leave aria-describedby at the same
  // moment. Naming an id that is not in the document makes a screen reader
  // skip that description silently, which is worse than not offering one.
  const describedBy = [error ? errorId : null, hint && !error ? hintId : null].filter(Boolean).join(' ') || undefined

  const control = Children.count(children) === 1 && isValidElement(children)
    ? cloneElement(children, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children

  return (
    <div className={`form-field${width ? ` form-field--${width}` : ''}`}>
      <label htmlFor={id} className="form-field__label">
        {Icon && <Icon size={16} strokeWidth={1.75} />}
        {label}
        {required && <span className="required-mark"> *</span>}
      </label>
      {control}
      {hint && !error && (
        <p className="form-field__feedback form-field__feedback--hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        // role="alert" so the message is announced when it appears, not only
        // when the input is next focused.
        <p className="form-field__feedback form-field__feedback--error" id={errorId} role="alert">
          <CircleAlert size={14} strokeWidth={1.75} /> {error}
        </p>
      )}
      {!error && showSuccess && (
        <p className="form-field__feedback form-field__feedback--success">
          <Check size={14} strokeWidth={1.75} /> Looks good
        </p>
      )}
    </div>
  )
}
