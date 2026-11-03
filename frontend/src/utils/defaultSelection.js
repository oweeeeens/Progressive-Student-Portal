// Opens a picker on the thing this person actually works with, instead of
// "-- select --".
//
// An adviser marking the daily register works with ONE section, every day.
// Making them choose it first is a click that can only ever have one answer,
// on the screen they use most. The same is true of a teacher with a single
// class, and of the grade sheets.
//
// Where there genuinely is a choice — two advisory sections, several classes
// — the first is pre-selected and the picker stays, so nothing is hidden.
// The page simply opens on something rather than on nothing.
//
// `scopedToMe` is the important argument. It is only safe to pick for
// someone when the list is their OWN (`/sections/mine`,
// `/class-offerings/mine`). Admin and registrar get every section in the
// school, and defaulting to whichever happens to sort first would be a
// guess at which class they meant — so they still choose.
export function defaultSelection(items, scopedToMe) {
  if (!scopedToMe || !items || items.length === 0) return ''
  return String(items[0].id)
}
