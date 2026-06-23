import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Play, DollarSign, Info, ArrowRightCircle, RefreshCcw, Bot, ArrowUpCircle, ArrowDownCircle, Settings, HelpCircle, X, Activity, Users, FileText, ChevronDown } from "lucide-react";
import "./App.css";

const COMPANIES = ["red", "blue", "green", "yellow"];

function App() {
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [gameState, setGameState] = useState<any>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [variants, setVariants] = useState<string[]>(["open_hands"]); 

  const [tradeCompany, setTradeCompany] = useState("red");
  const [tradeCount, setTradeCount] = useState(1);
  const [wildcardCompany, setWildcardCompany] = useState("red");
  const [grayAction, setGrayAction] = useState("place");
  
  const [lossAnimations, setLossAnimations] = useState<Record<string, boolean>>({});
  
  const [activeMobileTab, setActiveMobileTab] = useState("controls"); // controls, market, players, logs
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);
  
  // Collapsible sections state
  const [collapsedMarket, setCollapsedMarket] = useState(false);
  const [collapsedPlayers, setCollapsedPlayers] = useState(false);
  const [collapsedLogs, setCollapsedLogs] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);
  
  useEffect(() => {
    if (gameState?.room_id) {
        document.title = `Shark [${gameState.room_id}]`;
    } else {
        document.title = "Shark";
    }
  }, [gameState?.room_id]);

  const connectWs = (room: string, player: string) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/${room}/${player}`;
    const socket = new WebSocket(url);
    
    socket.onopen = () => {
      console.log("Connected to WS");
      setErrorMsg("");
    };
    
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "state") {
        const newState = data.state;
        
        if (newState.log_flags && newState.log_flags.length > 0) {
            const newAnimations: Record<string, boolean> = {};
            newState.log_flags.forEach((flag: string) => {
                if (flag.startsWith("LOSS_") || flag.startsWith("BANKRUPT_")) {
                    const id = flag.split("_")[1];
                    newAnimations[id] = true;
                }
            });
            
            if (Object.keys(newAnimations).length > 0) {
                setLossAnimations(newAnimations);
                setTimeout(() => setLossAnimations({}), 1500);
            }
        }
        
        setGameState(newState);
        setErrorMsg("");
      } else if (data.type === "error") {
        setErrorMsg(data.message);
        setTimeout(() => setErrorMsg(""), 5000);
      }
    };
    
    socket.onclose = () => {
      console.log("Disconnected from WS");
      setWs(null);
    };
    
    wsRef.current = socket;
    setWs(socket);
  };

  const createRoom = async () => {
    try {
      const res = await fetch("/api/rooms/create", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants }) 
      });
      const data = await res.json();
      setRoomId(data.room_id);
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to create room. Ensure backend is running.");
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !playerName) return;
    
    const pid = Math.random().toString(36).substring(2, 9);
    setPlayerId(pid);
    
    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, player_id: pid, player_name: playerName })
      });
      
      if (res.ok) {
        connectWs(roomId, pid);
      } else {
        setErrorMsg("Failed to join room. It might not exist.");
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to join room.");
    }
  };
  
  const addBot = async () => {
    if (!gameState) return;
    try {
      const res = await fetch(`/api/rooms/${gameState.room_id}/add_bot`, { method: "POST" });
      if (!res.ok) setErrorMsg("Failed to add bot.");
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to add bot.");
    }
  }

  const sendAction = (action: string, data: any = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "action", action, data }));
  };

  const handleCellClick = (r: number, c: number) => {
    if (gameState?.phase !== "expand") return;
    if (gameState?.current_player !== playerId) return;
    
    let comp = gameState.current_company_die;
    
    if (comp === "black" && !gameState.variants.includes("joker_buildings")) {
      comp = wildcardCompany;
    } else if (comp === "gray" && !gameState.variants.includes("neutral_buildings")) {
      comp = wildcardCompany;
    } else if (comp === "gray" && gameState.variants.includes("neutral_buildings") && grayAction === "choose") {
      comp = wildcardCompany;
    }
    
    sendAction("expand", { row: r, col: c, company: comp, gray_action: grayAction });
    
    // Automatically switch to market tab on mobile after placing a piece so they see the result
    if (isMobile) setActiveMobileTab("market");
  };
  
  const toggleVariant = (variant: string) => {
    setVariants(prev => prev.includes(variant) ? prev.filter(v => v !== variant) : [...prev, variant]);
  }

  const getRemainingStocks = (company: string) => {
    if (!gameState) return 0;
    const totalOwned = gameState.players.reduce((sum: number, p: any) => sum + (p.stocks[company] || 0), 0);
    return Math.max(0, gameState.total_stocks[company] - totalOwned);
  };

  if (!ws) {
    return (
      <div className="lobby-container">
        <div className="lobby-card">
          <h1>SHARK</h1>
          <p>The ruthless game of stocks and hostile takeovers.</p>
          
          {errorMsg && (
            <div className="error-message">
              <AlertCircle size={24} />
              {errorMsg}
            </div>
          )}
          
          <div className="lobby-form">
            <button type="button" onClick={() => setShowHowToPlay(true)} style={{ background: "transparent", color: "var(--primary)", border: "2px solid var(--primary)", marginBottom: "1rem" }}>
              <HelpCircle size={18} /> Read the Rules
            </button>
            
            <div className="variant-selection">
              <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--text-muted)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Settings size={16} /> GAME VARIANTS
              </div>
              <label className="variant-label" title="End game when a stock hits $10,000 instead of $15,000">
                <input type="checkbox" checked={variants.includes("short_game")} onChange={() => toggleVariant("short_game")} />
                Short Game (End at $10k)
              </label>
              <label className="variant-label" title="Black die places a wild Joker building">
                <input type="checkbox" checked={variants.includes("joker_buildings")} onChange={() => toggleVariant("joker_buildings")} />
                Joker Buildings (Black Die)
              </label>
              <label className="variant-label" title="Gray die places/removes a blocking Neutral building">
                <input type="checkbox" checked={variants.includes("neutral_buildings")} onChange={() => toggleVariant("neutral_buildings")} />
                Neutral Buildings (Gray Die)
              </label>
              <label className="variant-label" title="Pioneering a new area grants an extra turn">
                <input type="checkbox" checked={variants.includes("pioneer_rule")} onChange={() => toggleVariant("pioneer_rule")} />
                Pioneer Rule
              </label>
              <label className="variant-label" title="See exact stock counts of opponents">
                <input type="checkbox" checked={variants.includes("open_hands")} onChange={() => toggleVariant("open_hands")} />
                Open Hands (Visible Stocks)
              </label>
            </div>
            
            <button type="button" onClick={createRoom} style={{ background: "var(--primary)", color: "#fff", fontSize: "1.1rem", padding: "1rem" }}>
              <Play size={20} /> Create New Game
            </button>
            
            <div className="divider">OR JOIN EXISTING</div>
            
            <form onSubmit={joinRoom} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <input 
                placeholder="Room Code (e.g., A1B2C3)" 
                value={roomId} 
                onChange={e => setRoomId(e.target.value.toUpperCase())} 
                required 
              />
              <input 
                placeholder="Your Name" 
                value={playerName} 
                onChange={e => setPlayerName(e.target.value)} 
                required 
                maxLength={12}
              />
              <button type="submit" style={{ background: "#334155" }}>Join Game</button>
            </form>
          </div>
        </div>
        
        {showHowToPlay && (
          <div className="how-to-play-modal" onClick={() => setShowHowToPlay(false)}>
            <div className="how-to-play-content" onClick={e => e.stopPropagation()}>
              <button className="close-button" onClick={() => setShowHowToPlay(false)}><X size={32} /></button>
              <h2>How to Play Shark 🦈</h2>
              
              <h3>Objective</h3>
              <p>Be the wealthiest player when the game ends. You earn wealth by buying and selling stocks, expanding companies, and triggering hostile takeovers.</p>

              <h3>Turn Structure</h3>
              <ul>
                <li><strong>Trade (Optional):</strong> Buy up to 5 stocks total and/or sell any number. Stocks must be ≥ $1,000 to trade.</li>
                <li><strong>Expand (Mandatory):</strong> Roll the Company and Area dice. Place a building of the rolled company onto an empty cell in the rolled area.</li>
                <li><strong>Trade Again (Optional):</strong> You can buy/sell again, observing the 5-stock buy limit for the whole turn.</li>
              </ul>
              
              <h3>Placing Buildings</h3>
              <ul>
                <li><strong>Lone Building:</strong> Placing a building not orthogonally adjacent to any other buildings grants you a $1,000 bonus.</li>
                <li><strong>Chains:</strong> Placing adjacent to others of the SAME color forms a chain. The stock price becomes $1,000 × (buildings in chain). You get a cash bonus equal to the new stock price!</li>
                <li><strong>Hostile Takeover:</strong> You can place adjacent to an OPPOSING company ONLY IF your newly formed chain is strictly larger than the opposing chain. You destroy the opposing buildings, dropping their stock price!</li>
              </ul>

              <h3>Dividends & Losses</h3>
              <p>Whenever a company's stock price goes UP, everyone holding that stock gets paid the difference in cash. When it goes DOWN (due to a takeover), everyone (except the current player) pays the difference! If you can't pay, you must sell stocks at half price or go bankrupt.</p>

              <h3>Optional Variants</h3>
              <ul>
                <li><strong>Joker (Black Die):</strong> Black buildings are wild, placed as lone buildings. Bonus = highest stock price. Once chained, they adopt that color forever and cannot be removed. <em>(If played with Neutral Buildings, the black die instead lets you choose any building EXCEPT gray.)</em></li>
                <li><strong>Neutral (Gray Die):</strong> Grey buildings are barriers blocking expansion. When rolled, choose to place a gray barrier, remove an existing gray barrier, or place any standard company building instead. <em>(If played with Joker Buildings, you cannot choose to place Black.)</em></li>
                <li><strong>Pioneer Rule:</strong> The first building placed in a new area grants $1000 and an immediate extra turn (max 2 per turn). Note: Placing a Black or Gray Special Building does not trigger this.</li>
                <li><strong>Open Hands:</strong> You can see exactly how many stocks of each color your opponents hold.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!gameState) return <div className="lobby-container"><div className="lobby-card">Loading Game State...</div></div>;

  const isMyTurn = gameState.current_player === playerId;
  const me = gameState.players.find((p: any) => p.id === playerId);
  const remainingBuys = Math.max(0, 5 - (gameState.current_turn_purchases || 0));

  const getCompanyColorClasses = (company: string) => {
    if (company === "black") return "company-black";
    if (company === "gray") return "company-gray";
    return `company-${company}`;
  };

  let wildcardOptions = [...COMPANIES];
  if (gameState.current_company_die === "black" && gameState.variants.includes("joker_buildings") && gameState.variants.includes("neutral_buildings")) {
      wildcardOptions = [...COMPANIES]; 
  } else if (gameState.current_company_die === "gray" && gameState.variants.includes("neutral_buildings")) {
       wildcardOptions = [...COMPANIES]; 
  } else {
      wildcardOptions = [...COMPANIES];
  }

  const isTabVisible = (tab: string) => {
      if (!isMobile) return true; // Always show everything on desktop
      return activeMobileTab === tab;
  };

  return (
    <div className="container">
      <header>
        <div className="header-left">
          <h2 style={{margin:0}}>🦈 SHARK</h2>
          <div className="header-divider"></div>
          <div className="room-badge">
            Code: <strong>{gameState.room_id}</strong>
          </div>
        </div>
        <div className="header-right">
        
        <div className="player-tag" title="Your Username">👤 {playerName}</div>
        </div>
      </header>

      <div className="main-content">
        <div className="board-container" style={{ display: 'flex', flexDirection: 'column' }}>
          {gameState.phase === "expand" && gameState.current_company_die && (
            <div className="dice-overlay">
              <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <div className="dice-label">Company</div>
                <div className={`die company-${gameState.current_company_die}`} title={`Company Rolled: ${gameState.current_company_die}`}>
                  {['black', 'gray'].includes(gameState.current_company_die) ? gameState.current_company_die[0].toUpperCase() : ""}
                </div>
              </div>
              <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <div className="dice-label">Area</div>
                <div className={`die die-area ${gameState.current_area_die === "SHARK" ? "shark-face" : ""}`} title={`Area Rolled: ${gameState.current_area_die}`}>
                  {gameState.current_area_die !== "SHARK" ? gameState.current_area_die : ""}
                </div>
              </div>
            </div>
          )}
          
          <div className="board">
            {gameState.board.map((row: any[], r: number) =>
              row.map((cell: any, c: number) => (
                <div
                  key={`${r}-${c}`}
                  className={`cell area-${cell.area.toLowerCase()} ${
                    cell.company ? getCompanyColorClasses(cell.company) : ""
                  }`}
                  onClick={() => handleCellClick(r, c)}
                  title={`Area: ${cell.area} | Row ${r+1}, Col ${c+1}`}
                >
                  {cell.company ? "" : cell.area === "SHARK" ? "" : cell.area}
                </div>
              ))
            )}
          </div>
        </div>

        {/* MOBILE ONLY TAB BAR */}
        <div className="mobile-tabs">
            <button className={`mobile-tab-btn ${activeMobileTab === "controls" ? "active" : ""}`} onClick={() => setActiveMobileTab("controls")}>
                <Settings size={18} /> Actions
            </button>
            <button className={`mobile-tab-btn ${activeMobileTab === "market" ? "active" : ""}`} onClick={() => setActiveMobileTab("market")}>
                <Activity size={18} /> Market
            </button>
            <button className={`mobile-tab-btn ${activeMobileTab === "players" ? "active" : ""}`} onClick={() => setActiveMobileTab("players")}>
                <Users size={18} /> Players
            </button>
            <button className={`mobile-tab-btn ${activeMobileTab === "logs" ? "active" : ""}`} onClick={() => setActiveMobileTab("logs")}>
                <FileText size={18} /> Logs
            </button>
        </div>

        {/* SIDEBAR */}
        <div className="side-panel">
          
          {errorMsg && (
            <div className="error-message" style={{ margin: "0", flex: "none" }}>
              <AlertCircle size={20} /> {errorMsg}
            </div>
          )}
          
          <div className={`status-section ${isTabVisible('controls') ? '' : 'mobile-hidden'}`}>
            {gameState.status === "waiting" && (
              <div className="status-banner status-waiting" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1rem", margin: 0 }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <Info size={32} />
                  <div>
                    <strong>Waiting for players...</strong>
                    <div style={{ fontSize: "0.95rem", marginTop: "0.25rem", fontFamily: "'Space Mono', monospace" }}>Share code <b style={{ color: "#eab308", fontSize: "1.1rem" }}>{gameState.room_id}</b> to invite others.</div>
                    {gameState.variants && gameState.variants.length > 0 && (
                      <div style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: "#ca8a04", fontWeight: "bold", textTransform: "uppercase" }}>
                        Active Variants: {gameState.variants.join(" • ").replace(/_/g, " ")}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1rem", width: "100%", marginTop: "0.5rem" }}>
                  <button onClick={addBot} style={{ flex: 1, background: "#1e293b", color: "white", border: "1px solid #334155" }}>
                    <Bot size={20} /> Add Bot
                  </button>
                  <button onClick={() => sendAction("start")} style={{ flex: 2, background: "var(--primary)" }} disabled={gameState.players.length < 2}>
                    <Play size={20} /> Start Game Now
                  </button>
                </div>
              </div>
            )}
            
            {gameState.status === "playing" && (
              <div className={`status-banner ${isMyTurn ? (gameState.phase === 'expand' ? 'status-expand' : 'status-playing') : ''}`} style={!isMyTurn ? { background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", margin: 0 } : { margin: 0 }}>
                {isMyTurn ? <Play size={28} /> : <RefreshCcw size={28} className={gameState.status === "playing" ? "animate-spin" : ""} />}
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: "1.2rem" }}>{isMyTurn ? "Your Turn!" : "Waiting for other player..."}</strong>
                  <div style={{ fontSize: "0.95rem", textTransform: "uppercase", marginTop: "0.25rem", letterSpacing: "0.05em", fontFamily: "'Space Mono', monospace" }}>
                    Phase: {gameState.phase.replace(/[0-9]/g, '')}
                  </div>
                </div>
              </div>
            )}

            {gameState.status === "game_over" && (
              <div className="status-banner status-gameover" style={{ margin: 0 }}>
                <AlertCircle size={32} />
                <div>
                  <strong style={{ fontSize: "1.2rem" }}>Game Over!</strong>
                  <div style={{ fontSize: "0.95rem", marginTop: "0.25rem" }}>Check the activity log to see who won.</div>
                </div>
              </div>
            )}
          </div>
          
          <div className={`action-section ${isTabVisible('controls') ? '' : 'mobile-hidden'}`}>
            {isMyTurn && gameState.phase === "expand" && (
              <div className="panel-section" style={{ border: "2px solid var(--primary)", background: "rgba(217, 119, 6, 0.1)" }}>
                <h3 style={{ marginBottom: "0.5rem", color: "var(--primary)", fontSize: "1rem" }}>Expand Territory</h3>

                {gameState.current_company_die === "black" && !gameState.variants.includes("joker_buildings") && (
                   <div style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem", color: "#cbd5e1" }}>Choose Wildcard Company: </label>
                    <select value={wildcardCompany} onChange={e => setWildcardCompany(e.target.value)} style={{ width: "100%", background: "white", color: "#0f172a" }}>
                      {wildcardOptions.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </div>
                )}
                
                {gameState.current_company_die === "black" && gameState.variants.includes("joker_buildings") && gameState.variants.includes("neutral_buildings") && (
                   <div style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem", color: "#cbd5e1" }}>Choose ANY building except gray: </label>
                    <select value={wildcardCompany} onChange={e => setWildcardCompany(e.target.value)} style={{ width: "100%", background: "white", color: "#0f172a" }}>
                      {wildcardOptions.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </div>
                )}
                
                {gameState.current_company_die === "gray" && gameState.variants.includes("neutral_buildings") && (
                   <div style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem", color: "#cbd5e1" }}>Neutral Action: </label>
                    <select value={grayAction} onChange={e => setGrayAction(e.target.value)} style={{ width: "100%", marginBottom: "0.5rem", background: "white", color: "#0f172a" }}>
                      <option value="place">Place Gray Barrier</option>
                      <option value="remove">Remove Gray Barrier</option>
                      <option value="choose">Place any standard Company building</option>
                    </select>
                    {grayAction === "choose" && (
                        <select value={wildcardCompany} onChange={e => setWildcardCompany(e.target.value)} style={{ width: "100%", background: "white", color: "#0f172a" }}>
                          {wildcardOptions.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                        </select>
                    )}
                  </div>
                )}
                
                {gameState.current_company_die === "gray" && !gameState.variants.includes("neutral_buildings") && (
                   <div style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem", color: "#cbd5e1" }}>Choose Wildcard Company: </label>
                    <select value={wildcardCompany} onChange={e => setWildcardCompany(e.target.value)} style={{ width: "100%", background: "white", color: "#0f172a" }}>
                      {wildcardOptions.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </div>
                )}
                
                <div style={{ fontSize: "0.85em", color: "#94a3b8", display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                  <ArrowRightCircle size={16} color="var(--primary)" /> Click a valid cell on the board to build.
                </div>
              </div>
            )}
            
            {isMyTurn && gameState.status === "playing" && (gameState.phase === "trade1" || gameState.phase === "trade2") && me && (
              <div className="panel-section" style={{ padding: "0.75rem 1rem" }}>
                
                <div className="trade-header-row">
                  <div className="title">TRADE DESK</div>
                  <div className="cash-badge">
                    <DollarSign size={14} /> Cash: {me.cash.toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>
                    Buys left: <span style={{color: "#fff"}}>{remainingBuys}</span>
                  </div>
                </div>
                
                <div className="trade-input-row">
                  <select value={tradeCompany} onChange={e => setTradeCompany(e.target.value)} style={{ background: "white", color: "#0f172a" }}>
                    {COMPANIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                  <input 
                    type="number" 
                    min="1" 
                    max={Math.max(1, remainingBuys)} 
                    value={tradeCount} 
                    onChange={e => setTradeCount(Math.min(remainingBuys, Math.max(1, Number(e.target.value))))} 
                    style={{ background: "white", color: "#0f172a" }}
                  />
                  <div className="val-box">
                    ${(gameState.stock_price[tradeCompany] * tradeCount).toLocaleString()}
                  </div>
                </div>

                <div className="trade-controls">
                  <button 
                    className="trade-btn-buy" 
                    onClick={() => sendAction("trade", { trade_type: "buy", company: tradeCompany, count: tradeCount })} 
                    style={{ flex: 1, padding: "0.6rem" }}
                    disabled={remainingBuys === 0 || me.cash < gameState.stock_price[tradeCompany] * tradeCount}
                    title={remainingBuys === 0 ? "You have reached your 5-share purchase limit for this turn." : ""}
                  >
                    <ArrowDownCircle size={16} /> BUY
                  </button>
                  <button 
                    className="trade-btn-sell" 
                    onClick={() => sendAction("trade", { trade_type: "sell", company: tradeCompany, count: tradeCount })} 
                    style={{ flex: 1, padding: "0.6rem" }}
                    disabled={me.stocks[tradeCompany] < tradeCount}
                  >
                    <ArrowUpCircle size={16} /> SELL
                  </button>
                </div>
                
                <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", borderTop: "1px dashed var(--border)", paddingTop: "1rem" }}>
                  {gameState.phase === "trade1" && (
                    <button className="primary-action-btn" onClick={() => sendAction("roll")} style={{ flex: 1, background: "var(--primary)", borderColor: "var(--primary-hover)", color: "white" }}>
                      🎲 Roll
                    </button>
                  )}
                  <button className="primary-action-btn" onClick={() => sendAction("end_turn")} style={{ background: "#334155", flex: 1 }}>
                    End
                  </button>
                </div>
                
              </div>
            )}
          </div>

          <div className={`info-split ${isTabVisible('market') || isTabVisible('players') ? '' : 'mobile-hidden'}`}>
            <div className={`market-col ${isTabVisible('market') ? '' : 'mobile-hidden'} ${collapsedMarket ? 'collapsed' : ''}`}>
              <h3 onClick={() => setCollapsedMarket(!collapsedMarket)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={20} color="var(--primary)" /> Market</span>
                <ChevronDown size={18} style={{ transform: collapsedMarket ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
              </h3>
              <div className="scrollable-content">
                <div className="market-grid">
                  <div className="market-header">Comp</div>
                  <div className="market-header">Price</div>
                  <div className="market-header">Supply</div>
                  
                  {COMPANIES.map(c => (
                    <React.Fragment key={c}>
                      <div><span className={`company-${c} company-badge`} style={{ display: 'inline-block', minWidth: '40px', textAlign: 'center' }}>{c.substring(0,3)}</span></div>
                      <div style={{ fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: "1rem", color: "#fff" }}>${gameState.stock_price[c].toLocaleString()}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <div style={{ fontFamily: "'Space Mono', monospace" }}>{gameState.remaining_buildings[c]} <span style={{fontSize:"0.65rem"}}>BLD</span></div>
                        <div style={{ fontFamily: "'Space Mono', monospace", color: "#64748b" }}>{getRemainingStocks(c)} <span style={{fontSize:"0.65rem"}}>STK</span></div>
                      </div>
                    </React.Fragment>
                  ))}
                  
                  {gameState.variants?.includes("joker_buildings") && (
                     <React.Fragment key="black">
                      <div><span className={`company-black company-badge`} style={{ display: 'inline-block', minWidth: '40px', textAlign: 'center' }}>BLK</span></div>
                      <div style={{ color: "#475569", fontSize: "0.85rem", fontStyle: "italic" }}>WILD</div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <div style={{ fontFamily: "'Space Mono', monospace" }}>{gameState.remaining_buildings["black"]} <span style={{fontSize:"0.65rem"}}>BLD</span></div>
                      </div>
                    </React.Fragment>
                  )}
                  {gameState.variants?.includes("neutral_buildings") && (
                     <React.Fragment key="gray">
                      <div><span className={`company-gray company-badge`} style={{ display: 'inline-block', minWidth: '40px', textAlign: 'center' }}>GRY</span></div>
                      <div style={{ color: "#475569", fontSize: "0.85rem", fontStyle: "italic" }}>NEUT</div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <div style={{ fontFamily: "'Space Mono', monospace" }}>{gameState.remaining_buildings["gray"]} <span style={{fontSize:"0.65rem"}}>BLD</span></div>
                      </div>
                    </React.Fragment>
                  )}
                </div>
              </div>
            </div>

            <div className={`players-col ${isTabVisible('players') ? '' : 'mobile-hidden'} ${collapsedPlayers ? 'collapsed' : ''}`}>
              <h3 onClick={() => setCollapsedPlayers(!collapsedPlayers)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={20} color="var(--primary)" /> Players</span>
                <ChevronDown size={18} style={{ transform: collapsedPlayers ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
              </h3>
              <div className="scrollable-content">
                {gameState.players.map((p: any) => (
                  <div key={p.id} className={`player-card ${p.id === gameState.current_player ? "active-turn" : ""} ${lossAnimations[p.id] ? "loss-animation" : ""}`}>
                    <div className="player-header" style={{ marginBottom: "0.25rem" }}>
                      <div className="player-name" style={{ display: "flex", alignItems: "center", fontSize: "1rem" }}>
                        {p.name.substring(0, 10)}
                        {p.is_bot && <span className="bot-tag"><Bot size={12}/></span>}
                      </div>
                    </div>
                    <div className="cash-badge" style={{ marginBottom: "0.5rem", display: "inline-flex" }}>
                      <DollarSign size={14} /> {p.cash.toLocaleString()}
                    </div>
                    {p.bankrupt && <div style={{ color: "#ef4444", fontWeight: 800, fontSize: "0.85rem", marginBottom: "0.5rem", letterSpacing: "0.1em" }}>BANKRUPT</div>}
                    
                    <div className="portfolio">
                      {COMPANIES.map(c => (
                        <div key={c} className={`portfolio-item ${p.stocks[c] > 0 ? 'company-'+c : ''}`} style={p.stocks[c] === 0 ? { background: '#1e293b', color: '#475569' } : {}}>
                          {gameState.variants?.includes("open_hands") || p.id === playerId || gameState.status === "game_over" ? p.stocks[c] : "?"}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`logs-section ${isTabVisible('logs') ? '' : 'mobile-hidden'} ${collapsedLogs ? 'collapsed' : ''}`}>
            <h3 onClick={() => setCollapsedLogs(!collapsedLogs)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Activity Log</span>
              <ChevronDown size={18} style={{ transform: collapsedLogs ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
            </h3>
            <div className="scrollable-content logs">
              {gameState.logs.map((log: string, i: number) => (
                <div key={i} className="log-entry">&gt; {log}</div>
              ))}
              {gameState.logs.length === 0 && <div style={{ color: "#475569", fontStyle: "italic" }}>Awaiting corporate action...</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
