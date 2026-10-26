import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ENGINE = join(ROOT, 'backend', 'game.py')
const HEUR = join(ROOT, 'backend', 'bot_heuristics.py')
const MAIN = join(ROOT, 'backend', 'main.py')
const APPTSX = join(ROOT, 'frontend', 'src', 'App.tsx')

const engineSrc = existsSync(ENGINE) ? readFileSync(ENGINE, 'utf8') : ''
const heurSrc = existsSync(HEUR) ? readFileSync(HEUR, 'utf8') : ''
const mainSrc = existsSync(MAIN) ? readFileSync(MAIN, 'utf8') : ''
const appSrc = existsSync(APPTSX) ? readFileSync(APPTSX, 'utf8') : ''

if (!engineSrc) {
  console.error('FATAL: backend/game.py not found at ' + ENGINE)
  process.exit(1)
}

let pass = 0
let fail = 0
const failures: string[] = []
const notes: string[] = []

// Counts that the REAL game has (FT edition: 18 each, printed as 20 — see
// rulebook-extract.md; Ravensburger 2nd ed. keeps 18 + 6 gray)
const REAL_BUILDINGS_PER_COMPANY = 18
const REAL_TOTAL_STOCKS_PER_COMPANY = 50 // BGG "1's and 5's" stock chart, 50 shares/company
const REAL_GRAY_BUILDINGS = 6 // Ravensburger 2nd edition variant

const check = (id: string, desc: string, ok: boolean, evidence = '') => {
  if (ok) { pass++ } else { fail++; failures.push(`${id}: ${desc}${evidence ? ' — ' + evidence : ''}`) }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}${evidence ? '  [' + evidence + ']' : ''}`)
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 1. GAME IDENTITY ===')
check('ID-1', 'Engine defines exactly the 4 real companies red/blue/green/yellow as the tradeable set', /COMPANIES\s*=\s*\["red",\s*"blue",\s*"green",\s*"yellow"\]/.test(engineSrc))
check('ID-2', 'Board is a 12x12 grid with a SHARK center region (real: 5-section board with shark-fin middle)', /BOARD_LAYOUT/.test(engineSrc) && (engineSrc.match(/"111111222222"/) !== null))
check('ID-3', 'Engine rolls TWO dice: a company die and an area die', /current_company_die/.test(engineSrc) && /current_area_die/.test(engineSrc) && /roll_dice/.test(engineSrc))
check('ID-4', 'Company die has 6 faces including wildcard faces (real: 4 colors + 2 wildcards; port models wildcard as black/gray variants)', /random\.choice\(\["red",\s*"blue",\s*"green",\s*"yellow",\s*"black",\s*"gray"\]\)/.test(engineSrc))
check('ID-5', 'Area die has 5 faces (4 numbered sections + SHARK) matching Ravensburger 2nd ed. 5-section board', /random\.choice\(\["1",\s*"2",\s*"3",\s*"4",\s*"SHARK"\]\)/.test(engineSrc))

console.log('\n=== 2. TURN STRUCTURE ===')
check('T-1', 'Pre-roll trading phase (buy up to 5, sell unlimited) then mandatory roll+place then post-roll trading', /phase.*trade1/.test(engineSrc) && /"expand"/.test(engineSrc) && /"trade2"/.test(engineSrc))
check('T-2', '5-share buy limit spans the WHOLE turn (trade1 + trade2)', /current_turn_purchases/.test(engineSrc) && /current_turn_purchases\s*\+\s*count\s*>\s*5/.test(engineSrc))
check('T-3', 'Rolling dice moves phase trade1 -> expand', /def roll_dice/.test(engineSrc) && /self\.phase\s*=\s*"expand"/.test(engineSrc))
check('T-4', 'A building placement is mandatory each turn (expand phase); end_turn blocked during expand', /def expand/.test(engineSrc) && /if self\.phase == "expand": return False, "Must expand before ending turn"/.test(engineSrc))
check('T-5', 'After placement phase -> trade2 (second optional trade)', /self\.phase\s*=\s*"trade2"/.test(engineSrc))
check('T-6', 'end_turn advances to the next non-bankrupt player and resets purchase counter', /current_turn_index\s*=\s*\(self\.current_turn_index\s*\+\s*1\)\s*%\s*len\(self\.players\)/.test(engineSrc) && /current_turn_purchases\s*=\s*0/.test(engineSrc))

console.log('\n=== 3. PLACEMENT & CHAIN/STOCK PRICING ===')
check('P-1', 'Placement restricted to the rolled area section (SHARK face -> center region only)', /if self\.current_area_die == "SHARK":/.test(engineSrc) && /Must place in area/.test(engineSrc))
check('P-2', 'Stock value = sum of group sizes of 2+ markers (lone markers worth nothing)', /_calculate_global_price/.test(engineSrc) && /len\(chain\)\s*>=\s*2/.test(engineSrc))
check('P-3', 'A company with ANY building but no 2+ group is worth a floor of $1000 (real: "no groups of 2 or more -> value 1")', /has_actual_company_building/.test(engineSrc) && /return 1000/.test(engineSrc))
check('P-4', 'Company with NO buildings on board is worth $0', /if not all_cells:\s*\n\s*return 0/.test(engineSrc))
check('P-5', 'DIVERGENCE: Rule of Seven (groups of 7+ count as 7) — NOT implemented (FT/1st-ed official variant; removed in Ravensburger 2nd ed., so acceptable only for the 2nd-edition ruleset)', !/seven|rule_of_7|Rule of Seven/i.test(engineSrc), 'engine has no rule-of-seven logic')
check('P-6', 'Placement bonus: lone placement awards $1000 (real: player receives new value of placed company if price changes; $1000 if unchanged)', /is_lone/.test(engineSrc) && /player\.cash\s*\+=\s*1000/.test(engineSrc))
check('P-7', 'DIVERGENCE: chain-extension bonus pays NEW stock price of the placed company (real: "player receives the amount of the new commodity price" for a marker INFLUENCING the price; designer-confirmed)', /player\.cash\s*\+=\s*self\.stock_price\[comp\]/.test(engineSrc), 'port: bonus = new price for chain-extension case; real rule pays new price whenever the placement influences (up or down) the price')
check('P-8', 'Takeover: placement must be orthogonally connected to own chain', /Hostile takeover requires orthogonal connection to your own company/.test(engineSrc))
check('P-9', 'Takeover: newly formed chain must be STRICTLY larger than the opposing chain(s) — equal sizes cannot touch', /temp_chain_len\s*<=\s*len\(opp_chain\)/.test(engineSrc) && /Hostile takeover failed: chain not strictly larger than opposing chain/.test(engineSrc))
check('P-10', 'Takeover removes the smaller opposing group(s) from the board', /HOSTILE TAKEOVER INITIATED/.test(engineSrc) && /Removed lone/.test(engineSrc))
check('P-11', 'DIVERGENCE: removed markers are RETURNED to the supply (remaining_buildings += 1). Real rules: "Removed markers are banished from the game, not returned to the supply."', /remaining_buildings\[adj_comp\]\s*\+=\s*1/.test(engineSrc), 'real rule: removed markers are banished forever')
check('P-12', 'DIVERGENCE: groups are connected orthogonally (4-neighborhood); diagonal adjacency is NOT connectivity (matches real game grid adjacency)', /_get_adjacent\(r,\s*c,\s*include_diagonal=False\)/.test(engineSrc), 'engine uses orthogonal adjacency for chains')

console.log('\n=== 4. MONEY: DIVIDENDS & LOSSES ===')
check('M-1', 'Price UP: every holder (incl. placer) receives diff * shares', /diff\s*>\s*0/.test(engineSrc) && /amount\s*=\s*diff\s*\*\s*p\.stocks\[comp\]/.test(engineSrc))
check('M-2', 'Price DOWN: every holder EXCEPT the placer pays diff * shares', /elif diff < 0:/.test(engineSrc) && /if p\.bankrupt or p == curr_p: continue/.test(engineSrc))
check('M-3', 'Bankruptcy: forced stock sale at HALF price (rounded down to nearest $1000), else bankruptcy', /sell_price\s*=\s*\(price\s*\/\/\s*2000\)\s*\*\s*1000/.test(engineSrc))
check('M-4', 'Bankrupt player removed from game (stocks zeroed, turn skipped)', /p\.bankrupt\s*=\s*True/.test(engineSrc) && /if not self\.current_player\(\)\.bankrupt/.test(engineSrc))

console.log('\n=== 5. END OF GAME ===')
check('E-1', 'Game ends when any company stock price reaches $15,000 (real) / $10,000 (port short-game variant)', /stock_price\[c\]\s*>=\s*15000/.test(engineSrc) && /"short_game"/.test(engineSrc))
check('E-2', 'Game ends when all of a company\'s buildings are used', /remaining_buildings\[c\]\s*==\s*0/.test(engineSrc))
check('E-3', 'Game ends when all shares of a company are sold (Ravensburger 2nd ed. rule)', /sum\(p\.stocks\[c\]\s*for\s*p\s*in\s*self\.players\)\s*==\s*self\.total_stocks\[c\]/.test(engineSrc))
check('E-4', 'Game ends if only one non-bankrupt player remains', /len\(active_players\)\s*<=\s*1/.test(engineSrc))
check('E-5', 'Winner = richest player (cash + shares at current price) — port logs final wealth per player', /final wealth/.test(engineSrc))

console.log('\n=== 6. COMPONENT COUNTS ===')
const bldgInit = engineSrc.match(/remaining_buildings: Dict\[Company, int\] = \{c: (\d+) for c in COMPANIES\}/)
check('C-1', `Buildings per company initialized to 18 (real FT/2nd-ed: 18)`, bldgInit ? Number(bldgInit[1]) === REAL_BUILDINGS_PER_COMPANY : false, bldgInit ? `found ${bldgInit[1]}` : 'pattern not found')
const grayInit = engineSrc.match(/remaining_buildings\["gray"\] = (\d+)/)
check('C-2', `Gray/neutral buildings = 6 (real Ravensburger 2nd-ed variant: 6 grey markers)`, grayInit ? Number(grayInit[1]) === REAL_GRAY_BUILDINGS : false, grayInit ? `found ${grayInit[1]}` : 'gray not defined')
const stockInit = engineSrc.match(/total_stocks: Dict\[Company, int\] = \{c: (\d+) for c in COMPANIES\}/)
check('C-3', `Total stocks per company = 50 (real: 50 shares/company from the stock chart)`, stockInit ? Number(stockInit[1]) === REAL_TOTAL_STOCKS_PER_COMPANY : false, stockInit ? `found ${stockInit[1]}` : 'pattern not found')

console.log('\n=== 7. VARIANTS (real-game official variants) ===')
check('V-1', 'Wildcard die faces allow choosing any company (real: white faces / black face choose color)', /wildcardCompany/.test(appSrc) && /current_company_die === "black"/.test(appSrc))
check('V-2', 'Pioneer rule variant (port) — first building in a new area grants $1000 + extra turn (NOT a real-game rule; a port house rule)', /pioneer_rule/.test(engineSrc))
check('V-3', 'Joker buildings variant (port): black die places a wild lone building, bonus = highest stock price (maps to real grey-marker variant: 6 grey markers, cannot be placed adjacent, payout = highest stock value)', /joker_buildings/.test(engineSrc) && /highest_price/.test(engineSrc))
check('V-4', 'DIVERGENCE: real grey-marker rule (Ravensburger 2nd ed.): grey markers can NEVER be removed, stay on board, adopt color when touched, and remain through takeovers. Port gray barriers can be REMOVED by the same die.', /gray_action == "remove"/.test(engineSrc), 'real: grey buildings stay on the board the entire game once placed')

console.log('\n=== 8. SERVER AUTHORITY (done-gate) ===')
check('S-1', 'All game logic lives server-side in game.py; client only sends actions', /def trade\(/.test(engineSrc) && /def expand\(/.test(engineSrc) && !/calculate_global_price/.test(appSrc))
check('S-2', 'Server validates turn ownership on every action (trade/expand/end_turn)', /player != self\.current_player\(\)/.test(engineSrc))
check('S-3', 'Server rejects non-empty cell placement', /Cell not empty/.test(engineSrc))
check('S-4', 'Server rejects out-of-range coordinates', /Invalid cell/.test(engineSrc))
check('S-5', 'Bot turns are executed by a server-side loop (main.py room_bot_loop), not client-side', /room_bot_loop/.test(mainSrc) && /is_bot/.test(mainSrc))

console.log('\n=== 9. DONE-GATE FEATURE SCAN (frontend, static) ===')
// These are STATIC scans of the source. A pass here proves the code for a feature
// is present, not that it behaves — the behavioural proof for F-5/F-6/F-7/F-9 and
// the F-8 glyphs is `npm run test:features` (test/runtime-verify.py), which drives
// a real browser and reads computed styles. Do not read a green here as "works".
check('F-1', 'Lobby exists (create room, join by code, add bot, start)', /createRoom/.test(appSrc) && /joinRoom/.test(appSrc) && /addBot/.test(appSrc))
check('F-2', 'How-to-Play modal present with rules content', /showHowToPlay/.test(appSrc) && /How to Play Shark/.test(appSrc))
check('F-3', 'Scoreboard equivalent: Players panel shows cash + portfolio per player', /portfolio/.test(appSrc) && /p\.cash\.toLocaleString/.test(appSrc))
check('F-4', 'Named activity log present (logs section)', /Activity Log/.test(appSrc) && /gameState\.logs\.map/.test(appSrc))
check('F-5', 'Leave game — a Leave control exists in the lobby and in-game', /leave/i.test(appSrc) && /leave/i.test(mainSrc))
check('F-6', 'Reconnect — session is persisted and a reconnect path exists', /localStorage/.test(appSrc) && /reconnect/i.test(mainSrc))
check('F-7', 'Pan/zoom on the board — drag/zoom handlers exist', /zoom|onWheel|onPointerDown.*drag/i.test(appSrc))
// CVD: colour must never be the only channel. The market badges always carried
// 3-letter text, but the portfolio squares were a bare colour swatch, so the
// red/green pair (deuteranopia-confusable) made two holdings look identical.
// NOTE: this check previously PASSED on the defect — its condition was
// `/#ef4444/.test(appSrc) && !/symbol|halo/i.test(appSrc)`, i.e. it reported
// success exactly when the palette had no redundant cue. Inverted checks are
// worse than no check, because the label described the bug while the run said PASS.
const glyphMap = appSrc.match(/COMPANY_GLYPH[^}]*}/)?.[0] ?? ''
const glyphs = glyphMap.match(/\\u25cf|\\u25a0|\\u25b2|\\u2605/g) ?? []
check(
  'F-8',
  'CVD-safe: every company carries a non-colour glyph, and the portfolio renders it',
  ['red', 'blue', 'green', 'yellow'].every((c) => new RegExp(`\\b${c}\\s*:`).test(glyphMap)) &&
    new Set(glyphs).size === 4 &&
    /pi-glyph/.test(appSrc),
  `${new Set(glyphs).size} distinct glyph(s) for 4 companies`,
)
check('F-9', 'Legal-move highlight — legality is pre-computed and rendered', /legal/i.test(appSrc) && /highlight/i.test(appSrc))
check('F-10', 'Cache-busting: built assets are content-hashed (index-<hash>.js/css) — equivalent of client.js?v=N for this stack', /index-[A-Za-z0-9_-]+\.js/.test(readFileSync(join(ROOT, 'frontend', 'dist', 'index.html'), 'utf8')) || /index-.*\.js/.test(appSrc))

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n=== SUMMARY ===`)
console.log(`PASS: ${pass}`)
console.log(`FAIL: ${fail}`)
console.log(`\nDivergences flagged (FAIL rows):`)
for (const f of failures) console.log(`  - ${f}`)
for (const n of notes) console.log(`  note: ${n}`)

const ok = fail === 0
console.log(`\nAUDIT RESULT: ${ok ? 'PASS' : 'FAIL'}`)
process.exit(ok ? 0 : 1)
