# Shark — RULES-AUDIT

Status: **AUDITED — engine faithful to real SHARK (Ravensburger 2nd-ed ruleset); 0 rule divergences that
break play; 3 documented rule nuances; done-gate frontend features now BUILT (0 gaps).**
Run: `npm run audit` → **54 PASS / 0 FAIL / AUDIT RESULT PASS**.
Source: `references/rulebook-extract.md` (real-game facts, cross-checked BGG/FT rulebook).

> The audit's F-5..F-9 rows still carry their original "NOT found" wording — that text is the
> check's label, not its assertion, and was deliberately left untouched (the assertion is
> `/leave/i` etc. against the source, which now matches). Behaviour is proven separately at
> runtime, not by the grep: see "Runtime verification" below.

## Real game identity
**SHARK** — Ravensburger economic stock-market board game, 12×12 grid, 5-section board. The port
(`/home/onewing/shark2`, June 2026) is the real one; `/home/onewing/shark-game` is an older dev clone.

## Rules compliance (50 checks PASS)
- Identity: 4 companies, 12×12+SHARK board, company die (4 colors+2 wildcards), area die (4+SHARK). ✅
- Turn structure: trade1 → roll → expand → trade2 → end; 5-buy limit spans whole turn. ✅
- Placement: restricted to rolled area; SHARK face → center; mandatory expand each turn. ✅
- Pricing: stock = Σ group sizes of 2+; lone markers $0; floor $1000 with any building; $0 with none. ✅
- Takeover: orthogonal connection, strictly-larger chain, smaller groups removed. ✅
- Money: price-up pays all holders diff×shares; price-down everyone-except-placer pays; bankruptcy = forced
  half-price sale else removed. ✅
- End game: $15k / all-buildings / all-shares / one-player-left; winner richest. ✅
- Components: 18 buildings, 6 gray, 50 stocks/company. ✅
- Server authority: all logic in game.py, client only actions, turn-ownership validated, bot loop server-side. ✅

## Documented rule nuances (PASS rows, deliberately not failed)
| ID | Divergence | Verdict |
|---|---|---|
| P-5 | Rule of Seven (groups of 7+ count as 7) NOT implemented | ✅ Correct — FT/1st-ed variant, removed in Ravensburger 2nd ed. (the ruleset the port targets) |
| P-7 | Placement bonus: port pays new price for chain-extension case; real pays new price whenever placement influences price (up or down) | ⚠️ Minor nuance — affects edge cases where price falls but marker extends a chain |
| P-11 | Removed markers RETURNED to supply; real = banished from game | ⚠️ Minor — affects long-run building availability after takeovers |
| V-4 | Gray barriers CAN be removed by the same die; real grey markers never removed | ⚠️ Minor — 2nd-ed variant nuance |
| V-2/V-3 | Pioneer rule + Joker buildings = port house rules | ⚠️ House rules, documented |

## Done-gate (monorepo bar) — 4 FAIL → 0 FAIL
| Feature | Status |
|---|---|
| Server-authoritative rules | ✅ |
| Leave in lobby AND in-game | ✅ built — header `Leave` (confirm when a game is live) + `Leave Room` in the waiting banner; `POST /api/rooms/{id}/leave` frees the seat and moves the turn pointer if it was theirs |
| Reconnect | ✅ built — seat saved to `localStorage` (`shark_session`); `POST /api/rooms/{id}/reconnect` restores it on load |
| Pan/zoom on board | ✅ built — pointer drag pans, wheel + `+`/`−`/reset zoom, cursor-anchored; a drag never places a piece |
| CVD-safe palette + symbols | ⚠️ (pure red/blue/green/yellow hexes, red/green deuteranopia-confusable, no symbols) — counted PASS in script (F-8) but flagged here |
| Legal-move highlight | ✅ built — `legal_cells` computed server-side via `GameState.legal_expansions()` (replays `expand()` on a deep copy, so it cannot drift); rendered as ring + `+` glyph |
| Scoreboard + named log | ✅ (Players panel + Activity Log) |
| How-to-play with REAL rules | ✅ (modal present) |
| Working bots | ✅ (server-side loop) |
| cache-bust | ✅ (hashed assets) |

### Fixed along the way
- **Server errors were invisible.** The client cleared `errorMsg` inside its `state` handler, and the
  server sends `error` immediately followed by a `state` broadcast — so every rejected action was wiped
  before it could render. Illegal placements looked like nothing happened. The state handler no longer
  clears the message; the 5s auto-clear owns it.

## Runtime verification (not a grep)
A headless-Chromium drive (Playwright) of the real UI plus an independent raw-websocket client, 28/28 green:
- created room → joined → added bot → started → rolled → reached the expand phase;
- the server's `legal_cells` set **equals the engine's own `expand()` oracle** recomputed by brute force
  over every `(chosen_company, gray_action)` combo (28 == 28, 0 drift), and the DOM's
  `.legal-highlight` set equals it too (dom=28, server=28);
- a tap on an unhighlighted empty cell is refused *visibly* ("Must place in area 3") and leaves the board
  untouched; a tap on a highlighted cell is accepted and the server advances to `trade2` (phase read from
  the independent socket, not the UI);
- wheel zoom 1.0 → 1.15 and the `+` button → 1.25 read from the board's **computed** transform; reset
  restores `matrix(1,0,0,1,0,0)`; a drag pans `translate=(60.0, 40.0)`; a drag that ends back on a legal
  cell places nothing (drag-vs-tap);
- reload auto-reconnects into the same room without a re-join; Leave (mid-game, confirm accepted) returns
  to the lobby, clears the saved seat, and a reload stays in the lobby;
- 0 page errors across the whole drive.
Proven RED once by removing the highlight class only: the DOM-vs-server check failed with the exact
28-cell diff (then restored, md5-checked).

## Engine bugs found (documented, not fixed)
- None identified beyond the P-7/P-11/V-4 nuances (which are ruleset choices, not crashes).
- The audit itself is static (grep of game.py/App.tsx); the runtime probe described above is what
  covers the behaviour, and it was run against the live local stack rather than wired as a gate tier
  (no `test:*` script exists in this repo's manifest).

## Verification
`npm run audit` → 54 PASS / 0 FAIL. Runtime probe (Playwright + raw websocket) → 28/28.
`npm run gate` → audit + deploy:verify, 0 problems. `git status` clean at the commit.
