import { useState, useRef, useEffect, useReducer } from "react";

// ─── State Management ───────────────────────────────────────────────────────

const MOCK_FLIGHTS = [
  { id: "f1", from: "DTW", to: "LIS", depTime: "5:56pm", arrTime: "8:00am", price: 945, duration: "7h 04m", airline: "United", stops: "Nonstop" },
  { id: "f2", from: "DTW", to: "LIS", depTime: "4:29pm", arrTime: "8:55am", price: 1010, duration: "8h 26m", airline: "TAP Portugal", stops: "Nonstop" },
  { id: "f3", from: "DTW", to: "LIS", depTime: "2:31pm", arrTime: "8:00am", price: 830, duration: "9h 29m", airline: "Iberia", stops: "1 stop" },
  { id: "f4", from: "DTW", to: "LIS", depTime: "9:30pm", arrTime: "2:35am", price: 915, duration: "8h 05m", airline: "Delta", stops: "Nonstop" },
];

const MOCK_HOTELS = [
  { id: "h1", name: "Hilton Lisbon", price: 200, rating: 4.5, lat: 38.725, lng: -9.15, img: "🏨" },
  { id: "h2", name: "Marriott Hotel", price: 160, rating: 4.3, lat: 38.715, lng: -9.14, img: "🏨", selected: true },
  { id: "h3", name: "Airbnb Condo", price: 100, rating: 4.7, lat: 38.71, lng: -9.135, img: "🏠" },
  { id: "h4", name: "Red Hill Inn", price: 150, rating: 4.1, lat: 38.72, lng: -9.16, img: "🏡" },
];

const MOCK_RESTAURANTS = [
  { id: "r1", name: "Belcanto", price: "€50+", rating: 5, lat: 38.71, lng: -9.14, cuisine: "Fine Dining" },
  { id: "r2", name: "Augusto Lisboa", price: "€15+", rating: 5, lat: 38.713, lng: -9.137, cuisine: "Seafood" },
  { id: "r3", name: "Luca's Rooftop", price: "€30+", rating: 3, lat: 38.718, lng: -9.145, cuisine: "Modern European" },
  { id: "r4", name: "Artes Bakery", price: "€10+", rating: 5, lat: 38.722, lng: -9.155, cuisine: "Bakery & Café" },
];

const MOCK_ATTRACTIONS = [
  { id: "a1", name: "Belém Tower", price: 10, rating: 4.8, lat: 38.6916, lng: -9.216, type: "Historic" },
  { id: "a2", name: "Jerónimos Monastery", price: 12, rating: 4.9, lat: 38.698, lng: -9.207, type: "Historic" },
  { id: "a3", name: "Alfama District", price: 0, rating: 4.6, lat: 38.712, lng: -9.13, type: "Neighborhood" },
  { id: "a4", name: "Time Out Market", price: 0, rating: 4.4, lat: 38.707, lng: -9.146, type: "Food Hall" },
];

const CHAT_SCRIPT = [
  { role: "assistant", text: "Hi there! I'm TripAI, your personal travel designer. I'm here to help you craft the perfect itinerary by getting to know your style.\n\nTo get us started, where are you dreaming of going, and how long do you plan to stay?" },
];

function tripReducer(state, action) {
  switch (action.type) {
    case "ADD_ITEM": {
      const exists = state.items.find(i => i.refId === action.payload.refId);
      if (exists) return state;
      const newItems = [...state.items, action.payload];
      return { ...state, items: newItems, spent: newItems.reduce((s, i) => s + (i.price || 0), 0) };
    }
    case "REMOVE_ITEM": {
      const newItems = state.items.filter(i => i.refId !== action.payload);
      return { ...state, items: newItems, spent: newItems.reduce((s, i) => s + (i.price || 0), 0) };
    }
    case "TOGGLE_BOOK": {
      const newItems = state.items.map(i =>
        i.refId === action.payload ? { ...i, status: i.status === "booked" ? "bookmarked" : "booked" } : i
      );
      return { ...state, items: newItems };
    }
    case "SET_BUDGET":
      return { ...state, budget: action.payload };
    default:
      return state;
  }
}

// ─── Icons (inline SVG) ─────────────────────────────────────────────────────

const Icon = ({ name, size = 18, color = "currentColor" }) => {
  const icons = {
    chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    map: <><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></>,
    plane: <><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1L11 12l-2 3H6l-2 1 3 2 2 3 1-2v-3l3-2 3.7 7.3c.3.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z"/></>,
    hotel: <><path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"/><path d="M1 21h22"/><path d="M9 7h1"/><path d="M9 11h1"/><path d="M14 7h1"/><path d="M14 11h1"/><path d="M9 15h6v6H9z"/></>,
    utensils: <><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></>,
    dollar: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    check: <><polyline points="20 6 9 17 4 12"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    chevLeft: <><polyline points="15 18 9 12 15 6"/></>,
    chevRight: <><polyline points="9 18 15 12 9 6"/></>,
    pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    bookmark: <><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></>,
    star: <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    compass: <><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>,
    menu: <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ─── Shared Star Rating ─────────────────────────────────────────────────────

const Stars = ({ count, max = 5 }) => (
  <span style={{ display: "inline-flex", gap: 1 }}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} style={{ color: i < count ? "#f59e0b" : "#d1d5db", fontSize: 12 }}>★</span>
    ))}
  </span>
);

// ─── Chat View ──────────────────────────────────────────────────────────────

function ChatView({ state, dispatch }) {
  const [messages, setMessages] = useState([...CHAT_SCRIPT]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef(null);
  const chatStep = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const botResponses = [
    "Perfect choice! To get the flight engines humming and find you the best wings — where are we taking off from?",
    "A long haul over the Atlantic! ✈️ I'll make sure to look for routes with the best legroom for that journey.\n\nNext up: Let's talk 'Goldilocks' pricing. To make sure I'm picking the right 'home away from home,' what's our budget vibe? Are we thinking **Budget-Friendly** (backpacking style), **Mid-Range** (comfort & character), or **Full-on Splurge** (luxury treats)?",
    "Got it chief 😄 I've generated restaurants for you featuring **medium budget, country-style** over **various regions** close to popular sceneries. Access the options through the map 📍 icon at the bottom of the left tab for a bunch of Portuguese delights!\n\nI've also loaded up some flights from DTW → LIS for you. Check the ✈️ Flights tab to compare options!",
  ];

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const responseText = botResponses[chatStep.current] || "I've noted that! Let me update your itinerary. You can check the other tabs to see what I've found for you. 🗺️";
      chatStep.current++;
      setMessages(prev => [...prev, { role: "assistant", text: responseText }]);
      setTyping(false);
    }, 1200);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
            {m.role === "assistant" && (
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #0ea5e9, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: 8, marginTop: 2, color: "#fff", fontSize: 13, fontWeight: 700 }}>T</div>
            )}
            <div style={{
              maxWidth: "78%", padding: "10px 14px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: m.role === "user" ? "linear-gradient(135deg, #2563eb, #1d4ed8)" : "#f1f5f9",
              color: m.role === "user" ? "#fff" : "#1e293b", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>
              {m.text.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                part.startsWith("**") && part.endsWith("**")
                  ? <strong key={j}>{part.slice(2, -2)}</strong>
                  : <span key={j}>{part}</span>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #0ea5e9, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>T</div>
            <div style={{ padding: "10px 18px", background: "#f1f5f9", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 4 }}>
              {[0, 1, 2].map(k => <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", animation: `pulse 1.2s ease-in-out ${k * 0.2}s infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Talk to TripAI..."
            style={{ flex: 1, padding: "10px 14px", border: "1.5px solid #cbd5e1", borderRadius: 12, fontSize: 13.5, outline: "none", background: "#f8fafc", transition: "border-color 0.2s" }}
            onFocus={e => e.target.style.borderColor = "#2563eb"}
            onBlur={e => e.target.style.borderColor = "#cbd5e1"}
          />
          <button onClick={handleSend} style={{ padding: "10px 14px", background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Icon name="send" size={16} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Flights View ───────────────────────────────────────────────────────────

function FlightsView({ state, dispatch }) {
  const [selected, setSelected] = useState(null);

  const isAdded = (id) => state.items.some(i => i.refId === id);

  const toggleFlight = (flight) => {
    if (isAdded(flight.id)) {
      dispatch({ type: "REMOVE_ITEM", payload: flight.id });
    } else {
      dispatch({ type: "ADD_ITEM", payload: { refId: flight.id, category: "flight", name: `${flight.from} → ${flight.to} (${flight.airline})`, price: flight.price, status: "bookmarked" } });
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", background: "#f8fafc" }}>
      <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>Flights</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>DTW → LIS · Round trip results</p>

        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {["Cheapest", "Fastest", "Best value"].map((label, i) => (
            <button key={i} style={{ padding: "6px 14px", borderRadius: 20, border: i === 0 ? "2px solid #2563eb" : "1.5px solid #cbd5e1", background: i === 0 ? "#eff6ff" : "#fff", color: i === 0 ? "#2563eb" : "#475569", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {MOCK_FLIGHTS.map(f => {
            const added = isAdded(f.id);
            const isSel = selected === f.id;
            return (
              <div key={f.id} onClick={() => setSelected(f.id)} style={{
                background: "#fff", borderRadius: 14, border: isSel ? "2px solid #2563eb" : "1.5px solid #e2e8f0", padding: "16px 18px",
                cursor: "pointer", transition: "all 0.2s", boxShadow: isSel ? "0 4px 20px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.04)"
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✈️</div>
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 15 }}>{f.from} → {f.to}</div>
                      <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>{f.depTime} — {f.arrTime} · {f.duration} · {f.stops}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>{f.airline}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>${f.price}</span>
                    <div onClick={e => { e.stopPropagation(); toggleFlight(f); }} style={{
                      width: 32, height: 32, borderRadius: "50%", border: added ? "none" : "2px solid #cbd5e1",
                      background: added ? "#22c55e" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s"
                    }}>
                      {added ? <Icon name="check" size={16} color="#fff" /> : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (() => {
        const f = MOCK_FLIGHTS.find(fl => fl.id === selected);
        const added = isAdded(f.id);
        return (
          <div style={{ width: 300, background: "#fff", borderLeft: "1px solid #e2e8f0", padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>Flight Details</h3>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><Icon name="x" size={18} /></button>
            </div>
            {[["Route", `${f.from} → ${f.to}`], ["Departure", f.depTime], ["Arrival", f.arrTime], ["Duration", f.duration], ["Airline", f.airline], ["Stops", f.stops]].map(([label, val]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", marginTop: 2 }}>{val}</div>
              </div>
            ))}
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "20px 0 16px" }}>${f.price}</div>
            <button onClick={() => toggleFlight(f)} style={{
              width: "100%", padding: "12px 0", borderRadius: 12, border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "all 0.2s",
              background: added ? "#fee2e2" : "linear-gradient(135deg, #2563eb, #1d4ed8)", color: added ? "#dc2626" : "#fff"
            }}>
              {added ? "Remove from Itinerary" : "Add to Itinerary"}
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Map View (Lodging / Restaurants / Attractions) ─────────────────────────

function MapView({ state, dispatch }) {
  const [subTab, setSubTab] = useState("lodging");
  const [hoveredPin, setHoveredPin] = useState(null);

  const data = subTab === "lodging" ? MOCK_HOTELS : subTab === "restaurants" ? MOCK_RESTAURANTS : MOCK_ATTRACTIONS;
  const tabConfig = {
    lodging: { icon: "hotel", label: "Lodging", color: "#8b5cf6" },
    restaurants: { icon: "utensils", label: "Restaurants", color: "#f97316" },
    attractions: { icon: "compass", label: "Attractions", color: "#0ea5e9" },
  };

  const isAdded = (id) => state.items.some(i => i.refId === id);

  const toggleItem = (item) => {
    if (isAdded(item.id)) {
      dispatch({ type: "REMOVE_ITEM", payload: item.id });
    } else {
      dispatch({
        type: "ADD_ITEM", payload: {
          refId: item.id, category: subTab === "lodging" ? "hotel" : subTab === "restaurants" ? "dining" : "activity",
          name: item.name, price: typeof item.price === "number" ? item.price : parseInt(item.price?.replace(/[^0-9]/g, "")) || 0, status: "bookmarked"
        }
      });
    }
  };

  // Simple projected map coordinates
  const mapBounds = { minLat: 38.685, maxLat: 38.735, minLng: -9.225, maxLng: -9.115 };
  const project = (lat, lng) => ({
    x: ((lng - mapBounds.minLng) / (mapBounds.maxLng - mapBounds.minLng)) * 100,
    y: ((mapBounds.maxLat - lat) / (mapBounds.maxLat - mapBounds.minLat)) * 100,
  });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* List Panel */}
      <div style={{ width: 290, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 16px 12px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>
            {subTab === "lodging" ? "Choose your lodging:" : subTab === "restaurants" ? "Reserve a restaurant:" : "Explore attractions:"}
          </h3>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(tabConfig).map(([key, cfg]) => (
              <button key={key} onClick={() => setSubTab(key)} style={{
                flex: 1, padding: "7px 0", borderRadius: 8, border: subTab === key ? `2px solid ${cfg.color}` : "1.5px solid #e2e8f0",
                background: subTab === key ? `${cfg.color}11` : "#fff", fontSize: 11, fontWeight: 600,
                color: subTab === key ? cfg.color : "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4
              }}>
                <Icon name={cfg.icon} size={13} color={subTab === key ? cfg.color : "#94a3b8"} /> {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {data.map(item => {
            const added = isAdded(item.id);
            return (
              <div key={item.id} onMouseEnter={() => setHoveredPin(item.id)} onMouseLeave={() => setHoveredPin(null)}
                style={{ padding: "12px 14px", borderRadius: 12, border: added ? `2px solid ${tabConfig[subTab].color}` : "1.5px solid #e2e8f0", marginBottom: 8, background: added ? `${tabConfig[subTab].color}08` : "#fff", transition: "all 0.15s", cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{item.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <Stars count={item.rating} />
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        {typeof item.price === "number" ? `$${item.price}/night` : item.price}
                      </span>
                    </div>
                    {item.cuisine && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.cuisine}</div>}
                    {item.type && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.type}</div>}
                  </div>
                  <div onClick={e => { e.stopPropagation(); toggleItem(item); }} style={{
                    width: 28, height: 28, borderRadius: "50%", border: added ? "none" : "2px solid #cbd5e1",
                    background: added ? "#22c55e" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s", flexShrink: 0
                  }}>
                    {added && <Icon name="check" size={14} color="#fff" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Map Area */}
      <div style={{ flex: 1, position: "relative", background: "linear-gradient(135deg, #dbeafe 0%, #e0f2fe 50%, #d1fae5 100%)", overflow: "hidden" }}>
        {/* Water effect */}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "35%", height: "100%", background: "linear-gradient(to right, #93c5fd55, transparent)", pointerEvents: "none" }} />

        {/* Grid lines for map feel */}
        {[20, 40, 60, 80].map(p => (
          <div key={`h${p}`} style={{ position: "absolute", top: `${p}%`, left: 0, right: 0, height: 1, background: "#94a3b822", pointerEvents: "none" }} />
        ))}
        {[20, 40, 60, 80].map(p => (
          <div key={`v${p}`} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "#94a3b822", pointerEvents: "none" }} />
        ))}

        {/* Street-like paths */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <path d="M 10% 20% Q 30% 35%, 55% 30% T 90% 45%" stroke="#cbd5e1" strokeWidth="3" fill="none" strokeDasharray="8,4" />
          <path d="M 25% 10% Q 40% 50%, 60% 60% T 85% 90%" stroke="#cbd5e1" strokeWidth="2.5" fill="none" strokeDasharray="6,4" />
          <path d="M 5% 65% Q 35% 55%, 70% 70% T 95% 60%" stroke="#94a3b844" strokeWidth="2" fill="none" />
        </svg>

        {/* Pins */}
        {data.map(item => {
          const pos = project(item.lat, item.lng);
          const added = isAdded(item.id);
          const hovered = hoveredPin === item.id;
          const pinColor = added ? "#dc2626" : tabConfig[subTab].color;
          return (
            <div key={item.id}
              onMouseEnter={() => setHoveredPin(item.id)}
              onMouseLeave={() => setHoveredPin(null)}
              onClick={() => toggleItem(item)}
              style={{
                position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: `translate(-50%, -100%) scale(${hovered ? 1.25 : 1})`,
                cursor: "pointer", transition: "transform 0.2s", zIndex: hovered ? 10 : 1, filter: hovered ? "drop-shadow(0 4px 8px rgba(0,0,0,0.25))" : "none"
              }}>
              <svg width="28" height="36" viewBox="0 0 28 36">
                <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill={pinColor} />
                <circle cx="14" cy="13" r="5.5" fill="#fff" />
              </svg>
              {hovered && (
                <div style={{
                  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 4,
                  background: "#0f172a", color: "#fff", padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", pointerEvents: "none"
                }}>
                  {item.name} · {typeof item.price === "number" ? `$${item.price}` : item.price}
                </div>
              )}
            </div>
          );
        })}

        {/* Map label */}
        <div style={{ position: "absolute", bottom: 12, right: 14, background: "#0f172acc", color: "#fff", padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, backdropFilter: "blur(4px)" }}>
          📍 Lisbon, Portugal
        </div>
      </div>
    </div>
  );
}

// ─── Budget Sidebar ─────────────────────────────────────────────────────────

function BudgetPanel({ state, dispatch }) {
  const { budget, spent, items } = state;
  const remaining = budget - spent;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const barColor = pct <= 60 ? "#22c55e" : pct <= 85 ? "#f59e0b" : "#ef4444";

  const breakdown = { flights: 0, hotels: 0, dining: 0, activities: 0 };
  items.forEach(i => {
    if (i.category === "flight") breakdown.flights += i.price;
    else if (i.category === "hotel") breakdown.hotels += i.price;
    else if (i.category === "dining") breakdown.dining += i.price;
    else breakdown.activities += i.price;
  });

  return (
    <div style={{ padding: "20px 18px", fontSize: 13.5 }}>
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Target Budget</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>$</span>
          <input type="number" value={budget} onChange={e => dispatch({ type: "SET_BUDGET", payload: Number(e.target.value) || 0 })}
            style={{ flex: 1, padding: "8px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 16, fontWeight: 700, outline: "none", color: "#0f172a" }} />
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Spent</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: remaining >= 0 ? "#22c55e" : "#ef4444" }}>${spent} / ${budget}</span>
        </div>
        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 4, transition: "width 0.4s ease" }} />
        </div>
        <div style={{ fontSize: 11.5, color: remaining >= 0 ? "#22c55e" : "#ef4444", marginTop: 4, fontWeight: 600 }}>
          {remaining >= 0 ? `$${remaining} remaining` : `$${Math.abs(remaining)} over budget`}
        </div>
      </div>

      <div>
        <h4 style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, margin: "0 0 10px" }}>Breakdown</h4>
        {Object.entries(breakdown).map(([cat, amt]) => (
          <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ color: "#475569", textTransform: "capitalize" }}>{cat}</span>
            <span style={{ fontWeight: 700, color: "#0f172a" }}>${amt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Itinerary Bottom Panel ─────────────────────────────────────────────────

function ItineraryPanel({ state, dispatch }) {
  const [tab, setTab] = useState("all");
  const { items } = state;
  const filtered = tab === "all" ? items : items.filter(i => i.status === tab);

  const catEmoji = { flight: "✈️", hotel: "🏨", dining: "🍴", activity: "🎯" };

  return (
    <div style={{ background: "#fff", borderTop: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #f1f5f9", padding: "0 20px" }}>
        {[
          { key: "all", label: `All (${items.length})` },
          { key: "booked", label: `Booked (${items.filter(i => i.status === "booked").length})`, color: "#22c55e" },
          { key: "bookmarked", label: `Saved (${items.filter(i => i.status === "bookmarked").length})`, color: "#f59e0b" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 16px", fontSize: 12, fontWeight: 600, border: "none", background: "none", cursor: "pointer",
            color: tab === t.key ? (t.color || "#2563eb") : "#94a3b8",
            borderBottom: tab === t.key ? `2.5px solid ${t.color || "#2563eb"}` : "2.5px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxHeight: 140, overflowY: "auto", padding: "10px 20px" }}>
        {filtered.length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "16px 0" }}>No items yet — start browsing flights, hotels, or restaurants!</p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {filtered.map(item => (
              <div key={item.refId} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10,
                border: `1.5px solid ${item.status === "booked" ? "#bbf7d0" : "#fef08a"}`,
                background: item.status === "booked" ? "#f0fdf4" : "#fefce8", fontSize: 12.5, minWidth: 160
              }}>
                <span>{catEmoji[item.category] || "📌"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>${item.price}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {item.status === "bookmarked" && (
                    <button onClick={() => dispatch({ type: "TOGGLE_BOOK", payload: item.refId })} title="Confirm booking" style={{
                      width: 24, height: 24, borderRadius: 6, border: "none", background: "#22c55e", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                    }}><Icon name="check" size={12} color="#fff" /></button>
                  )}
                  <button onClick={() => dispatch({ type: "REMOVE_ITEM", payload: item.refId })} title="Remove" style={{
                    width: 24, height: 24, borderRadius: 6, border: "none", background: "#fee2e2", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                  }}><Icon name="x" size={12} color="#ef4444" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────

export default function TripAI() {
  const [state, dispatch] = useReducer(tripReducer, { items: [], budget: 5000, spent: 0 });
  const [view, setView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [budgetOpen, setBudgetOpen] = useState(true);

  const navItems = [
    { key: "chat", icon: "chat", label: "Chat" },
    { key: "flights", icon: "plane", label: "Flights" },
    { key: "map", icon: "map", label: "Map" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", color: "#1e293b", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;0,9..40,800;1,9..40,400&display=swap');
        * { box-sizing: border-box; margin: 0; }
        @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; }
        input[type=number] { -moz-appearance: textfield; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      `}</style>

      {/* Left Nav Rail */}
      <nav style={{ width: 62, background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, gap: 4, flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, marginBottom: 20 }}>T</div>
        {navItems.map(n => (
          <button key={n.key} onClick={() => setView(n.key)} title={n.label} style={{
            width: 44, height: 44, borderRadius: 12, border: "none", background: view === n.key ? "#ffffff15" : "transparent",
            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, transition: "all 0.15s"
          }}>
            <Icon name={n.icon} size={18} color={view === n.key ? "#fff" : "#94a3b8"} />
            <span style={{ fontSize: 9, color: view === n.key ? "#fff" : "#64748b", fontWeight: 600 }}>{n.label}</span>
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <button onClick={() => setBudgetOpen(!budgetOpen)} title="Budget" style={{
          width: 44, height: 44, borderRadius: 12, border: "none", background: budgetOpen ? "#ffffff15" : "transparent",
          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, marginBottom: 16
        }}>
          <Icon name="dollar" size={18} color={budgetOpen ? "#22c55e" : "#94a3b8"} />
          <span style={{ fontSize: 9, color: budgetOpen ? "#22c55e" : "#64748b", fontWeight: 600 }}>Budget</span>
        </button>
      </nav>

      {/* Sidebar (Chat - collapsible) */}
      {view === "chat" && sidebarOpen && (
        <div style={{ width: 340, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>TripAI</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Your personal travel designer</div>
            </div>
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><Icon name="chevLeft" size={18} /></button>
          </div>

          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: 8, fontSize: 12, color: "#64748b" }}>
              <span style={{ fontWeight: 600 }}>Trips</span>
              <div style={{ marginTop: 4, padding: "6px 8px", background: "#eff6ff", borderRadius: 6, fontSize: 12, color: "#2563eb", fontWeight: 600 }}>A casual short-trip to Portugal</div>
            </div>
          </div>

          <div style={{ flex: 1, overflow: "hidden" }}>
            <ChatView state={state} dispatch={dispatch} />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#f8fafc" }}>
        {/* Top Bar */}
        <header style={{ height: 52, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 20px", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view === "chat" && !sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><Icon name="chevRight" size={18} /></button>
            )}
            <h1 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {view === "chat" ? "Chat with TripAI" : view === "flights" ? "Find Flights" : "Explore Map"}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {navItems.filter(n => n.key !== "chat").map(n => (
              <button key={n.key} onClick={() => setView(n.key)} style={{
                padding: "6px 14px", borderRadius: 8, border: view === n.key ? "2px solid #2563eb" : "1.5px solid #e2e8f0",
                background: view === n.key ? "#eff6ff" : "#fff", fontSize: 12, fontWeight: 600,
                color: view === n.key ? "#2563eb" : "#64748b", cursor: "pointer", display: "flex", alignItems: "center", gap: 5
              }}>
                <Icon name={n.icon} size={14} color={view === n.key ? "#2563eb" : "#94a3b8"} /> {n.label}
              </button>
            ))}
          </div>
        </header>

        {/* Content Area */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {view === "chat" && !sidebarOpen && <ChatView state={state} dispatch={dispatch} />}
          {view === "chat" && sidebarOpen && (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", flexDirection: "column", gap: 8 }}>
              <Icon name="chat" size={48} color="#e2e8f0" />
              <p style={{ fontSize: 15, fontWeight: 600 }}>Chat is in the sidebar</p>
              <p style={{ fontSize: 12 }}>Switch to Flights or Map to explore options</p>
            </div>
          )}
          {view === "flights" && <FlightsView state={state} dispatch={dispatch} />}
          {view === "map" && <MapView state={state} dispatch={dispatch} />}
        </div>

        {/* Itinerary */}
        <ItineraryPanel state={state} dispatch={dispatch} />
      </div>

      {/* Right Budget Panel */}
      {budgetOpen && (
        <div style={{ width: 260, background: "#fff", borderLeft: "1px solid #e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>Budget</span>
            <button onClick={() => setBudgetOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><Icon name="x" size={16} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <BudgetPanel state={state} dispatch={dispatch} />
          </div>
        </div>
      )}
    </div>
  );
}
