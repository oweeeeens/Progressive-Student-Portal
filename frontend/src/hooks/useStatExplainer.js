import { useCallback, useState } from 'react'

// The open/closed state behind a row of clickable stat cards, plus the three
// props each card needs to be a correct disclosure control.
//
// WHY A HOOK AND NOT NINE COPIES. The student pages already did this by
// hand — `const [openStat, setOpenStat] = useState(null)`, a `toggleStat`,
// and `onClick` / `isExpanded` / `aria-controls` repeated on every card. It
// works, but it is four things to get right per card, and `aria-controls` in
// particular is the kind of detail that is correct on the page someone was
// looking at and quietly missing on the other eight. Extending that pattern
// to every stat row in the app meant either repeating it ~40 more times or
// writing it once. This is once.
//
// `cardProps(key)` is the whole interface: spread it onto a StatCard and the
// card becomes a button that opens the matching panel, reports its state to
// a screen reader, and closes when clicked again.
//
// WHY THE PANEL ID IS PART OF THE STATE. A page can have more than one stat
// row — Analytics has six on one tab, an overall row plus one per
// intervention type — and each needs its explanation to open under the row
// that was clicked, not at the top of the page. Tracking only the open KEY
// was not enough: every panel on the page read the same key, so one click
// rendered the same explanation under all six rows at once, each carrying
// the same `id`, which is invalid HTML and leaves `aria-controls` pointing
// at six elements. The open panel's id is therefore part of what is stored,
// and `openFor(panelId)` answers "is it mine?" — so exactly one panel ever
// renders.
export function useStatExplainer(defaultPanelId) {
  // { key, panelId } for the card currently open, or null. One at a time
  // across the whole page: two open panels would push the figure being
  // explained off the screen, and the reader has to be able to see the
  // number and its explanation together.
  const [open, setOpen] = useState(null)

  const toggle = useCallback((key) => {
    setOpen((current) => (current && current.key === key ? null : { key, panelId: null }))
  }, [])

  const close = useCallback(() => setOpen(null), [])

  const cardProps = useCallback(
    (key, panelId = defaultPanelId) => ({
      onClick: () =>
        setOpen((current) => (current && current.key === key ? null : { key, panelId })),
      isExpanded: open?.key === key,
      controls: panelId,
    }),
    [open, defaultPanelId]
  )

  // Which key this particular panel should show, or null when the open card
  // belongs to a different row. A page with one row can call it with no
  // argument and ignore that it was ever a question.
  const openFor = useCallback(
    (panelId = defaultPanelId) => (open?.panelId === panelId ? open.key : null),
    [open, defaultPanelId]
  )

  return { openStat: open?.key ?? null, openFor, close, cardProps, toggle }
}
