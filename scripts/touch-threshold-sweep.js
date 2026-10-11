'use strict';

const assert = require('node:assert/strict');

// Synthetic sensitivity sweep; labels are authored independently of classifier output.
const joinMsValues = [80, 120, 160];
const lockPxValues = [6, 8, 12];
const splitPxValues = [70, 90, 110];
const baseline = { joinMs: 120, lockPx: 8, splitPx: 90 };

// One representative per authored family; values are elapsed ms and raw CSS px.
const development = [
  { family: 'solo-writing', id: 'dev-writing-solo', intent: 'writing', pairMs: null, firstMovePx: 0, spanPx: null },
  { family: 'late-pair', id: 'dev-writing-late-pair', intent: 'writing', pairMs: 175, firstMovePx: 2, spanPx: 34 },
  { family: 'drift-pair', id: 'dev-writing-drift-pair', intent: 'writing', pairMs: 95, firstMovePx: 10, spanPx: 38 },
  { family: 'close-pan', id: 'dev-pan-close', intent: 'pan', pairMs: 105, firstMovePx: 2, spanPx: 48 },
  { family: 'slow-pan', id: 'dev-pan-slower', intent: 'pan', pairMs: 145, firstMovePx: 3, spanPx: 54 },
  { family: 'wide-zoom', id: 'dev-zoom-wide', intent: 'zoom', pairMs: 100, firstMovePx: 2, spanPx: 132 },
];

// Second authored value set using the same six scenario families; not family-held-out.
const validation = [
  { family: 'solo-writing', id: 'validation-writing-solo', intent: 'writing', pairMs: null, firstMovePx: 0, spanPx: null },
  { family: 'late-pair', id: 'validation-writing-late-pair', intent: 'writing', pairMs: 175, firstMovePx: 3, spanPx: 32 },
  { family: 'drift-pair', id: 'validation-writing-drift-pair', intent: 'writing', pairMs: 100, firstMovePx: 11, spanPx: 36 },
  { family: 'close-pan', id: 'validation-pan-close', intent: 'pan', pairMs: 110, firstMovePx: 2, spanPx: 51 },
  { family: 'slow-pan', id: 'validation-pan-slow', intent: 'pan', pairMs: 165, firstMovePx: 2, spanPx: 56 },
  { family: 'wide-zoom', id: 'validation-zoom-wide', intent: 'zoom', pairMs: 105, firstMovePx: 2, spanPx: 145 },
];

// Excluded because the same observable trace can encode opposite human intents.
const irreduciblyAmbiguous = [
  { observed: 'pairMs=100, firstMovePx=1, spanPx=35', possibleLabels: ['writing (accidental contact)', 'pan (intentional close pair)'] },
  { observed: 'pairMs=100, firstMovePx=1, spanPx=125', possibleLabels: ['pan (wide one-hand pair)', 'zoom (intentional two-hand pair)'] },
];
const labels = ['writing', 'pan', 'zoom'];

function classify(trace, thresholds) {
  const pairEligible = trace.pairMs !== null
    && trace.pairMs <= thresholds.joinMs
    && trace.firstMovePx <= thresholds.lockPx;
  if (!pairEligible) return 'writing';
  return trace.spanPx < thresholds.splitPx ? 'pan' : 'zoom';
}

function evaluate(traces, thresholds) {
  const confusion = Object.fromEntries(labels.map(label => [label, Object.fromEntries(labels.map(out => [out, 0]))]));
  let weightedLoss = 0;
  for (const trace of traces) {
    const output = classify(trace, thresholds);
    confusion[trace.intent][output] += 1;
    if (trace.intent === output) continue;
    weightedLoss += trace.intent === 'writing' ? 5 : output === 'writing' ? 2 : 1;
  }
  return { confusion, weightedLoss };
}

assert.equal(classify({ pairMs: 120, firstMovePx: 8, spanPx: 89 }, baseline), 'pan');
assert.equal(classify({ pairMs: 121, firstMovePx: 0, spanPx: 89 }, baseline), 'writing');
assert.equal(classify({ pairMs: 120, firstMovePx: 9, spanPx: 120 }, baseline), 'writing');
assert.equal(classify({ pairMs: 120, firstMovePx: 8, spanPx: 90 }, baseline), 'zoom');
assert.deepEqual(validation.map(trace => trace.family), development.map(trace => trace.family));
assert.equal(new Set([...development, ...validation].map(trace => trace.id)).size, development.length + validation.length);

function candidates() {
  return joinMsValues.flatMap(joinMs => lockPxValues.flatMap(lockPx => splitPxValues.map(splitPx => ({ joinMs, lockPx, splitPx }))));
}

function baselineDistance({ joinMs, lockPx, splitPx }) {
  return Math.abs(joinMs - baseline.joinMs) + Math.abs(lockPx - baseline.lockPx) * 10 + Math.abs(splitPx - baseline.splitPx);
}

function compareDevelopmentCandidates(a, b) {
  return a.weightedLoss - b.weightedLoss
    || baselineDistance(a.thresholds) - baselineDistance(b.thresholds)
    || a.thresholds.joinMs - b.thresholds.joinMs
    || a.thresholds.lockPx - b.thresholds.lockPx
    || a.thresholds.splitPx - b.thresholds.splitPx;
}

function row(name, result) {
  const c = result.confusion;
  return `| ${name} | ${result.weightedLoss} | ${c.writing.writing}/${c.writing.pan}/${c.writing.zoom} | ${c.pan.writing}/${c.pan.pan}/${c.pan.zoom} | ${c.zoom.writing}/${c.zoom.pan}/${c.zoom.zoom} |`;
}

const scoredCandidates = candidates().map(thresholds => ({ thresholds, ...evaluate(development, thresholds) }));
const selected = scoredCandidates.slice().sort(compareDevelopmentCandidates)[0];
const zeroLossCandidates = scoredCandidates.filter(candidate => candidate.weightedLoss === 0);
const baseDevelopment = evaluate(development, baseline);
const baseValidation = evaluate(validation, baseline);
const selectedValidation = evaluate(validation, selected.thresholds);
console.log(`Development scenarios: ${development.length}; validation scenarios: ${validation.length}; same authored families: ${development.map(trace => trace.family).join(', ')}; ambiguous excluded: ${irreduciblyAmbiguous.length}`);
console.log(`Candidate grid: ${joinMsValues.length} x ${lockPxValues.length} x ${splitPxValues.length} = ${candidates().length}`);
console.log(`Baseline: ${baseline.joinMs}/${baseline.lockPx}/${baseline.splitPx}; selected by development loss then baseline distance: ${selected.thresholds.joinMs}/${selected.thresholds.lockPx}/${selected.thresholds.splitPx}`);
console.log(`Zero-loss development candidates (${zeroLossCandidates.length}): ${zeroLossCandidates.map(({ thresholds }) => `${thresholds.joinMs}/${thresholds.lockPx}/${thresholds.splitPx}`).join(', ')}`);
console.log('| Evaluation | weighted loss | writing outputs W/P/Z | pan outputs W/P/Z | zoom outputs W/P/Z |');
console.log('|---|---:|---:|---:|---:|');
console.log(row('Baseline development', baseDevelopment));
console.log(row('Selected development candidate', selected));
console.log(row('Baseline validation (same families)', baseValidation));
console.log(row('Selected validation (same families)', selectedValidation));
console.log('Ambiguous excluded cases:');
for (const item of irreduciblyAmbiguous) console.log(`- ${item.observed}: ${item.possibleLabels.join(' / ')}`);
