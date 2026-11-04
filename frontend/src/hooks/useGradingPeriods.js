import { useEffect, useState } from 'react'
import { api } from '../api/client'

// The grading-period picker, opened on the period the school is actually in.
//
// Three pages need the same two things — the list of periods, and today's
// period selected by default — and only one of them did it. Enter Grades and
// Finalize Grades left the picker on "-- select --", so an adviser with
// verified grades waiting arrived at a page that looked empty and said
// "pick a section and grading period" while the work sat one click away.
// That is the same gap the section pickers had before they learned to open on
// the user's own section.
//
// Verify Grades did it, but by fetching the whole list and matching on NAME,
// because /grading-periods/current used to omit the id. Name matching is
// wrong in a school with more than one year of data: `name` repeats ("Q1"
// exists in every school year) while only the id is unique. The endpoint now
// returns the id, so this resolves it in one request and no guessing.
//
// The caller still owns the value — it is a controlled picker, and changing
// it is the whole point of the control.
export function useGradingPeriods() {
  const [periods, setPeriods] = useState([])
  const [gradingPeriodId, setGradingPeriodId] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.get('/grading-periods').catch(() => null),
      // A failure here is not fatal: the list still loads and the reader
      // simply picks a period themselves, which is where they were before.
      api.get('/grading-periods/current').catch(() => null),
    ]).then(([list, current]) => {
      if (cancelled || !list) return
      setPeriods(list.gradingPeriods)

      const currentId = current?.gradingPeriod?.id
      if (!currentId) return
      // Only pre-select a period that is actually in the list — outside any
      // grading period, or if the two requests disagree, leaving the picker
      // empty is the honest state.
      if (!list.gradingPeriods.some((p) => p.id === currentId)) return
      // `current ||` so this never overwrites a choice the reader has
      // already made while these requests were in flight.
      setGradingPeriodId((chosen) => chosen || String(currentId))
    })

    return () => {
      cancelled = true
    }
  }, [])

  return { periods, gradingPeriodId, setGradingPeriodId }
}
