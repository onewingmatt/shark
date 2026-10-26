import asyncio
import json
import uuid
import os
import random
import traceback
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from typing import Dict, Any, List
from pydantic import BaseModel

try:
    from game import GameState, COMPANIES
    from bot_heuristics import get_best_expansion_move, get_best_trade
except ImportError:
    from backend.game import GameState, COMPANIES
    from backend.bot_heuristics import get_best_expansion_move, get_best_trade

app = FastAPI()

# In-memory store
rooms: Dict[str, GameState] = {}
connections: Dict[str, List[WebSocket]] = {}
# Track if a room's bot loop is already running
bot_loops_running: Dict[str, bool] = {}

class JoinRequest(BaseModel):
    room_id: str
    player_id: str
    player_name: str

class CreateRoomRequest(BaseModel):
    variants: List[str] = []

class ActionRequest(BaseModel):
    room_id: str
    player_id: str
    action: str
    data: Dict[str, Any]

class LeaveRequest(BaseModel):
    player_id: str

def _next_active_index(game: "GameState", start: int) -> int:
    """First non-bankrupt seat at or after `start` (wraps)."""
    n = len(game.players)
    if n == 0:
        return 0
    for i in range(n):
        if not game.players[(start + i) % n].bankrupt:
            return (start + i) % n
    return 0

def _remove_player(game: "GameState", player_id: str):
    """Drop a player from the room and keep the turn pointer on a live seat."""
    player = game.get_player(player_id)
    if not player:
        return None
    removed_idx = game.players.index(player)
    was_current = game.current_player() is player
    game.players.remove(player)
    if game.players:
        if was_current:
            idx = removed_idx
        else:
            idx = game.current_turn_index - (1 if removed_idx < game.current_turn_index else 0)
        game.current_turn_index = _next_active_index(game, idx % len(game.players))
    else:
        game.current_turn_index = 0
    game.log(f"👋 {player.name} left the game.")
    return player

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, req: JoinRequest):
    room_id = room_id.upper()
    if room_id not in rooms:
        rooms[room_id] = GameState(room_id)
        connections[room_id] = []
        bot_loops_running[room_id] = False
        
    game = rooms[room_id]
    game.add_player(req.player_id, req.player_name)
    return {"status": "ok", "room_id": room_id, "player_id": req.player_id}

@app.post("/api/rooms/{room_id}/reconnect")
async def reconnect_room(room_id: str, req: JoinRequest):
    """Re-attach a returning client to a seat it already holds (or to a lobby room).

    This is what a reload / dropped socket calls: the client keeps its player_id in
    localStorage and asks the server to restore that seat rather than taking a new one.
    """
    room_id = room_id.upper()
    if room_id not in rooms:
        return {"status": "error", "error": "Room not found"}
    game = rooms[room_id]
    if not game.get_player(req.player_id):
        if game.is_playing or game.game_over:
            return {"status": "error", "error": "Game already started"}
        game.add_player(req.player_id, req.player_name)
    connections.setdefault(room_id, [])
    return {"status": "ok", "room_id": room_id, "player_id": req.player_id}

@app.post("/api/rooms/{room_id}/leave")
async def leave_room(room_id: str, req: LeaveRequest):
    """Leave the room: free the seat, unstick the turn if it was theirs, and tell
    every remaining socket so no client keeps rendering a ghost player."""
    room_id = room_id.upper()
    if room_id not in rooms:
        return {"status": "ok", "left": True}
    game = rooms[room_id]
    player = _remove_player(game, req.player_id)
    if player:
        for ws in list(connections.get(room_id, [])):
            try:
                await ws.send_json({"type": "left", "player_id": req.player_id})
            except Exception:
                pass
        await broadcast_state(room_id)
    return {"status": "ok", "left": True}

@app.post("/api/rooms/{room_id}/add_bot")
async def add_bot(room_id: str):
    room_id = room_id.upper()
    if room_id not in rooms:
        return {"error": "Room not found"}
        
    game = rooms[room_id]
    if game.is_playing:
        return {"error": "Game already started"}
        
    bot_id = "BOT-" + str(uuid.uuid4())[:4].upper()
    bot_names = ["SharkyBot", "FinGPT", "AlphaShark", "DeepBlue"]
    existing_names = [p.name for p in game.players]
    available_names = [n for n in bot_names if n not in existing_names]
    name = random.choice(available_names) if available_names else "Bot_" + bot_id[-4:]
    
    game.add_player(bot_id, name, is_bot=True)
    await broadcast_state(room_id)
    return {"status": "ok", "bot_id": bot_id}

@app.post("/api/rooms/create")
async def create_room(req: CreateRoomRequest):
    room_id = str(uuid.uuid4())[:6].upper()
    rooms[room_id] = GameState(room_id, variants=req.variants)
    connections[room_id] = []
    bot_loops_running[room_id] = False
    return {"room_id": room_id, "variants": req.variants}

async def broadcast_state(room_id: str):
    if room_id not in connections or room_id not in rooms:
        return
        
    game = rooms[room_id]
    disconnected = []
    
    for ws in connections[room_id]:
        try:
            state = game.get_client_state("")
            state["variants"] = game.variants
            await ws.send_json({"type": "state", "state": state})
        except Exception as e:
            disconnected.append(ws)
            
    for ws in disconnected:
        connections[room_id].remove(ws)

async def room_bot_loop(room_id: str):
    """
    A continuous background task per room that monitors for bot turns.
    """
    bot_loops_running[room_id] = True
    print(f"[{room_id}] 🤖 Bot engine initialized.")
    
    while room_id in rooms:
        try:
            game = rooms[room_id]
            
            if not game.is_playing or game.game_over:
                await asyncio.sleep(1.0)
                continue
                
            player = game.current_player()
            
            # Use strict boolean check on Pydantic field
            if not player or not player.is_bot:
                await asyncio.sleep(0.5)
                continue
                
            # --- IT IS A BOT'S TURN ---
            await asyncio.sleep(1.5)
            
            # Check player again in case state changed during sleep
            player = game.current_player()
            if not player or not player.is_bot or not game.is_playing:
                continue
                
            print(f"[{room_id}] 🤖 Executing bot turn for {player.name} in phase {game.phase}")

            if game.phase == "trade1":
                action, comp, count = get_best_trade(game, player)
                if action:
                    game.trade(player.id, action, comp, count)
                    await broadcast_state(room_id)
                    await asyncio.sleep(1.0)
                    
                game.roll_dice()
                await broadcast_state(room_id)
                await asyncio.sleep(2.0) # Bot is "thinking" about placement
                
            elif game.phase == "expand":
                r, c, comp = get_best_expansion_move(game, player, game.current_company_die, game.current_area_die)
                if r != -1 and c != -1:
                    game.expand(player.id, r, c, comp, "choose" if comp in COMPANIES else "place")
                else:
                    # Failsafe if heuristics break down completely
                    game.phase = "trade2"
                    
                await broadcast_state(room_id)
                await asyncio.sleep(1.0)
                
            elif game.phase == "trade2":
                action, comp, count = get_best_trade(game, player)
                if action:
                    game.trade(player.id, action, comp, count)
                    await broadcast_state(room_id)
                    await asyncio.sleep(1.0)
                    
                success, _ = game.end_turn(player.id)
                if success:
                    await broadcast_state(room_id)
                    
        except Exception as e:
            print(f"[{room_id}] ⚠️ CRITICAL BOT ERROR, RECOVERING:")
            traceback.print_exc()
            try:
                game = rooms[room_id]
                player = game.current_player()
                if player and player.is_bot:
                    game.phase = "trade1" # Reset phase state
                    # Skip to next player to unstick
                    for _ in range(len(game.players)):
                        game.current_turn_index = (game.current_turn_index + 1) % len(game.players)
                        if not game.current_player().bankrupt:
                            break
                    game.log(f"💥 {player.name} experienced a critical system failure and passed their turn.")
                    await broadcast_state(room_id)
            except Exception as inner_e:
                print(f"Failed to recover bot turn: {inner_e}")
            await asyncio.sleep(2.0) # Pause before retrying loop
            
    print(f"[{room_id}] 🛑 Bot engine terminating (room destroyed).")
    bot_loops_running.pop(room_id, None)

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()
    room_id = room_id.upper()
    
    if room_id not in connections:
        connections[room_id] = []
    connections[room_id].append(websocket)
    
    if room_id in rooms:
        await broadcast_state(room_id)
        
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg.get("type") == "action":
                action = msg.get("action")
                payload = msg.get("data", {})
                
                if room_id not in rooms:
                    continue
                    
                game = rooms[room_id]
                
                current = game.current_player()
                if action not in ("start", "leave") and (not current or player_id != current.id):
                    continue
                    
                success, error = False, ""
                
                if action == "start":
                    success = game.start_game()
                    if not success: 
                        error = "Need more players"
                    else:
                        # Boot up the room's permanent bot engine if not running already
                        if not bot_loops_running.get(room_id, False):
                            asyncio.create_task(room_bot_loop(room_id))
                            
                elif action == "leave":
                    success = True
                    if game.get_player(player_id):
                        _remove_player(game, player_id)
                        if game.is_playing and not game.game_over:
                            await broadcast_state(room_id)
                elif action == "roll":
                    game.roll_dice()
                    success = True
                elif action == "trade":
                    success, error = game.trade(
                        player_id,
                        payload.get("trade_type"),
                        payload.get("company"),
                        payload.get("count", 1)
                    )
                elif action == "expand":
                    success, error = game.expand(
                        player_id,
                        payload.get("row"),
                        payload.get("col"),
                        payload.get("company"),
                        payload.get("gray_action", "place")
                    )
                elif action == "end_turn":
                    success, error = game.end_turn(player_id)
                    
                if error:
                    await websocket.send_json({"type": "error", "message": error})
                    
                await broadcast_state(room_id)
                
    except WebSocketDisconnect:
        if room_id in connections and websocket in connections[room_id]:
            connections[room_id].remove(websocket)

# Try locating the dist folder correctly whether running locally or in Docker
dist_path = os.path.join(os.path.dirname(__file__), "..", "dist")

if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
elif os.path.exists("dist"):
    # Fallback to current working directory 'dist'
    app.mount("/", StaticFiles(directory="dist", html=True), name="frontend")
elif os.path.exists("/app/dist"):
    # Inside Docker
    app.mount("/", StaticFiles(directory="/app/dist", html=True), name="frontend")
