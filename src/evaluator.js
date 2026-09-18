// Evaluation and Solve-for-me logic for Patchboard.
//
// Both are driven purely by a puzzle's `requiredComponents` and
// `requiredConnections`, so the grader and the reference solution can never
// drift apart. Nothing here touches the DOM; it takes a board snapshot (from
// Board.snapshot()) and returns plain data the UI renders.

// Score a board snapshot against the active puzzle.
//
// total       = requiredComponents.length + requiredConnections.length
// rawScore    = round(satisfied / total * 100)
// finalScore  = max(0, rawScore - 5 * hintsUsed)
//
// Returns per-requirement pass/fail so the UI can show a checklist. Explicitly
// out of scope (per the PRD): topology soundness beyond the checklist, capacity
// or cost, penalizing extra/unused blocks, and partial credit within a
// requirement.
export function evaluate(puzzle, snapshot, hintsUsed) {
  const { placedTypes, connectionPairs } = snapshot;

  // Count of each placed built-in type. Custom types (prefixed `custom:`) are
  // included in the map but never appear in a requirement's `ids`, so they can
  // never satisfy a checklist entry.
  const typeCounts = new Map();
  for (const t of placedTypes) typeCounts.set(t, (typeCounts.get(t) || 0) + 1);

  const componentResults = puzzle.requiredComponents.map((req) => {
    const count = req.ids.reduce((sum, id) => sum + (typeCounts.get(id) || 0), 0);
    return { label: req.label, satisfied: count >= req.min, kind: 'component' };
  });

  const connectionResults = puzzle.requiredConnections.map((req) => {
    const satisfied = connectionPairs.some(
      (pair) =>
        (req.from.includes(pair.from) && req.to.includes(pair.to)) ||
        (req.from.includes(pair.to) && req.to.includes(pair.from)), // direction-agnostic
    );
    return { label: req.label, satisfied, kind: 'connection' };
  });

  const results = [...componentResults, ...connectionResults];
  const total = results.length;
  const satisfied = results.filter((r) => r.satisfied).length;

  const rawScore = total === 0 ? 0 : Math.round((satisfied / total) * 100);
  const penalty = 5 * hintsUsed;
  const finalScore = Math.max(0, rawScore - penalty);

  return { results, total, satisfied, rawScore, penalty, hintsUsed, finalScore };
}

// A color tier for the score reveal.
export function scoreTier(score) {
  if (score >= 85) return 'gold';
  if (score >= 60) return 'cyan';
  return 'red';
}

// Build the reference solution as an ordered list of steps from the SAME
// requirement data the grader uses. Steps are executed by the app layer with a
// stagger so each block pops in with its normal animation and sound.
//
// Each connection references its endpoints by the canonical first alternate
// (from[0] -> to[0]). A connection endpoint that is not itself a required
// component (e.g. `client`) is emitted as a `place` step first, so the app can
// always find a block to wire.
export function buildSolution(puzzle) {
  const steps = [];
  const placedCount = new Map(); // type -> how many we've scheduled

  const schedulePlace = (type) => {
    steps.push({ kind: 'place', type });
    placedCount.set(type, (placedCount.get(type) || 0) + 1);
  };
  const ensureAtLeastOne = (type) => {
    if (!placedCount.get(type)) schedulePlace(type);
  };

  // 1. Required components: place `min` of the canonical alternate.
  for (const req of puzzle.requiredComponents) {
    const type = req.ids[0];
    for (let i = 0; i < req.min; i++) schedulePlace(type);
  }

  // 2. Required connections: ensure both canonical endpoints exist, then wire.
  for (const req of puzzle.requiredConnections) {
    const from = req.from[0];
    const to = req.to[0];
    ensureAtLeastOne(from);
    ensureAtLeastOne(to);
    steps.push({ kind: 'connect', from, to });
  }

  // Explanation text is literally the authored requirement labels, so a learner
  // reads the same wording the grader checks.
  const explanation = {
    components: puzzle.requiredComponents.map((r) => r.label),
    connections: puzzle.requiredConnections.map((r) => r.label),
  };

  return { steps, explanation };
}
