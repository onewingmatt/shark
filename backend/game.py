import copy
import random
from typing import Literal, List, Dict, Optional, Any, Tuple
from pydantic import BaseModel

Company = Literal["red", "blue", "green", "yellow", "black", "gray"]
Area = Literal["1", "2", "3", "4", "SHARK"]

BOARD_LAYOUT: List[str] = [
    "111111222222",
    "111111222222",
    "111111222222",
    "1111SSSS2222",
    "111SSSSSS222",
    "111SSSSSS222",
    "333SSSSSS444",
    "333SSSSSS444",
    "3333SSSS4444",
    "333333444444",
    "333333444444",
    "333333444444",
]

COMPANIES = ["red", "blue", "green", "yellow"]

class Cell(BaseModel):
    row: int
    col: int
    area: Area
    company: Optional[Company] = None

class Player(BaseModel):
    id: str
    name: str
    cash: int = 0
    stocks: Dict[Company, int] = {c: 0 for c in COMPANIES}
    bankrupt: bool = False
    is_bot: bool = False

def create_initial_board() -> List[List[Cell]]:
    board: List[List[Cell]] = []
    for r, row in enumerate(BOARD_LAYOUT):
        board_row: List[Cell] = []
        for c, ch in enumerate(row):
            area: Area = "SHARK" if ch == "S" else ch  # type: ignore
            board_row.append(Cell(row=r, col=c, area=area))
        board.append(board_row)
    return board

class GameState:
    def __init__(self, room_id: str, variants: List[str] = None):
        self.variants = variants or []
        self.room_id = room_id
        self.players: List[Player] = []
        self.is_playing = False
        
        self.current_turn_index = 0
        self.board: List[List[Cell]] = create_initial_board()
        self.stock_price: Dict[Company, int] = {c: 0 for c in COMPANIES}
        self.remaining_buildings: Dict[Company, int] = {c: 18 for c in COMPANIES}
        self.remaining_buildings["black"] = 6
        self.remaining_buildings["gray"] = 6
        
        self.total_stocks: Dict[Company, int] = {c: 50 for c in COMPANIES}
        self.game_over = False
        self.phase: Literal["trade1", "expand", "trade2", "game_over"] = "trade1"
        self.logs: List[str] = []
        self.log_flags: List[str] = [] 
        
        self.current_company_die: Optional[str] = None
        self.current_area_die: Optional[str] = None
        self.pioneer_extra_turn = False
        self.current_turn_purchases = 0

    def get_player(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def add_player(self, player_id: str, name: str, is_bot: bool = False):
        if not self.is_playing and not self.get_player(player_id):
            self.players.append(Player(id=player_id, name=name, is_bot=is_bot))

    def start_game(self) -> bool:
        if len(self.players) < 2:
            return False
            
        self.is_playing = True
        self.current_turn_index = 0
        self.board = create_initial_board()
        self.stock_price = {c: 0 for c in COMPANIES}
        self.remaining_buildings = {c: 18 for c in COMPANIES}
        self.remaining_buildings["black"] = 6
        self.remaining_buildings["gray"] = 6
        self.game_over = False
        self.phase = "trade1"
        self.logs = ["Game started!"]
        self.pioneer_extra_turn = False
        self.current_turn_purchases = 0
        
        return True

    def current_player(self) -> Player:
        if not self.players: return None # type: ignore
        return self.players[self.current_turn_index]

    def log(self, msg: str, flag: str = None):
        # Insert at index 0 so newest is always first when mapped in UI directly
        self.logs.insert(0, msg)
        if flag:
            self.log_flags.append(flag)
            
        if len(self.logs) > 30:
            self.logs = self.logs[:30]
        if len(self.log_flags) > 10:
            self.log_flags = self.log_flags[-10:]

    def trade(self, player_id: str, action: Literal["buy", "sell"], company: Company, count: int) -> Tuple[bool, str]:
        if not self.is_playing or self.game_over:
            return False, "Game not active"
            
        player = self.get_player(player_id)
        if not player or player.bankrupt:
            return False, "Invalid player"
            
        if player != self.current_player():
            return False, "Not your turn"
            
        if self.phase == "expand":
            return False, "Must expand first"

        if company not in COMPANIES:
            return False, "Invalid company to trade"

        price = self.stock_price[company]
        if price < 1000:
            return False, f"Cannot trade stocks under $1000 (currently ${price})"
            
        if count <= 0:
            return False, "Must trade positive amount"

        if action == "buy":
            if self.current_turn_purchases + count > 5:
                return False, f"You can only buy a maximum of 5 shares per turn (You have already bought {self.current_turn_purchases})."
                
            cost = count * price
            if player.cash < cost:
                return False, f"Not enough cash (need ${cost}, have ${player.cash})"
                
            owned_total = sum(p.stocks[company] for p in self.players)
            if owned_total + count > self.total_stocks[company]:
                return False, "Bank doesn't have enough stocks"
                
            player.cash -= cost
            player.stocks[company] += count
            self.current_turn_purchases += count
            self.log(f"💰 {player.name} bought {count} {company} for ${cost}")
            self.check_game_end()
            return True, ""
            
        elif action == "sell":
            if player.stocks[company] < count:
                return False, f"Not enough stocks to sell (have {player.stocks[company]})"
                
            revenue = count * price
            player.cash += revenue
            player.stocks[company] -= count
            self.log(f"💵 {player.name} sold {count} {company} for ${revenue}")
            return True, ""
            
        return False, "Invalid action"

    def roll_dice(self):
        if self.phase != "trade1": return
        self.log_flags.clear() 
        
        c_die = random.choice(["red", "blue", "green", "yellow", "black", "gray"])
        a_die = random.choice(["1", "2", "3", "4", "SHARK"])
        
        self.current_company_die = c_die
        self.current_area_die = a_die
        self.phase = "expand"
        self.log(f"🎲 Rolled: Company={c_die}, Area={a_die}")

    def _get_adjacent(self, r: int, c: int, include_diagonal: bool = True) -> List[Cell]:
        adj = []
        for dr in [-1, 0, 1]:
            for dc in [-1, 0, 1]:
                if dr == 0 and dc == 0: continue
                if not include_diagonal and dr != 0 and dc != 0: continue
                
                nr, nc = r + dr, c + dc
                if 0 <= nr < 12 and 0 <= nc < 12:
                    adj.append(self.board[nr][nc])
        return adj
        
    def _get_chain(self, start_r: int, start_c: int) -> List[Cell]:
        cell = self.board[start_r][start_c]
        if not cell.company: return []
        
        comp = cell.company
        
        chain = []
        visited = set()
        queue = [(start_r, start_c)]
        
        while queue:
            r, c = queue.pop(0)
            if (r, c) in visited: continue
            visited.add((r, c))
            
            curr = self.board[r][c]
            
            if curr.company == comp or ("joker_buildings" in self.variants and curr.company == "black"):
                chain.append(curr)
                for adj in self._get_adjacent(r, c, include_diagonal=False):
                    if adj.company == comp or ("joker_buildings" in self.variants and adj.company == "black"):
                        if (adj.row, adj.col) not in visited:
                            queue.append((adj.row, adj.col))
                        
        return chain

    def _calculate_global_price(self, company: str) -> int:
        """
        In Shark, the share price of a company is the sum of all its groups of connected buildings 
        that are size 2 or larger, times 1,000.
        A lone, isolated building (size 1) is worth 0 and does not count toward the price sum.
        However, if there is ANY building of that company on the board, the absolute minimum floor is $1000.
        If there are NO buildings of that company, the price is $0.
        """
        all_cells = [(r, c) for r in range(12) for c in range(12) 
                     if self.board[r][c].company == company or ("joker_buildings" in self.variants and self.board[r][c].company == "black")]
                     
        if not all_cells:
            return 0
            
        visited_global = set()
        sum_of_qualifying_chains = 0
        
        for r, c in all_cells:
            if (r, c) in visited_global:
                continue
            chain = self._get_chain(r, c)
            for ch_cell in chain:
                visited_global.add((ch_cell.row, ch_cell.col))
                
            if len(chain) >= 2:
                sum_of_qualifying_chains += len(chain)
                
        price = sum_of_qualifying_chains * 1000
        
        # Floor logic: if price is 0 (i.e. only lone buildings exist) but buildings are on the board, it becomes 1000
        has_actual_company_building = any(self.board[r][c].company == company for r in range(12) for c in range(12))
        
        if price == 0 and has_actual_company_building:
            return 1000
            
        return price

    def _apply_dividends_and_losses(self, old_prices: Dict[Company, int], new_prices: Dict[Company, int]):
        curr_p = self.current_player()
        for comp in COMPANIES:
            diff = new_prices[comp] - old_prices[comp]
            if diff > 0:
                for p in self.players:
                    if p.bankrupt: continue
                    amount = diff * p.stocks[comp]
                    if amount > 0:
                        p.cash += amount
                        self.log(f"📈 {p.name} received ${amount} dividend for {comp}")
            elif diff < 0:
                for p in self.players:
                    if p.bankrupt or p == curr_p: continue
                    amount = (-diff) * p.stocks[comp]
                    if amount > 0:
                        self._charge_loss(p, amount, comp)

    def _charge_loss(self, p: Player, amount: int, comp: str):
        if p.cash >= amount:
            p.cash -= amount
            self.log(f"📉 💸 {p.name} paid ${amount} loss due to {comp} takeover!", flag=f"LOSS_{p.id}")
            return
            
        p.cash -= amount # temporarily negative
        self.log(f"⚠️ {p.name} must sell stocks to cover ${-p.cash} loss", flag=f"LOSS_{p.id}")
        
        while p.cash < 0:
            best_comp = None
            best_val = 0
            for c in COMPANIES:
                if p.stocks[c] > 0:
                    price = self.stock_price[c]
                    sell_price = (price // 2000) * 1000
                    if sell_price > best_val:
                        best_val = sell_price
                        best_comp = c
            
            if not best_comp or best_val == 0:
                p.bankrupt = True
                p.cash = 0
                for c in COMPANIES: p.stocks[c] = 0
                self.log(f"💀 {p.name} went bankrupt!", flag=f"BANKRUPT_{p.id}")
                break
                
            p.stocks[best_comp] -= 1
            p.cash += best_val
            self.log(f"🔥 {p.name} forced to sell 1 {best_comp} for ${best_val}")
            
    def expand(self, player_id: str, target_r: int, target_c: int, chosen_company: Optional[Company] = None, gray_action: str = "place") -> Tuple[bool, str]:
        if not self.is_playing or self.game_over: return False, "Game not active"
        if self.phase != "expand": return False, "Not expansion phase"
        player = self.get_player(player_id)
        if player != self.current_player(): return False, "Not your turn"

        if target_r < 0 or target_r >= 12 or target_c < 0 or target_c >= 12:
            return False, "Invalid cell"

        cell = self.board[target_r][target_c]
        
        comp = self.current_company_die

        # NEUTRAL BUILDING RULE
        if comp == "gray" and "neutral_buildings" in self.variants:
            if gray_action == "remove":
                if cell.company != "gray": return False, "Can only remove gray buildings"
                cell.company = None
                self.remaining_buildings["gray"] += 1
                self.log(f"🚧 {player.name} removed a Gray barrier at {target_r},{target_c}")
                self.phase = "trade2"
                return True, ""
            elif gray_action == "choose":
                if not chosen_company or chosen_company == "gray":
                    return False, "Must choose a non-gray company to place"
                if "joker_buildings" in self.variants and chosen_company == "black":
                    return False, "Gray die cannot be used to place Black Joker buildings when both variants are active"
                comp = chosen_company 
            else:
                if cell.company is not None: return False, "Cell not empty"
                cell.company = "gray"
                self.remaining_buildings["gray"] -= 1
                self.log(f"🚧 {player.name} placed a Gray barrier at {target_r},{target_c}")
                self.phase = "trade2"
                return True, ""

        if cell.company is not None:
            return False, "Cell not empty"

        # Validate area
        if self.current_area_die == "SHARK":
            if cell.area != "SHARK": return False, "Must place in SHARK area"
        else:
            if cell.area != self.current_area_die:
                return False, f"Must place in area {self.current_area_die}"

        # JOKER BUILDING RULE (Black)
        if comp == "black" and "joker_buildings" in self.variants:
            if gray_action == "choose" and "neutral_buildings" in self.variants:
                if chosen_company == "gray":
                    return False, "Black die cannot place Gray barrier when both variants are active"
                comp = chosen_company
            else:
                adj_cells = self._get_adjacent(target_r, target_c, include_diagonal=False)
                if any(a.company for a in adj_cells):
                    return False, "Black Joker buildings must be placed as lone buildings."
                
                cell.company = "black"
                self.remaining_buildings["black"] -= 1
                highest_price = max(self.stock_price.values()) if any(self.stock_price.values()) else 1000
                player.cash += highest_price
                self.log(f"🃏 {player.name} placed a Black Joker building and got ${highest_price} bonus!")
                self.phase = "trade2"
                
                # Prices change because black is wild and might merge later, but it shouldn't trigger here as it is lone.
                return True, ""

        if comp in ["black", "gray"] and not ("joker_buildings" in self.variants and comp == "black") and not ("neutral_buildings" in self.variants and comp == "gray"):
            if not chosen_company:
                return False, "Must choose a company for wildcard die"
            comp = chosen_company
        elif chosen_company and chosen_company != comp and comp not in ["black", "gray"]:
            return False, f"Die is {comp}, cannot choose {chosen_company}"

        if self.remaining_buildings[comp] <= 0: # type: ignore
            return False, f"No remaining {comp} buildings"

        # Check adjacency rules
        adj_cells = self._get_adjacent(target_r, target_c, include_diagonal=False)
        opposing_chains = []
        is_adjacent_same = False
        
        for adj in adj_cells:
            if adj.company == "gray":
                continue
                
            if adj.company and adj.company != comp:
                opp_chain = self._get_chain(adj.row, adj.col)
                if opp_chain not in opposing_chains:
                    opposing_chains.append(opp_chain)
            elif adj.company == comp or ("joker_buildings" in self.variants and adj.company == "black"):
                is_adjacent_same = True

        # Hostile Takeover check
        is_takeover = len(opposing_chains) > 0
        
        if is_takeover:
            if not is_adjacent_same:
                return False, "Hostile takeover requires orthogonal connection to your own company"
            
            temp_chain_len = 1
            for adj in adj_cells:
                if adj.company == comp or ("joker_buildings" in self.variants and adj.company == "black"):
                    temp_chain_len += len(self._get_chain(adj.row, adj.col))
                    
            for opp_chain in opposing_chains:
                if temp_chain_len <= len(opp_chain):
                    return False, "Hostile takeover failed: chain not strictly larger than opposing chain"

        # Apply Placement
        old_prices = self.stock_price.copy()
        
        cell.company = comp # type: ignore
        self.remaining_buildings[comp] -= 1 # type: ignore
        self.log(f"🏗️ {player.name} placed {comp} at {target_r},{target_c}")

        is_lone = not is_adjacent_same and not is_takeover
        
        # Pioneer Rule Check
        if "pioneer_rule" in self.variants:
            if comp not in ["black", "gray"]:
                same_color_in_area = 0
                for r in range(12):
                    for c in range(12):
                        if self.board[r][c].company == comp and self.board[r][c].area == cell.area:
                            same_color_in_area += 1
                
                if same_color_in_area == 1:
                    player.cash += 1000
                    self.log(f"🤠 {player.name} pioneered area {cell.area} with {comp}! Bonus $1000 + EXTRA TURN!")
                    self.pioneer_extra_turn = True

        # Calculate player placement bonuses
        if is_lone:
            player.cash += 1000
            self.log(f"🏢 {player.name} got $1000 bonus for lone building")
        else:
            # We calculate the new price specifically for the chain they touched to give them their placement bonus
            # (which is equal to the NEW stock price of that specific company globally, not just that chain)
            pass

        # Resolve Hostile Takeover Removals BEFORE global price recalculation
        if is_takeover:
            self.log(f"🚨 HOSTILE TAKEOVER INITIATED BY {player.name}!", flag="TAKEOVER")
            removed = {c: 0 for c in COMPANIES}
            for adj in adj_cells:
                if adj.company and adj.company != comp and adj.company != "gray":
                    chain_to_remove = self._get_chain(adj.row, adj.col)
                    if not chain_to_remove: # Lone
                        adj_comp = adj.company
                        if adj_comp == "black" and "joker_buildings" in self.variants:
                            removed["black"] = removed.get("black", 0) + 1
                        else:
                            self.board[adj.row][adj.col].company = None
                            self.remaining_buildings[adj_comp] += 1
                            self.log(f"💥 Removed lone {adj_comp} at {adj.row},{adj.col}")
                    else:
                        adj_comp = chain_to_remove[0].company
                        for rc in chain_to_remove:
                            if rc.company == "black" and "joker_buildings" in self.variants:
                                removed[adj_comp] += 1
                            else:
                                rc.company = None
                                self.remaining_buildings[adj_comp] += 1
                                removed[adj_comp] += 1
                                self.log(f"💥 Removed {adj_comp} at {rc.row},{rc.col}")

        # Recalculate ALL stock prices based on the new board state
        for c in COMPANIES:
            self.stock_price[c] = self._calculate_global_price(c)
            
        # Distribute placement bonus to the player AFTER prices update, ONLY if they formed a chain
        if not is_lone:
            player.cash += self.stock_price[comp]
            self.log(f"🏙️ {player.name} got ${self.stock_price[comp]} bonus for building chain")

        self._apply_dividends_and_losses(old_prices, self.stock_price)
        
        self.phase = "trade2"
        self.check_game_end()
        return True, ""

    def end_turn(self, player_id: str) -> Tuple[bool, str]:
        if not self.is_playing or self.game_over: return False, "Game not active"
        if self.phase not in ["trade1", "trade2", "expand"]: return False, "Not ready to end turn"
        if self.phase == "expand": return False, "Must expand before ending turn"
        
        player = self.get_player(player_id)
        if player != self.current_player(): return False, "Not your turn"

        if self.pioneer_extra_turn:
            self.pioneer_extra_turn = False
            self.phase = "trade1"
            self.current_turn_purchases = 0 
            self.log(f"⏩ {player.name} takes their PIONEER extra turn!")
            return True, ""

        for _ in range(len(self.players)):
            self.current_turn_index = (self.current_turn_index + 1) % len(self.players)
            if not self.current_player().bankrupt:
                break
                
        self.phase = "trade1"
        self.current_turn_purchases = 0 
        self.log(f"⏱️ Turn passed to {self.current_player().name}")
        self.log_flags.clear()
        return True, ""

    def check_game_end(self):
        end = False
        reason = ""
        for c in COMPANIES:
            if "short_game" in self.variants:
                if self.stock_price[c] >= 10000:
                    end = True
                    reason = f"{c} hit $10,000"
            else:
                if self.stock_price[c] >= 15000:
                    end = True
                    reason = f"{c} hit $15,000"
                    
            if self.remaining_buildings[c] == 0:
                end = True
                reason = f"All {c} buildings used"
            if sum(p.stocks[c] for p in self.players) == self.total_stocks[c]:
                end = True
                reason = f"All {c} stocks bought"
                
        active_players = [p for p in self.players if not p.bankrupt]
        if len(active_players) <= 1:
            end = True
            reason = "All other players bankrupt"

        if end:
            self.game_over = True
            self.phase = "game_over"
            self.is_playing = False
            self.log(f"🏁 Game Over! {reason}")
            
            for p in self.players:
                wealth = p.cash + sum(p.stocks[c] * self.stock_price[c] for c in COMPANIES)
                self.log(f"🏆 {p.name} final wealth: ${wealth}")

    def _expand_combos(self) -> List[Tuple[Optional[Any], str]]:
        """(chosen_company, gray_action) pairs describing every allowed reading of the
        current dice roll. Used only to enumerate placements for the client's
        legal-move highlight; expand() remains the sole authority on legality."""
        comp = self.current_company_die
        combos: List[Tuple[Optional[Any], str]] = []
        if comp == "gray" and "neutral_buildings" in self.variants:
            combos.append((None, "place"))      # barrier on any empty cell
            combos.append((None, "remove"))     # take an existing gray barrier off
            for c in COMPANIES:
                combos.append((c, "choose"))    # any standard company building
        elif comp == "black" and "joker_buildings" in self.variants:
            combos.append((None, "place"))      # black joker (lone only)
            if "neutral_buildings" in self.variants:
                for c in COMPANIES:
                    combos.append((c, "choose"))
        elif comp in ("black", "gray"):         # wildcard die faces
            for c in COMPANIES:
                combos.append((c, "place"))
        else:
            combos.append((None, "place"))
        return combos

    def legal_expansions(self) -> List[List[int]]:
        """Cells the CURRENT player may legally build on during this expand phase.

        Enumerated by replaying expand() against a throwaway deep copy of this state,
        so the client's legal-move highlight is derived from the engine's own
        validation and cannot drift from it. Read-only — nothing here is mutated.
        """
        if not self.is_playing or self.game_over or self.phase != "expand":
            return []
        player = self.current_player()
        if not player or not self.current_company_die:
            return []

        cells: List[List[int]] = []
        combos = self._expand_combos()
        for r in range(12):
            for c in range(12):
                for chosen, gray_action in combos:
                    snap = copy.deepcopy(self)
                    ok, _ = snap.expand(player.id, r, c, chosen, gray_action)
                    if ok:
                        cells.append([r, c])
                        break
        return cells

    def get_client_state(self, player_id: str) -> Dict[str, Any]:
        return {
            "room_id": self.room_id,
            "status": "playing" if self.is_playing else ("game_over" if self.game_over else "waiting"),
            "players": [p.model_dump() for p in self.players],
            "current_player": self.current_player().id if self.current_player() else None,
            "phase": self.phase,
            "board": [[c.model_dump() for c in row] for row in self.board],
            "stock_price": self.stock_price,
            "remaining_buildings": self.remaining_buildings,
            "total_stocks": self.total_stocks,
            "logs": self.logs,
            "log_flags": self.log_flags,
            "my_id": player_id,
            "current_company_die": self.current_company_die,
            "current_area_die": self.current_area_die,
            "variants": self.variants,
            "current_turn_purchases": self.current_turn_purchases,
            "legal_cells": self.legal_expansions()
        }
