# Critique log: legacy-reel

## Round 1
| hook | read | motion | variety | brand | sync | min |
|  7   |  7   |   6    |    8    |   9   |  6   |  6  |

Worst three (most damaging first):
1. [b23.4-24, all] Push-through zooms into the counter of the "0" (ZERO=[80,226]), so the last frames before the cut to navy are blank white -> reads as a flash, not a push-through -> grow a navy iris from the zoom point (radius inCubic over 23.4-24) so the push lands IN navy, and S6 opens on matching navy.
2. [b28, all] End-card impact lands on a bare navy square; the L/R strokes start at 28.15/28.5 -> the hit frame shows nothing to read -> draw L 27.7-28.2, R 27.9-28.45, wordmark from 28.0, bell moves to 28.45.
3. [b3.5-4, all] Gold wipe reveals an empty navy field; the hero card springs from 3.6 so it arrives after the band passes -> start card spring at 3.2 so the photo is in place behind the wipe; sync: b1 pop and b4 swell/whoosh have no onset (+416 / +312 ms) -> add a thud at b4 and lift the b1 pop gain.

Checks failed: cut opens on blank (b24 push).
Verdict: ANOTHER ROUND

## Round 2
| hook | read | motion | variety | brand | sync | min |
|  8   |  7   |   8    |    8    |   9   |  8   |  7  |

Worst three (most damaging first):
1. [b16-19, all] Chip pops use SPRING.bouncy (~30% overshoot): on each hit frame the new chip balloons into its neighbour (Relatives/Timelines collide at b17) -> reads as a layout bug -> custom spring {stiffness 320, damping 20} (~8% overshoot).
2. [b4-8, b14-20, 16x9] Gold kickers ("FREE PRIVATE ANCESTRY SEARCH", "FAMILY HISTORY CENTER") are 30 px on 1920: unreadable on phone_p1 -> 16x9 kicker 36 px, 9x16 38 px.
3. [sync] one hit without an onset inside 20 ms -> find it in sync.py, move or re-voice it.

Checks failed: none (push-through and end-card hit fixed; longest gap b24-25.5, 0.9 s).
Verdict: ANOTHER ROUND

## Round 3
| hook | read | motion | variety | brand | sync | min |
|  8   |  8   |   8    |    8    |   9   |  9   |  8  |

Fixed from round 2: chip pops now ~8% overshoot (no collisions on b16-19), kickers 36/38/32 px and readable on the phone pages, sync 30/30 within 20 ms (median 2.8 ms), mix -14.1 LUFS / -1.0 dBTP. Also removed the brand film's burned-in title from the hook backdrop (attic_girl.png re-cropped to 616x200).

Remaining (not blocking):
1. [b8-13, 9x16] The form is a 1x screenshot pushed to ~2.2x; UI text is soft at the field zooms. A 2x capture of the search form would sharpen it.
2. [b0-4, 9x16/1x1] The attic still is 616 px wide, so the portrait hook is a heavily blurred crop of the girl's face; the old photo she holds (the story) is off frame. A higher-res frame from the flagship film would let the hook show both.
3. [b20-24, 1x1] The $0 card sits small at the top of the square with the three lines below; a side-by-side layout would use the width better.

Checks: all pass. Longest gap b24-25.5 (0.9 s). End card holds b29.3-32 (1.7 s fully composed, 2.5 s from first frame).
Verdict: READY
