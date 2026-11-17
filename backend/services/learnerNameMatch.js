// =============================================================================
// Matching a learner's name on an SF2 to the section's roster
// =============================================================================
// DepEd's official School Form 2 lists learners by name ("Last Name, First
// Name, Middle Name") with no LRN, so an imported SF2 has to be matched by
// name. Pure — no database access — so the rule can be read and tested on
// its own.
//
// The rule, and why it never guesses:
//   1. Names are compared as sets of words, ignoring case, punctuation,
//      accents and the order of the parts — "Garcia, Eve S." and
//      "GARCIA EVE SANTOS" are the same person to a teacher, and should be
//      here too.
//   2. A roster learner is a candidate when ALL the words of their last and
//      first name appear in the sheet's name.
//   3. Exactly one candidate -> matched. More than one -> the middle name
//      breaks the tie (its words, or just its initial). Still more than
//      one, or none -> NOT matched, with the reason, for the user to fix.
//      Writing a day's attendance onto the wrong learner is worse than
//      skipping a row the user can see.
// =============================================================================

// "Garcia, Eve S." -> ['garcia', 'eve', 's']
function words(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents: Peña -> Pena
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// roster: [{ id, lrn, first_name, middle_name, last_name }]
function buildNameIndex(roster) {
  return roster.map((s) => ({
    student: s,
    core: [...words(s.last_name), ...words(s.first_name)],
    middle: words(s.middle_name),
  }));
}

// Returns { student } on a match, or { reason } when there is none.
function matchName(sheetName, index) {
  const have = new Set(words(sheetName));
  if (have.size === 0) return { reason: 'No name in this row.' };

  let candidates = index.filter((e) => e.core.length > 0 && e.core.every((w) => have.has(w)));
  if (candidates.length > 1) {
    // Tie-break on the middle name: all its words present, or its initial.
    const byMiddle = candidates.filter((e) => e.middle.length > 0
      && (e.middle.every((w) => have.has(w)) || have.has(e.middle[0][0])));
    if (byMiddle.length >= 1) candidates = byMiddle;
  }
  if (candidates.length === 1) return { student: candidates[0].student };
  if (candidates.length === 0) return { reason: 'No learner with this name in the section.' };
  return { reason: `${candidates.length} learners in the section share this name; add the middle name to tell them apart.` };
}

module.exports = { words, buildNameIndex, matchName };
