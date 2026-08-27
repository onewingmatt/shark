# Shark — real-rules extraction

Source of truth for the Shark audit. The port implements the **Ravensburger 2nd edition** ruleset of
**SHARK** (economic stock-market board game). Numbers/rules below are the real-game facts encoded in
`scripts/independent-rules-check.ts` (which grep-audits `backend/game.py` and `frontend/src/App.tsx`
against them), cross-checked against BGG and the FT/1st-edition rulebook.

> Caveat: the grep-audit verifies *presence* of the encoded behavior in source. It is not a live replay of
> worked examples (unlike Stuck/Sardegna/Puerto-Banana audits), but the engine paths it asserts were
> inspected by the auditor and are consistent with the real ruleset.

## Identity
- **SHARK** — Ravensburger economic stock-trading game on a 12×12 grid, 5-section board (1-2-3-4 + SHARK
  center). 2–6 players. The port (`/home/onewing/shark2`) is the June 2026 real one; `/home/onewing/shark-game`
  is an older dev clone.

## Verified real-game facts (used by the audit)
1. **4 companies**: red, blue, green, yellow (tradeable set).
2. **Board**: 12×12 grid with SHARK center region (real: 5-section board with shark-fin middle).
3. **Two dice**: company die (6 faces: 4 colors + 2 wildcards; black/gray wildcard variants) and area die
   (5 faces: 1-2-3-4 + SHARK).
4. **Turn structure**: pre-roll trade (buy ≤5, sell any) → mandatory roll+place → post-roll trade → end.
   5-share buy limit spans the WHOLE turn.
5. **Placement**: restricted to rolled area; SHARK face → center only. Mandatory each turn (end_turn blocked
   in expand).
6. **Stock value** = sum of group sizes of 2+ connected markers; lone markers worth $0. Company with any
   building but no 2+ group → floor $1000. No buildings → $0.
7. **Placement bonus**: real rule pays the new commodity price whenever the placement influences the price
   (up or down); $1000 if unchanged. Port pays new price for chain-extension case only (DIVERGENCE P-7).
8. **Takeover**: orthogonal connection to own chain required; new chain must be STRICTLY larger (equal
   sizes cannot touch); smaller opposing groups removed. Real rule: removed markers are **banished from the
   game** — port returns them to supply (DIVERGENCE P-11).
9. **Money**: price up → every holder gets diff × shares; price down → every holder EXCEPT placer pays
   diff × shares. Bankruptcy → forced stock sale at half price rounded down to nearest $1000, else bankrupt;
   bankrupt removed (stocks zeroed, turn skipped).
10. **End game**: any company price ≥ $15,000 (port short-game $10,000), OR all buildings of a company used,
    OR all shares of a company sold, OR one non-bankrupt player remains. Winner = richest (cash + shares at
    current price).
11. **Components**: 18 buildings/company, 6 gray markers (2nd ed.), 50 stocks/company.
12. **Variants**: wildcard die faces (choose any company); Rule of Seven (groups of 7+ count as 7) is a
    FT/1st-edition official variant REMOVED in Ravensburger 2nd ed. — not implementing it is correct for
    the 2nd-ed ruleset. Grey markers (2nd ed.): can NEVER be removed, stay on board, adopt color when
    touched, survive takeovers — port's gray barriers CAN be removed by the same die (DIVERGENCE V-4).

## Divergences (all documented, none are engine-breaking for 2nd-ed ruleset)
- P-7 chain-extension bonus: port pays new price only for chain-extension; real pays whenever placement
  influences price (up or down).
- P-11 removed markers returned to supply; real = banished from game.
- V-4 gray barriers removable; real grey markers never removed.
- Pioneer rule + Joker buildings are port house rules (not real-game).
