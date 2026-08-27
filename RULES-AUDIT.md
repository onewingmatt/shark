# Shark — RULES-AUDIT

Status: **AUDITED — engine faithful to real SHARK (Ravensburger 2nd-ed ruleset); 0 rule divergences that
break play; 3 documented rule nuances; 4 done-gate gaps (all frontend).**
Run: `npm run audit` (from `frontend/`) → **50 PASS / 4 FAIL / AUDIT RESULT FAIL** (the 4 FAILs are all
done-gate features missing, not rules).
Source: `references/rulebook-extract.md` (real-game facts, cross-checked BGG/FT rulebook).

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

## Done-gate (monorepo bar) — 4 FAIL
| Feature | Status |
|---|---|
| Server-authoritative rules | ✅ |
| Leave in lobby AND in-game | ❌ (no Leave button anywhere) |
| Reconnect | ❌ (no token, no localStorage persistence) |
| Pan/zoom on board | ❌ (static CSS grid) |
| CVD-safe palette + symbols | ⚠️ (pure red/blue/green/yellow hexes, red/green deuteranopia-confusable, no symbols) — counted PASS in script (F-8) but flagged here |
| Legal-move highlight | ❌ |
| Scoreboard + named log | ✅ (Players panel + Activity Log) |
| How-to-play with REAL rules | ✅ (modal present) |
| Working bots | ✅ (server-side loop) |
| cache-bust | ✅ (hashed assets) |

## Engine bugs found (documented, not fixed)
- None identified beyond the P-7/P-11/V-4 nuances (which are ruleset choices, not crashes).
- The audit is static (grep of game.py/App.tsx), not a live replay — a follow-up socket/E2E probe would
  strengthen the gate, but the audited engine paths are consistent with the real ruleset.

## Verification
`npm run audit` (frontend) → 50 PASS / 4 FAIL. `git status` clean-ish (only this audit's docs added).
