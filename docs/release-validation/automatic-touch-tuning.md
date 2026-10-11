# Automatic touch threshold sweep

Status: synthetic sensitivity study only; no physical touch measurements are available.

Run from the repository root with `node scripts/touch-threshold-sweep.js`. The script has no dependencies and prints the candidate grid, zero-loss development candidates, confusion counts, and excluded ambiguous cases.

## Fixed model and evaluation

The pure local classifier models the proposed immediate-contact behavior: the first contact starts provisional ink immediately. A second contact is eligible only when elapsed time is at most `joinMs` and the first contact's maximum raw CSS displacement before that contact is at most `lockPx`. Once paired, a contact span below `splitPx` is pan; otherwise it is zoom. The classifier has no delayed timer. The experiment measures classification outcomes from supplied traces; it does not measure event delivery or physical latency.

The candidate grid is fixed at `joinMs = [80, 120, 160] ms`, `lockPx = [6, 8, 12] CSS px`, and `splitPx = [70, 90, 110] CSS px` (27 combinations). Baseline is `120/8/90`. Candidate selection minimizes development weighted errors; handwriting sent to navigation costs 5, navigation missed as handwriting costs 2, and pan/zoom confusion costs 1. Ties prefer the candidate nearest the baseline. The second six-row set is a validation repeat after selection, using different values from the same six authored scenario families. It is not family-held-out validation and does not measure generalization to unseen families.

Each row is one hand-authored scenario, not a random sample or a large collection of correlated points. Labels are assigned by the scenario author from intended action before classification, not generated from threshold results. The six families are solo writing, late accidental pair, writing with motion before a second contact, close index-plus-middle pan, slower pan, and wide two-hand zoom. The development and validation sets use these same families with different trace values. Values are illustrative CSS-space traces, not measurements from users or hardware.

Two intrinsically ambiguous cases are excluded from scoring: the same early close pair can mean accidental contact during handwriting or intentional one-hand pan; the same wide pair can mean one-hand pan or two-hand zoom. Position and timing alone cannot resolve intent when observable traces are identical. Hardware that already distinguishes pen from touch remains outside this classifier.

## Reproduced output

| Evaluation | weighted loss | writing outputs W/P/Z | pan outputs W/P/Z | zoom outputs W/P/Z |
|---|---:|---:|---:|---:|
| Baseline development (`120/8/90`) | 2 | 3/0/0 | 1/1/0 | 0/0/1 |
| Selected development (`160/8/90`) | 0 | 3/0/0 | 0/2/0 | 0/0/1 |
| Baseline validation (same families) | 2 | 3/0/0 | 1/1/0 | 0/0/1 |
| Selected validation (same families) | 2 | 3/0/0 | 1/1/0 | 0/0/1 |

Six development grid choices have zero loss: join `160ms`, lock `6px` or `8px`, and split `70px`, `90px`, or `110px`. The reported `160/8/90` is selected only because the deterministic tie-break prefers the zero-loss candidate nearest baseline. In these fixtures, 6px and 8px reject the same 10px drift case, and all three split values put the 48px/54px pans below the boundary and the 132px zoom above it. Thus this study provides no evidence that 8px or 90px is better than the other zero-loss lock/split candidates.

The selected candidate's development advantage comes from its one slower-pan example. On the second set from the same families, its 165ms pan still misses the 160ms join threshold, so it matches the baseline's confusion and loss. This small authored study cannot establish an optimum or justify changing production defaults. Keep `120ms / 8px / 90px` as a conservative provisional default suggestion until representative device traces can be collected and reviewed; there is no measured hardware latency here.

The explored low/high bands (`80–160ms`, `6–12px`, and `70–110px`) are sensitivity bounds only. They are not confidence intervals, learned device limits, or certified settings. A broader slow-pan band may admit more delayed accidental pairs; a larger lock band may turn more moving-writing traces into navigation; changing the split band moves the pan/zoom boundary. Physical calibration remains necessary.
