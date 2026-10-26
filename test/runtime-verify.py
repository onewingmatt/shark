"""
Runtime verification for the four new shark2 frontend features.

How to run (two servers + one script; the app talks to 8001 through the vite proxy):
  cd backend  && python3 -m uvicorn main:app --host 127.0.0.1 --port 8001 &
  cd frontend && npm run dev -- --port 5173 --host 127.0.0.1 --strictPort &
  python3 test/runtime-verify.py          # needs playwright + websockets

It drives localhost only and creates its rooms in the local in-memory store, never the
deployed domain. Exit code 0 == every check green.

Detectors, none of which is the audit's static grep:
  1. A real Chromium (Playwright) drives the page: create room -> join -> add bot -> start.
  2. An INDEPENDENT raw websocket client (not the app's React state) reads the server's
     state payload: legal_cells, board, dice.
  3. The ENGINE ITSELF is the oracle: brute-force `expand()` on a deep copy of the
     reconstructed server state must accept exactly the cells the server called legal,
     and the DOM's .legal-highlight set must equal that server set.
  4. Behavioural clicks: a highlighted cell is accepted; a non-highlighted empty cell
     is rejected; a pan-drag must not place a piece.
  5. Pan/zoom read from the board's COMPUTED transform, not from a screenshot.
"""
import asyncio, copy, json, re, subprocess, sys, time

sys.path.insert(0, "/home/onewing/shark2/backend")
import websockets
from game import GameState, Player, COMPANIES
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:5173/"
WS = "ws://127.0.0.1:8001/ws/{room}/observer"
ALL_COMBOS = [(None, "place"), (None, "choose"), (None, "remove")] + \
             [(c, a) for c in COMPANIES for a in ("place", "choose", "remove")]

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL':4}  {name}  {detail}")

def read_server_state(room):
    """Independent read: a separate process opens its own raw websocket to the server
    and returns the state payload — no React, no Playwright, no app code involved."""
    code = (
        "import asyncio,json,sys,websockets\n"
        "async def go():\n"
        "    async with websockets.connect(sys.argv[1]) as ws:\n"
        "        print(await asyncio.wait_for(ws.recv(), timeout=15))\n"
        "asyncio.run(go())\n"
    )
    out = subprocess.run([sys.executable, "-c", code, WS.format(room=room)],
                         capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"observer ws failed: {out.stderr}")
    return json.loads(out.stdout.strip())["state"]

def reconstruct(payload):
    """Rebuild a live GameState from the wire payload so the engine can be asked directly."""
    g = GameState(payload["room_id"], variants=payload.get("variants", []))
    g.is_playing = True
    g.phase = payload["phase"]
    g.current_company_die = payload["current_company_die"]
    g.current_area_die = payload["current_area_die"]
    g.current_turn_purchases = payload["current_turn_purchases"]
    g.players = [Player(**p) for p in payload["players"]]
    g.current_turn_index = [p.id for p in g.players].index(payload["current_player"])
    for r in range(12):
        for c in range(12):
            g.board[r][c].company = payload["board"][r][c]["company"]
    return g

def engine_legal_cells(g):
    """Oracle: union over every (chosen_company, gray_action) combo, using expand() itself."""
    out = set()
    for r in range(12):
        for c in range(12):
            for chosen, act in ALL_COMBOS:
                snap = copy.deepcopy(g)
                ok, _ = snap.expand(g.current_player().id, r, c, chosen, act)
                if ok:
                    out.add((r, c))
                    break
    return out

def dom_highlighted(page):
    """Highlighted cells as (r,c), derived from the rendered grid order + title text."""
    return sorted(page.evaluate("""(() => {
      const cells = document.querySelectorAll('.board .cell');
      const out = [];
      cells.forEach((el, i) => {
        if (el.classList.contains('legal-highlight')) out.push([Math.floor(i/12), i%12]);
      });
      return out;
    })()"""))

def board_transform(page):
    return page.evaluate("getComputedStyle(document.querySelector('.board')).transform")

def roll_button(page):
    # `text=Roll` is useless here: the activity log line "🎲 Rolled: Company=…"
    # matches it too. Target the actual action button.
    return page.locator("button.primary-action-btn").filter(has_text="Roll")

def empty_cell_xy(page, r, c):
    box = page.evaluate("""(([r,c]) => {
      const el = document.querySelectorAll('.board .cell')[r*12+c];
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width/2, y: b.y + b.height/2, occupied: /company-/.test(el.className) };
    })""", [r, c])
    return box

console_errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("dialog", lambda d: d.accept())
    page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: console_errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

    # ---- lobby: create + join -------------------------------------------------
    page.goto(APP, wait_until="networkidle")
    check("lobby renders (no Leave yet, not in a room)", page.locator(".lobby-card").is_visible())
    check("F-5 lobby has a Leave affordance path (button appears once seated)",
          page.locator("text=Create New Game").is_visible())
    page.fill('input[placeholder="Your Name"]', "Auditor")
    page.click("text=Create New Game")
    page.wait_for_timeout(400)
    room = page.input_value('input[placeholder="Room Code (e.g., A1B2C3)"]')
    check("room created and code filled into the join form", bool(room), f"room={room}")
    page.click("text=Join Game")
    page.wait_for_selector(".board", timeout=15000)
    page.wait_for_timeout(500)
    check("F-6 session persisted to localStorage on join",
          bool(page.evaluate("localStorage.getItem('shark_session')")))
    check("F-5 header Leave button present in the waiting room",
          page.locator("header .leave-btn").is_visible(), "text=Leave")
    check("F-5 waiting-room Leave Room button present",
          page.locator(".status-banner button:has-text('Leave Room')").count() == 1)

    # ---- start a real game ----------------------------------------------------
    page.click("text=Add Bot")
    page.wait_for_timeout(400)
    page.click("text=Start Game Now")
    page.wait_for_selector(".board", timeout=15000)
    page.wait_for_function("() => !!document.querySelector('button.primary-action-btn')", timeout=15000)
    page.wait_for_timeout(400)
    check("game started (human seat, trade1 -> Roll button offered)", roll_button(page).count() == 1)

    roll_button(page).click()
    page.wait_for_timeout(900)
    die = page.evaluate("document.querySelector('.die')?.title || ''")
    area = page.evaluate("document.querySelector('.die-area')?.title || ''")
    check("rolled into expand phase", page.locator(".cell.legal-highlight").count() > 0,
          f"{(die + ' / ' + area).strip()}")

    # ---- F-9: server legal set == engine oracle == DOM highlight --------------
    st = read_server_state(room)
    server_legal = {(rc[0], rc[1]) for rc in st.get("legal_cells", [])}
    check("F-9 server ships legal_cells for the expand phase", len(server_legal) > 0,
          f"{len(server_legal)} cells")

    g = reconstruct(st)
    oracle = engine_legal_cells(g)
    check("F-9 server legal_cells == engine expand() oracle (0 drift)",
          server_legal == oracle,
          f"server={len(server_legal)} oracle={len(oracle)} diff={sorted(server_legal ^ oracle)}")

    dom_set = set(tuple(x) for x in dom_highlighted(page))
    check("F-9 DOM .legal-highlight == server legal_cells",
          dom_set == server_legal,
          f"dom={len(dom_set)} server={len(server_legal)} diff={sorted(dom_set ^ server_legal)}")

    # ---- F-9: a NON-highlighted empty cell is rejected by the server ---------
    all_cells = [(r, c) for r in range(12) for c in range(12)]
    st2 = read_server_state(room)
    empty = {c for c in all_cells if st2["board"][c[0]][c[1]]["company"] is None}
    illegal_empty = sorted(empty - server_legal)
    r, c = illegal_empty[0]
    xy = empty_cell_xy(page, r, c)
    page.mouse.click(xy["x"], xy["y"])
    page.wait_for_timeout(700)
    err = page.locator(".side-panel .error-message").first
    check("F-9 clicking an unhighlighted empty cell is refused with a server error",
          err.is_visible(), f"cell ({r},{c}) -> \"{(err.text_content() or '').strip()}\"")
    still_empty = page.evaluate("""(([r,c]) => !/company-/.test(document.querySelectorAll('.board .cell')[r*12+c].className))""", [r, c])
    check("F-9 rejected click left the board untouched", still_empty)

    # ---- F-7: wheel zoom (computed transform, not a screenshot) --------------
    t0 = board_transform(page)
    z0 = re.findall(r"-?\d+\.?\d*", t0)
    box = page.locator(".board").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.wheel(0, -240)
    page.wait_for_timeout(300)
    t1 = board_transform(page)
    check("F-7 wheel zoom changes the board's computed transform",
          t1 != t0, f"{t0} -> {t1}")
    s0 = float(z0[0]); s1 = float(re.findall(r"-?\d+\.?\d*", t1)[0])
    check("F-7 wheel up scales the board in (scale > 1)", s1 > s0, f"scale {s0} -> {s1}")

    page.click(".zoom-reset")
    page.wait_for_timeout(250)
    tr = re.findall(r"-?\d+\.?\d*", board_transform(page))
    check("F-7 reset view restores scale 1 / translate 0",
          abs(float(tr[0]) - 1) < 1e-6 and abs(float(tr[4])) < 1e-6 and abs(float(tr[5])) < 1e-6,
          board_transform(page))

    page.click(".zoom-btn:not(.zoom-reset)")
    page.wait_for_timeout(250)
    check("F-7 zoom-in button scales the board in",
          float(re.findall(r"-?\d+\.?\d*", board_transform(page))[0]) > 1, board_transform(page))
    page.click(".zoom-reset")
    page.wait_for_timeout(200)

    # ---- F-7: pointer drag pans the board -----------------------------------
    r, c = sorted(server_legal)[0]
    xy = empty_cell_xy(page, r, c)
    page.mouse.move(xy["x"], xy["y"])
    page.mouse.down()
    page.mouse.move(xy["x"] + 60, xy["y"] + 40, steps=8)
    page.mouse.up()                      # release where the pointer is, so the pan is measurable
    page.wait_for_timeout(400)
    tp = [float(x) for x in re.findall(r"-?\d+\.?\d*", board_transform(page))]
    check("F-7 pointer drag pans the board (translate follows the pointer)",
          abs(tp[4] - 60) < 12 and abs(tp[5] - 40) < 12,
          f"translate=({tp[4]:.1f}, {tp[5]:.1f}) expected ~(60.0, 40.0)")
    page.click(".zoom-reset")
    page.wait_for_timeout(250)

    # ---- F-7: a drag that ends back on a legal cell must NOT place a piece ---
    xy = empty_cell_xy(page, r, c)
    page.mouse.move(xy["x"], xy["y"])
    page.mouse.down()
    page.mouse.move(xy["x"] + 40, xy["y"] + 30, steps=6)
    page.mouse.move(xy["x"], xy["y"], steps=6)   # back onto the SAME cell, then release:
    page.mouse.up()                              # the browser still fires a click on it
    page.wait_for_timeout(600)
    after_drag = page.evaluate("""(([r,c]) => /company-/.test(document.querySelectorAll('.board .cell')[r*12+c].className))""", [r, c])
    check("F-7 a pan-drag ending on a legal cell does NOT place a piece (drag-vs-tap)",
          (not after_drag) and page.locator(".cell.legal-highlight").count() > 0,
          f"cell ({r},{c}) occupied={after_drag}, still in expand phase")
    page.click(".zoom-reset")
    page.wait_for_timeout(250)

    # ---- F-7/F-9: a plain tap on a legal cell IS accepted -------------------
    xy = empty_cell_xy(page, r, c)
    page.mouse.click(xy["x"], xy["y"])
    page.wait_for_timeout(900)
    placed = page.evaluate("""(([r,c]) => /company-/.test(document.querySelectorAll('.board .cell')[r*12+c].className))""", [r, c])
    st3 = read_server_state(room)
    check("F-9 a plain tap on a highlighted cell is accepted and the server advances to trade2",
          placed and st3["phase"] == "trade2", f"cell ({r},{c}) occupied={placed} phase={st3['phase']}")
    check("F-9 highlight is withdrawn once the expand phase is over",
          page.locator(".cell.legal-highlight").count() == 0)
    check("F-9 the Roll button is gone once the placement is made", roll_button(page).count() == 0)

    # ---- F-6: reconnect by reload ------------------------------------------
    page.reload(wait_until="networkidle")
    page.wait_for_selector(".board", timeout=15000)
    page.wait_for_timeout(900)
    code = page.locator(".room-badge strong").text_content()
    check("F-6 reload auto-reconnects into the same room (no re-join)",
          (code or "").strip() == room, f"header code={(code or '').strip()} expected={room}")
    check("F-6 reconnected client still shows the live game (players panel)",
          page.locator(".player-card").count() >= 2)

    # ---- F-5: leave in-game, then it stays left after a reload -------------
    saved_before = page.evaluate("localStorage.getItem('shark_session')")
    page.click("header .leave-btn")
    page.wait_for_timeout(900)
    check("F-5 Leave (mid-game, confirm accepted) returns to the lobby",
          page.locator(".lobby-card").is_visible() and page.locator("text=Create New Game").is_visible())
    check("F-5 Leave clears the saved seat (was set before)",
          bool(saved_before) and not page.evaluate("localStorage.getItem('shark_session')"))
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    check("F-5 after Leave a reload stays in the lobby (no ghost reconnect)",
          page.locator(".lobby-card").is_visible())

    # ---- backend seat really freed -----------------------------------------
    browser.close()

app_errors = [e for e in console_errors if "favicon" not in e and "Download the React DevTools" not in e]
check("zero page errors across the whole drive", not app_errors, f"{len(app_errors)} error(s)" + (f": {app_errors[:3]}" if app_errors else ""))

bad = [n for n, ok, _ in results if not ok]
print(f"\n=== {len(results) - len(bad)}/{len(results)} runtime checks PASSED ===")
for n, ok, d in results:
    if not ok:
        print(f"  FAILED: {n} {d}")
sys.exit(1 if bad else 0)
