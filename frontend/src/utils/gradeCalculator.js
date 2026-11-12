// Live preview of a learner's term grade while the teacher types scores in
// the Class Record.
//
// THIS IS A PREVIEW, NOT THE GRADE. The authoritative computation is
// backend/services/gradeCalculator.js: every save returns the server's
// result, and submitting recomputes on the server from the stored scores.
// This mirror exists only so the Term Grade column moves as a score is
// typed instead of after a round trip. It deliberately carries none of
// DepEd's numbers itself — weights, exam split and the transmutation table
// all arrive in the record's `policy`, from backend/config/gradingPolicy.js
// — so the two cannot disagree about policy, only (in principle) about
// arithmetic, which is the same five steps written the same way.

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toTermGrade(initialGrade, policy) {
  const ig = round2(initialGrade)
  if (policy.mode === 'zero_based') return Math.max(policy.minimumGrade, Math.round(ig))
  for (const [minimum, grade] of policy.transmutationTable) {
    if (ig >= minimum) return grade
  }
  return policy.minimumGrade
}

// Step 1 + 2 over a set of items: total raw and highest scores → percentage.
function scoreItems(items, scores) {
  let raw = 0
  let hps = 0
  let missing = 0
  for (const item of items) {
    hps += item.highestPossibleScore
    const score = scores[item.id]
    if (score === undefined || score === null || score === '') missing += 1
    else raw += Number(score)
  }
  return { raw: round2(raw), hps: round2(hps), ps: hps > 0 && missing === 0 ? round2((raw / hps) * 100) : null, missing }
}

const COMPONENT_LABELS = { ww: 'Written/Oral Works', pt: 'Product/Performance Tasks', ex: 'Examinations' }
const PART_LABELS = { st1: 'Summative Test 1', st2: 'Summative Test 2', te: 'Term Examination' }

// Same output shape as the server's computeTermGrade (the parts the page
// reads): components with PS/WS, initialGrade, termGrade, complete.
export function previewTermGrade(items, scores, policy) {
  const components = []
  let complete = true
  for (const key of ['ww', 'pt', 'ex']) {
    const weight = policy.weights[key]
    if (weight === null || weight === undefined) continue
    const own = items.filter((i) => i.component === key)
    const entry = { key, label: COMPONENT_LABELS[key], weight, percentageScore: null, weightedScore: null, parts: null }
    if (key !== 'ex') {
      const scored = scoreItems(own, scores)
      if (own.length === 0 || scored.ps === null) complete = false
      Object.assign(entry, { rawScore: scored.raw, highestPossibleScore: scored.hps, percentageScore: own.length ? scored.ps : null })
    } else {
      const partKeys = policy.examParts
      let sum = 0
      let examComplete = partKeys.length > 0
      entry.parts = partKeys.map((part) => {
        const partWeight = partKeys.length === 1 ? 1 : policy.examPartWeights[part]
        const partItems = own.filter((i) => i.examPart === part)
        const scored = scoreItems(partItems, scores)
        const ok = partItems.length > 0 && scored.ps !== null
        if (!ok) examComplete = false
        const weightedScore = ok ? round2(scored.ps * partWeight) : null
        if (ok) sum += weightedScore
        return { key: part, label: PART_LABELS[part], weight: partWeight, rawScore: scored.raw, highestPossibleScore: scored.hps, percentageScore: ok ? scored.ps : null, weightedScore }
      })
      if (examComplete) entry.percentageScore = round2(sum)
      else complete = false
    }
    if (entry.percentageScore !== null) entry.weightedScore = round2(entry.percentageScore * weight)
    components.push(entry)
  }
  const initialGrade = complete ? round2(components.reduce((s, c) => s + c.weightedScore, 0)) : null
  return { components, initialGrade, termGrade: complete ? toTermGrade(initialGrade, policy) : null, complete }
}
