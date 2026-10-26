# Shark — SCOPE

**Game:** Shark (SHARK), a 2–6 player economic stock-market board game on a 12×12 grid with a 5-section
board (4 numbered areas + SHARK center). The port implements the **Ravensburger 2nd edition** ruleset.
**Genre:** commodity trading / chain-building / hostile takeovers. **Players:** 2–6. **~60–90 min.**

> Rules transcribed from the real-game ruleset (Ravensburger 2nd ed. / 1st ed. FT), cross-referenced with
> BGG and the engine's own README. Source: `references/rulebook-extract.md`, audited in RULES-AUDIT.md.

## Components (real game)
- 12×12 grid board, 5 sections (1-2-3-4 + SHARK center region).
- **4 companies** (red, blue, green, yellow) — the tradeable set; 18 buildings per company.
- **6 gray/neutral buildings** (Ravensburger 2nd ed. variant).
- **50 stocks per company** (the "1's and 5's" stock chart).
- Two dice: a **company die** (6 faces: 4 colors + 2 wildcards) and an **area die** (5 faces: 4 numbered
  sections + SHARK).
- Cash, stock certificates.

## Turn structure
1. **Pre-roll trading** — buy up to 5 shares total for the turn, sell any.
2. **Mandatory roll + place** — roll both dice, place a building of the rolled company in the rolled area.
3. **Post-roll trading** — buy more up to the 5-share turn limit, sell any.
4. End turn; advance to next non-bankrupt player.

## Placement & pricing
- Placement restricted to the rolled area (SHARK face → center region only).
- **Stock value** = sum of group sizes of 2+ connected markers; lone markers worth nothing.
- Company with a building but no 2+ group: floor value $1000. Company with no buildings: $0.
- **Placement bonus**: player receives the new price of the placed company if the placement influences
  (up or down) the price; $1000 if unchanged (designer-confirmed; the port pays new price for the
  chain-extension case — see RULES-AUDIT P-7).
- **Hostile takeover**: placement must be orthogonally connected to your own chain; the newly formed chain
  must be STRICTLY larger than the opposing chain(s) (equal sizes cannot touch); smaller opposing group(s)
  are removed. (Real rule: removed markers are **banished** from the game, not returned to supply — the
  port returns them, see RULES-AUDIT P-11.)

## Money
- Price **up**: every holder (incl. placer) receives diff × shares.
- Price **down**: every holder EXCEPT the placer pays diff × shares.
- **Bankruptcy**: forced stock sale at half price (rounded down to nearest $1000), else bankrupt; bankrupt
  player removed (stocks zeroed, turn skipped).

## End of game
Ends when: any company stock price reaches **$15,000** (port has a $10,000 short-game option), OR all of a
company's buildings are used, OR all shares of a company are sold, OR only one non-bankrupt player remains.
**Winner = richest player** (cash + shares at current price).

## Variants
- **Wildcard die faces** — choose any company (real: white/black faces).
- **Pioneer rule** (port house rule, NOT real): first building in a new area grants $1000 + extra turn.
- **Joker buildings** (port): black die places a wild lone building, bonus = highest stock price (maps to
  the real grey-marker variant loosely).
- **Grey markers** (real Ravensburger 2nd ed.): grey markers can NEVER be removed, stay on board, adopt
  color when touched, survive takeovers. Port gray barriers CAN be removed by the same die — divergence
  (RULES-AUDIT V-4).

## Done-gate status
See RULES-AUDIT.md §Done-gate: **Leave, Reconnect, Pan/zoom, Legal-move highlight are all built** (was
4 fails); server-authoritative, how-to-play, scoreboard+log, working bots, hashed-asset cache-bust all
present. `npm run audit` → 54 PASS / 0 FAIL.
