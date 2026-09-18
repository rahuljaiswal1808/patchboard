# Patchboard

A browser game that turns system-design practice into an interactive puzzle
instead of a whiteboard exercise done alone. Pick a real-world prompt (URL
shortener, distributed rate limiter, real-time chat backend), drag labeled
architecture components onto a blueprint canvas, wire them together, and submit
for a checklist-based score. Three hints per puzzle, each costing 5 points. Stuck?
"Solve for me" builds one valid reference solution on the board and explains it.

This is a personal project: no accounts, no backend, no monetization. It runs
entirely in the browser.

## Run it

The app uses native ES modules, so it must be served over HTTP (opening
`index.html` from `file://` will fail on module CORS). Any static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step, no dependencies, no bundler.

## Project structure

```
index.html            Markup and DOM scaffolding
css/styles.css        Blueprint theme, layout, animations, reduced-motion
src/
  main.js             App orchestration: wires data + canvas + evaluator + sound to the UI
  canvas.js           Board: placement, drag, connect mode, deletion, SVG connection rendering
  evaluator.js        Scoring algorithm and the "Solve for me" build plan
  sound.js            Web Audio sound engine (all effects synthesized at runtime)
  data/
    components.js     The 14 built-in component types, 6 categories, and icons
    puzzles.js        Puzzle definitions (add a puzzle here, no logic changes needed)
```

## Adding a puzzle

Append one object to `PUZZLES` in `src/data/puzzles.js`. Authoring rules:

- `ids` in a requirement is a list of acceptable alternates; **any one** satisfies
  it. This is what lets two valid architectures both score well.
- `requiredConnections` are checked by type, not by block instance, and are
  **direction-agnostic** (either order of `from`/`to` counts).
- The **first** id in each `ids`/`from`/`to` list is canonical: it is what
  "Solve for me" places and wires. Keep first alternates consistent across a
  problem's requirements and connections, or auto-solve will build components
  that were never meant to connect.
- Supply exactly **3 hints**, ordered most conceptual to most specific.
- Requirement `label` text is reused verbatim in the evaluation checklist and the
  Solve-for-me explanation, so write each label as a complete standalone sentence.

## Scoring

```
total      = requiredComponents.length + requiredConnections.length
rawScore   = round(satisfied / total * 100)
finalScore = max(0, rawScore - 5 * hintsUsed)
```

Tiers: gold (85+), cyan (60–84), red (below 60). Out of scope by design: topology
soundness beyond the checklist, capacity/cost, penalizing extra blocks, and
partial credit within a single requirement.

## Interaction

- **Pan & zoom.** Drag empty canvas to pan; scroll to zoom (or use the +/−/reset
  controls, bottom-right). Blocks and connections live in a transformed "world"
  layer, so all pointer math accounts for the current zoom and pan.
- **Connections select, they don't delete on click.** Click a line to select it;
  a small toolbar appears at its midpoint with a delete (×) button and a label
  (✎) button. Labels render along the line and are optional.
- **Light / dark theme.** Toggle in the header (persisted). Dark is the blueprint
  theme; light is a "whiteprint" drafting sheet. Both are driven entirely by CSS
  custom-property tokens.

## Custom problems

The problem dropdown includes **"➕ Create custom problem…"**, which opens a
builder: title, description, component requirements (each is a multi-select of
acceptable types plus a minimum count), connection requirements (from-types →
to-types), and optional hints. The result is a real, scorable puzzle — "Solve for
me" works on it, and it's persisted in `localStorage` so it survives reloads.
Custom problems are marked with a ★ in the dropdown and can be deleted from the
problem header.

## Notes

- **Custom components** (palette → "+ New component") place, drag, connect, and
  delete like any block but never satisfy a checklist, since scoring matches the
  fixed built-in type ids. They reset when you switch problems.
- **Sound** never autoplays; it starts on the first interaction. A header
  mute/unmute control and an optional ambient drone (off by default) are provided.
- **Reduced motion** is honored via a real `prefers-reduced-motion` media query,
  which disables pop-in, shake, marching-ants, and count-up animations.
- The three shipped puzzles were authored to satisfy their own "Solve for me"
  output (each auto-solves to 100), which validates the canonical-first
  consistency the authoring rules describe.

## Open questions (deferred, per the PRD)

- **"Solve for me" is deterministic** (always the first alternate). Once a puzzle
  has genuinely equivalent alternate paths, decide whether to randomize among
  them so one answer isn't quietly taught as "the" answer.
- **Custom-component persistence** across a session is currently reset-on-switch.
