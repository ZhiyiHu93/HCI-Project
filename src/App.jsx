import { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Gemini Setup ─────────────────────────────────────────────────────────────

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;
let genAI = null;
try { if (GEMINI_KEY) genAI = new GoogleGenerativeAI(GEMINI_KEY); } catch (_) {}

const SYSTEM_PROMPT = `You are TripAI, a warm, knowledgeable, and enthusiastic AI travel planning assistant inside a trip planning app.

Your mission: Help users plan amazing trips through natural, engaging conversation. Ask about destination, travel dates, budget, group size, interests, and travel style.

Response style:
- Be friendly, warm, and genuinely excited about travel
- Keep responses concise (1-2 short paragraphs)
- Use **bold** for key details like place names and prices
- Use emojis sparingly for warmth

STRUCTURED DATA — When you have enough information, append data blocks at the VERY END of your response:

For flights — use real IATA codes; include departDate/returnDate (YYYY-MM-DD) if the user mentioned travel dates:
Schema: FLIGHT_DATA:{"flights":[{"id":"f1","from":"ORIGIN","to":"DEST","airline":"AIRLINE_NAME","depTime":"H:MMpm","arrTime":"H:MMam+1","duration":"Xh Ym","stops":"Nonstop or X stop","price":NNN,"departDate":"YYYY-MM-DD","returnDate":"YYYY-MM-DD"}]}

For hotels/restaurants/attractions — ALWAYS include accurate lat/lng GPS coordinates so they appear as pins on a real map:
Schema: DESTINATION_DATA:{"hotels":[{"id":"h1","name":"HOTEL_NAME","price":NNN,"rating":N.N,"location":"Neighborhood, City","description":"one line","lat":NN.NNNN,"lng":NN.NNNN}],"restaurants":[{"id":"r1","name":"REST_NAME","price":"€XX+","rating":N.N,"cuisine":"TYPE","location":"Neighborhood, City","lat":NN.NNNN,"lng":NN.NNNN}],"attractions":[{"id":"a1","name":"ATTRACTION","price":NNN,"rating":N.N,"type":"TYPE","location":"Neighborhood, City","lat":NN.NNNN,"lng":NN.NNNN}]}

Rules:
- Only include data blocks when you have specific, relevant data based on the conversation
- Generate 3-5 items per category using REAL place names for the user's destination
- lat/lng must be accurate real-world GPS coordinates for each specific place — the map depends on this
- Prices must be realistic for the destination and budget the user discussed
- JSON must be valid and on a single line
- Put data blocks at the very end of your message, after all conversational text
- Use correct IATA airport codes`;

// ─── JSON Parsing ──────────────────────────────────────────────────────────────

function extractJsonBlock(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  let start = idx + marker.length;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (text[start] !== "{") return null;
  let depth = 0, end = start;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  try { return { data: JSON.parse(text.slice(start, end)), raw: text.slice(idx, end) }; }
  catch { return null; }
}

function parseAIResponse(text) {
  let display = text;
  let flights = null;
  let destinations = null;

  const fd = extractJsonBlock(text, "FLIGHT_DATA:");
  if (fd?.data?.flights) {
    flights = fd.data.flights;
    display = display.replace(fd.raw, "").trim();
  }
  const dd = extractJsonBlock(display, "DESTINATION_DATA:");
  if (dd?.data) {
    destinations = dd.data;
    display = display.replace(dd.raw, "").trim();
  }
  return { text: display, flights, destinations };
}

// ─── Currency → USD ───────────────────────────────────────────────────────────

const FX = { "$": 1, "€": 1.08, "£": 1.27, "¥": 1/150, "￥": 1/150, "₩": 1/1350, "₹": 1/84, "฿": 1/35, "₫": 1/25000 };

function toUSD(price) {
  if (typeof price === "number") return Math.round(price);
  if (!price) return 0;
  const s = String(price).trim();
  for (const [sym, rate] of Object.entries(FX)) {
    if (s.startsWith(sym)) {
      const num = parseFloat(s.slice(sym.length).replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) return Math.round(num * rate);
    }
  }
  const num = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : Math.round(num);
}

// ─── Booking URLs ──────────────────────────────────────────────────────────────

const flightUrl = (f) => {
  const base = `https://www.kayak.com/flights/${f.from}-${f.to}`;
  if (f.departDate && f.returnDate) return `${base}/${f.departDate}/${f.returnDate}?sort=bestflight_a`;
  if (f.departDate) return `${base}/${f.departDate}?sort=bestflight_a`;
  return `${base}?sort=bestflight_a`;
};
const hotelUrl   = (h) => `https://www.booking.com/searchresults.html?ss=${encodeURIComponent((h.name || "") + " " + (h.location?.split(",").pop()?.trim() || ""))}`;
const restaurantUrl = (r) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.name || "") + " " + (r.location || ""))}`;
const attractionUrl = (a) => `https://www.viator.com/searchResults/all?text=${encodeURIComponent(a.name || "")}`;

// ─── Extraction Prompt & Call ─────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a structured travel data extractor. Given a conversation, output ONLY valid JSON data blocks — no other text, no explanation.

If the conversation has enough info, generate these blocks:

FLIGHT_DATA:{"flights":[{"id":"f1","from":"ORIGIN_IATA","to":"DEST_IATA","airline":"AIRLINE","depTime":"H:MMpm","arrTime":"H:MMam","duration":"Xh Ym","stops":"Nonstop","price":NNN,"departDate":"YYYY-MM-DD","returnDate":"YYYY-MM-DD"}]}

DESTINATION_DATA:{"hotels":[{"id":"h1","name":"NAME","price":NNN,"rating":N.N,"location":"Area, City","description":"brief","lat":NN.NNNN,"lng":NN.NNNN}],"restaurants":[{"id":"r1","name":"NAME","price":NNN,"rating":N.N,"cuisine":"TYPE","location":"Area, City","lat":NN.NNNN,"lng":NN.NNNN}],"attractions":[{"id":"a1","name":"NAME","price":NNN,"rating":N.N,"type":"TYPE","location":"Area, City","lat":NN.NNNN,"lng":NN.NNNN}]}

Rules:
- Output ONLY the data blocks — absolutely no other text
- Generate 3-5 items per category using REAL specific place names
- Use real IATA airport codes and accurate GPS coordinates
- Express ALL prices as plain USD integers (convert from local currency)
- Only output a block if there is a clear travel destination in the conversation
- If no destination is clear, output nothing at all`;

async function extractTravelData(messages) {
  if (!genAI) return { flights: null, destinations: null };
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: EXTRACTION_SYSTEM_PROMPT });
    const convo = messages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
    const result = await model.generateContent(`Extract travel data from this conversation:\n\n${convo}`);
    const text = result.response.text();
    let flights = null, destinations = null;
    const fd = extractJsonBlock(text, "FLIGHT_DATA:");
    if (fd?.data?.flights) flights = fd.data.flights;
    const dd = extractJsonBlock(text, "DESTINATION_DATA:");
    if (dd?.data) destinations = dd.data;
    return { flights, destinations };
  } catch (err) {
    console.error("Extraction error:", err);
    return { flights: null, destinations: null };
  }
}

// ─── Gemini API Call ───────────────────────────────────────────────────────────

async function callGemini(messages, userMessage) {
  if (!genAI) {
    return {
      text: "⚠️ Gemini API key not configured.\n\nTo enable AI responses, create a `.env` file in the project root:\n\n```\nVITE_GEMINI_API_KEY=your_key_here\n```\n\nThen restart the dev server.",
      flights: null, destinations: null,
    };
  }
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: SYSTEM_PROMPT });
  // Build history — skip initial greeting so history starts with user
  const history = messages.slice(1).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  const chat = model.startChat({ history });
  try {
    const result = await chat.sendMessage(userMessage);
    return parseAIResponse(result.response.text());
  } catch (err) {
    console.error("Gemini error:", err);
    return { text: `Sorry, something went wrong: ${err.message || "unknown error"}. Please try again.`, flights: null, destinations: null };
  }
}

// ─── Trip Factory ──────────────────────────────────────────────────────────────

let _nextId = 1;
const INIT_MSG = [
  { role: "assistant", text: "Hi there! I'm TripAI, your personal travel designer. ✈️\n\nI'm here to help you craft an amazing itinerary. To get started — **where are you dreaming of going**, and roughly how long are you thinking of staying?" },
];

function createTrip(name = "New Trip") {
  return {
    id: `trip-${_nextId++}`,
    name,
    messages: INIT_MSG.map(m => ({ ...m })),
    items: [],
    budget: 5000,
    flights: [],
    hotels: [],
    restaurants: [],
    attractions: [],
    startDate: null,
    endDate: null,
  };
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

const ICONS = {
  chat:        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  map:         <><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></>,
  plane:       <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1L11 12l-2 3H6l-2 1 3 2 2 3 1-2v-3l3-2 3.7 7.3c.3.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z"/>,
  hotel:       <><path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"/><path d="M1 21h22"/><path d="M9 7h1"/><path d="M9 11h1"/><path d="M14 7h1"/><path d="M14 11h1"/><path d="M9 15h6v6H9z"/></>,
  utensils:    <><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></>,
  dollar:      <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
  check:       <polyline points="20 6 9 17 4 12"/>,
  x:           <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  send:        <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
  chevLeft:    <polyline points="15 18 9 12 15 6"/>,
  chevRight:   <polyline points="9 18 15 12 9 6"/>,
  pin:         <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
  star:        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
  plus:        <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  compass:     <><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>,
  menu:        <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  question:    <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  calendar:    <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  externalLink:<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>,
  edit:        <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
};

const Icon = ({ name, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name]}
  </svg>
);

const Stars = ({ count, max = 5 }) => (
  <span style={{ display: "inline-flex", gap: 1 }}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} style={{ color: i < Math.round(count) ? "#f59e0b" : "#d1d5db", fontSize: 12 }}>★</span>
    ))}
  </span>
);

// ─── Help Modal ────────────────────────────────────────────────────────────────

function HelpModal({ onClose }) {
  const steps = [
    { icon: "chat",     title: "Chat with TripAI",     body: "Tell TripAI where you want to go, your budget, travel dates, and style. It'll ask questions and generate personalized suggestions for flights, hotels, restaurants, and attractions." },
    { icon: "plane",    title: "Browse Flights",        body: "Once you share your origin and destination, TripAI generates realistic flight options. Click \"+ Save\" to add to your itinerary, or \"Book on Kayak\" to head straight to a booking site." },
    { icon: "map",      title: "Explore the Map",       body: "TripAI suggests hotels, restaurants, and attractions based on your conversation. Browse each category, save what you like, and click \"Book Now\" to proceed to a real booking site." },
    { icon: "calendar", title: "Itinerary View",        body: "See all saved and booked items. Assign dates to build your day-by-day plan — items automatically group by date. Use the checkmark to confirm a booking, or the trash icon to remove it." },
    { icon: "dollar",   title: "Budget Tracker",        body: "Set your total budget in the Budget tab. See a live breakdown by category (flights, hotels, dining, activities) and track how much you have left." },
    { icon: "plus",     title: "Multiple Trips",        body: "Hit \"+ New Trip\" in the sidebar to start planning another destination. Each trip keeps its own chat history, itinerary, and budget completely separate." },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, width: 540, maxHeight: "85vh", overflowY: "auto", padding: "28px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: 0 }}>How to use TripAI</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><Icon name="x" size={20} /></button>
        </div>

        {steps.map(({ icon, title, body }) => (
          <div key={title} style={{ display: "flex", gap: 14, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={icon} size={16} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 3 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>{body}</div>
            </div>
          </div>
        ))}

        <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px 16px", marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>API Setup</div>
          <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
            TripAI uses the Gemini API. Add your key to a <code style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>.env</code> file in the project root:
          </div>
          <code style={{ display: "block", marginTop: 8, background: "#e2e8f0", padding: "8px 12px", borderRadius: 8, fontSize: 12, color: "#1e293b" }}>VITE_GEMINI_API_KEY=your_key_here</code>
        </div>
      </div>
    </div>
  );
}

// ─── Trip Sidebar ──────────────────────────────────────────────────────────────

function TripSidebar({ trips, currentTripId, onSelectTrip, onNewTrip, onRenameTrip, onHelp, onClose }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef(null);

  const startEdit = (e, trip) => {
    e.stopPropagation();
    setEditingId(trip.id);
    setEditValue(trip.name);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) onRenameTrip(editingId, editValue.trim());
    setEditingId(null);
  };

  return (
    <div style={{ width: 240, background: "#0f172a", display: "flex", flexDirection: "column", flexShrink: 0, height: "100%" }}>
      <div style={{ padding: "16px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #2563eb, #0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "#fff" }}>T</div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>TripAI</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
          <Icon name="chevLeft" size={18} color="#475569" />
        </button>
      </div>

      <div style={{ padding: "0 10px 10px" }}>
        <button onClick={onNewTrip} style={{
          width: "100%", padding: "9px 12px", background: "transparent", border: "1.5px dashed #334155",
          borderRadius: 10, color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.color = "#60a5fa"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}>
          <Icon name="plus" size={14} color="currentColor" /> New Trip
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: 0.8, padding: "4px 8px 6px" }}>Your Trips</div>
        {trips.map(trip => {
          const active = trip.id === currentTripId;
          const editing = editingId === trip.id;
          return (
            <div key={trip.id} onClick={() => { if (!editing) onSelectTrip(trip.id); }} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 10,
              background: active ? "#1e40af" : "transparent", marginBottom: 2, cursor: editing ? "default" : "pointer",
              transition: "background 0.15s",
            }}
              onMouseEnter={e => { if (!active && !editing) e.currentTarget.style.background = "#1e293b"; }}
              onMouseLeave={e => { if (!active && !editing) e.currentTarget.style.background = "transparent"; }}>
              <Icon name="plane" size={13} color={active ? "#93c5fd" : "#475569"} style={{ flexShrink: 0 }} />
              {editing ? (
                <input
                  ref={editInputRef}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                  onClick={e => e.stopPropagation()}
                  style={{ flex: 1, background: "#1e293b", border: "1.5px solid #3b82f6", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, padding: "3px 7px", outline: "none", minWidth: 0 }}
                />
              ) : (
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#fff" : "#94a3b8" }}>
                  {trip.name}
                </span>
              )}
              {!editing && (
                <button onClick={e => startEdit(e, trip)} title="Rename" style={{
                  background: "none", border: "none", cursor: "pointer", padding: 2, opacity: 0, transition: "opacity 0.15s",
                  color: active ? "#93c5fd" : "#475569",
                }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "0"}>
                  <Icon name="edit" size={12} color="currentColor" />
                </button>
              )}
              {!editing && trip.items.length > 0 && (
                <span style={{ fontSize: 10, background: active ? "#3b82f6" : "#1e293b", color: active ? "#fff" : "#64748b", padding: "2px 6px", borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>
                  {trip.items.length}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "10px 6px 14px", borderTop: "1px solid #1e293b" }}>
        <button onClick={onHelp} style={{
          width: "100%", padding: "9px 12px", background: "transparent", border: "none",
          borderRadius: 10, color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
          <Icon name="question" size={15} color="currentColor" /> Help & Documentation
        </button>
      </div>
    </div>
  );
}

// ─── Markdown-lite text renderer ───────────────────────────────────────────────

function MsgText({ text }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ─── Chat View ─────────────────────────────────────────────────────────────────

function ChatView({ trip, updateTrip, sidebarOpen, onOpenSidebar, onFlightsReady, onDestinationsReady, rightPanelOpen, onOpenPanel }) {
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [trip.messages, typing]);

  const handleSend = async () => {
    if (!input.trim() || typing) return;
    const userMsg = { role: "user", text: input.trim() };
    const prevMessages = trip.messages;
    updateTrip(trip.id, { messages: [...prevMessages, userMsg] });
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    setTyping(true);

    try {
      const [chatResult, extractResult] = await Promise.all([
        callGemini(prevMessages, userMsg.text),
        extractTravelData([...prevMessages, userMsg]),
      ]);
      const { text } = chatResult;
      const flights      = chatResult.flights      || extractResult.flights;
      const destinations = chatResult.destinations || extractResult.destinations;
      const updates = { messages: [...prevMessages, userMsg, { role: "assistant", text }] };

      if (flights?.length) {
        updates.flights = flights.map(f => ({ ...f, price: toUSD(f.price) }));
        if (trip.name === "New Trip" && flights[0]) {
          updates.name = `${flights[0].from} → ${flights[0].to}`;
        }
        // Auto-populate trip dates from the first flight's depart/return dates
        if (flights[0]?.departDate && !trip.startDate) updates.startDate = flights[0].departDate;
        if (flights[0]?.returnDate && !trip.endDate)   updates.endDate   = flights[0].returnDate;
        onFlightsReady();
      }
      if (destinations) {
        const normPrice = arr => arr?.map(x => ({ ...x, price: toUSD(x.price) }));
        if (destinations.hotels?.length)      updates.hotels      = normPrice(destinations.hotels);
        if (destinations.restaurants?.length) updates.restaurants = normPrice(destinations.restaurants);
        if (destinations.attractions?.length) updates.attractions = normPrice(destinations.attractions);
        onDestinationsReady();
      }
      updateTrip(trip.id, updates);
    } catch {
      updateTrip(trip.id, { messages: [...prevMessages, userMsg, { role: "assistant", text: "Sorry, something went wrong. Please try again." }] });
    } finally {
      setTyping(false);
    }
  };

  const hasResults = trip.flights.length > 0 || trip.hotels.length > 0 || trip.restaurants.length > 0 || trip.attractions.length > 0 || trip.items.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      {/* Top Bar */}
      <div style={{ height: 52, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 16px", gap: 10, flexShrink: 0 }}>
        {!sidebarOpen && (
          <button onClick={onOpenSidebar} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#64748b" }}>
            <Icon name="menu" size={20} color="#64748b" />
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{trip.name}</div>
          {trip.items.length > 0 && (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {trip.items.filter(i => i.status === "booked").length} booked · {trip.items.filter(i => i.status === "bookmarked").length} saved
            </div>
          )}
        </div>
        {hasResults && !rightPanelOpen && (
          <div style={{ display: "flex", gap: 6 }}>
            {trip.flights.length > 0 && (
              <button onClick={() => onOpenPanel("flights")} style={{ padding: "5px 11px", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#2563eb", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="plane" size={12} color="#2563eb" /> Flights ({trip.flights.length})
              </button>
            )}
            {(trip.hotels.length > 0 || trip.restaurants.length > 0) && (
              <button onClick={() => onOpenPanel("map")} style={{ padding: "5px 11px", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#16a34a", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="map" size={12} color="#16a34a" /> Map
              </button>
            )}
            {trip.items.length > 0 && (
              <button onClick={() => onOpenPanel("itinerary")} style={{ padding: "5px 11px", background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#7c3aed", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="calendar" size={12} color="#7c3aed" /> Itinerary
              </button>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 8px" }}>
        {trip.messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 18 }}>
            {m.role === "assistant" && (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #0ea5e9, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: 10, marginTop: 2, color: "#fff", fontSize: 13, fontWeight: 800 }}>T</div>
            )}
            <div style={{
              maxWidth: "68%", padding: "12px 16px",
              borderRadius: m.role === "user" ? "20px 20px 6px 20px" : "4px 20px 20px 20px",
              background: m.role === "user" ? "linear-gradient(135deg, #2563eb, #1d4ed8)" : "#f1f5f9",
              color: m.role === "user" ? "#fff" : "#1e293b",
              fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap",
            }}>
              <MsgText text={m.text} />
            </div>
          </div>
        ))}

        {typing && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #0ea5e9, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>T</div>
            <div style={{ padding: "12px 18px", background: "#f1f5f9", borderRadius: "4px 20px 20px 20px", display: "flex", gap: 5 }}>
              {[0, 1, 2].map(k => <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", animation: `pulse 1.2s ease-in-out ${k * 0.2}s infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 20px 14px", borderTop: "1px solid #e2e8f0" }}>
        {typing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {[0, 1, 2].map(k => <span key={k} style={{ width: 5, height: 5, borderRadius: "50%", background: "#0ea5e9", animation: `pulse 1.2s ease-in-out ${k * 0.2}s infinite` }} />)}
            </div>
            <span style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>TripAI is thinking — looking up flights & places for you…</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            value={input}
            disabled={typing}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
            placeholder={typing ? "Waiting for TripAI…" : "Tell TripAI about your dream trip..."}
            rows={1}
            style={{ flex: 1, padding: "12px 16px", border: "1.5px solid #e2e8f0", borderRadius: 16, fontSize: 14, outline: "none", background: typing ? "#f1f5f9" : "#f8fafc", resize: "none", fontFamily: "inherit", lineHeight: 1.5, transition: "border-color 0.2s, background 0.2s", color: "#1e293b" }}
            onFocus={e => { if (!typing) e.target.style.borderColor = "#2563eb"; }}
            onBlur={e => e.target.style.borderColor = "#e2e8f0"}
          />
          <button onClick={handleSend} disabled={typing || !input.trim()} style={{
            width: 44, height: 44, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", border: "none", borderRadius: 14,
            cursor: typing || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            opacity: typing || !input.trim() ? 0.4 : 1, transition: "opacity 0.2s", flexShrink: 0,
          }}>
            <Icon name="send" size={17} color="#fff" />
          </button>
        </div>
        {!typing && <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 5, textAlign: "center" }}>Enter to send · Shift+Enter for new line</div>}
      </div>
    </div>
  );
}

// ─── Flights Panel ─────────────────────────────────────────────────────────────

function FlightsPanel({ trip, updateTrip }) {
  const { flights, items } = trip;
  const isAdded = id => items.some(i => i.refId === id);

  const toggle = f => {
    if (isAdded(f.id)) {
      updateTrip(trip.id, { items: items.filter(i => i.refId !== f.id) });
    } else {
      updateTrip(trip.id, {
        items: [...items, { refId: f.id, category: "flight", name: `${f.from} → ${f.to} (${f.airline})`, price: f.price || 0, status: "bookmarked" }]
      });
    }
  };

  if (!flights.length) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", gap: 12, padding: 24 }}>
      <Icon name="plane" size={48} color="#e2e8f0" />
      <div style={{ fontWeight: 600, fontSize: 15 }}>No flights yet</div>
      <div style={{ fontSize: 13, textAlign: "center", color: "#94a3b8" }}>Tell TripAI your origin city and destination to get flight suggestions.</div>
    </div>
  );

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>AI-curated flights</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {flights.map(f => {
          const added = isAdded(f.id);
          return (
            <div key={f.id} style={{
              background: "#fff", borderRadius: 14, border: added ? "2px solid #2563eb" : "1.5px solid #e2e8f0",
              padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", transition: "border-color 0.2s"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>{f.from} → {f.to}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{f.airline} · {f.stops}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>{f.depTime} — {f.arrTime} · {f.duration}</div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>${f.price}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => toggle(f)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 10, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  background: added ? "#fee2e2" : "#eff6ff", color: added ? "#dc2626" : "#2563eb"
                }}>
                  {added ? "✓ Saved" : "+ Save"}
                </button>
                <a href={flightUrl(f)} target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, padding: "8px 0", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 12.5, fontWeight: 700,
                  background: "#fff", color: "#0f172a", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 5
                }}>
                  Book on Kayak <Icon name="externalLink" size={12} color="#64748b" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Leaflet Map ───────────────────────────────────────────────────────────────

function DestMap({ hotels, restaurants, attractions, items, onToggle, activeTab }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const PIN_COLORS = { hotels: "#8b5cf6", restaurants: "#f97316", attractions: "#0ea5e9" };

  const makePinSvg = (color, saved) => `
    <svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z"
            fill="${saved ? "#22c55e" : color}" stroke="white" stroke-width="2"/>
      <circle cx="14" cy="13" r="5" fill="white"/>
    </svg>`;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { zoomControl: true, attributionControl: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd" }).addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const allData = [
      ...hotels.map(h => ({ ...h, _cat: "hotels" })),
      ...restaurants.map(r => ({ ...r, _cat: "restaurants" })),
      ...attractions.map(a => ({ ...a, _cat: "attractions" })),
    ].filter(d => d.lat && d.lng);

    if (!allData.length) return;

    const bounds = [];
    allData.forEach(item => {
      const saved = items.some(i => i.refId === item.id);
      const color = PIN_COLORS[item._cat];
      const icon = L.divIcon({
        html: makePinSvg(color, saved),
        className: "",
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -38],
      });
      const priceStr = typeof item.price === "number"
        ? (item.price === 0 ? "Free" : `$${item.price}`)
        : (item.price || "");
      const marker = L.marker([item.lat, item.lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-family:system-ui;min-width:140px">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px">${item.name}</div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">${item.location || ""}</div>
          <div style="font-weight:700;font-size:12px;color:${color}">${priceStr}</div>
        </div>`);
      markersRef.current.push(marker);
      bounds.push([item.lat, item.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }
  }, [hotels, restaurants, attractions, items]);

  // Invalidate size when the panel becomes visible
  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 50);
  }, []);

  return <div ref={containerRef} style={{ height: 240, width: "100%", flexShrink: 0 }} />;
}

// ─── Destinations Panel ────────────────────────────────────────────────────────

function DestinationsPanel({ trip, updateTrip }) {
  const [subTab, setSubTab] = useState("hotels");
  const { hotels, restaurants, attractions, items } = trip;
  const isAdded = id => items.some(i => i.refId === id);

  const tabs = [
    { key: "hotels",      label: "Hotels",      icon: "hotel",    color: "#8b5cf6", data: hotels,      cat: "hotel"    },
    { key: "restaurants", label: "Dining",       icon: "utensils", color: "#f97316", data: restaurants, cat: "dining"   },
    { key: "attractions", label: "Attractions",  icon: "compass",  color: "#0ea5e9", data: attractions, cat: "activity" },
  ];

  const cur = tabs.find(t => t.key === subTab);

  const toggle = (item) => {
    if (isAdded(item.id)) {
      updateTrip(trip.id, { items: items.filter(i => i.refId !== item.id) });
    } else {
      const price = typeof item.price === "number" ? item.price : parseInt(String(item.price).replace(/[^0-9]/g, "")) || 0;
      updateTrip(trip.id, { items: [...items, { refId: item.id, category: cur.cat, name: item.name, price, status: "bookmarked" }] });
    }
  };

  const bookUrl = (item) => {
    if (subTab === "hotels") return hotelUrl(item);
    if (subTab === "restaurants") return restaurantUrl(item);
    return attractionUrl(item);
  };

  const hasAny = hotels.length > 0 || restaurants.length > 0 || attractions.length > 0;
  if (!hasAny) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", gap: 12, padding: 24 }}>
      <Icon name="map" size={48} color="#e2e8f0" />
      <div style={{ fontWeight: 600, fontSize: 15 }}>No places yet</div>
      <div style={{ fontSize: 13, textAlign: "center" }}>Tell TripAI your destination and budget to get recommendations.</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Real Leaflet map */}
      <DestMap
        hotels={hotels}
        restaurants={restaurants}
        attractions={attractions}
        items={items}
        activeTab={subTab}
      />

      {/* Sub-tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "#fff" }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setSubTab(tab.key)} style={{
            flex: 1, padding: "9px 4px", border: "none", background: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 700, color: subTab === tab.key ? tab.color : "#94a3b8",
            borderBottom: subTab === tab.key ? `2.5px solid ${tab.color}` : "2.5px solid transparent",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3
          }}>
            <Icon name={tab.icon} size={13} color={subTab === tab.key ? tab.color : "#94a3b8"} />
            {tab.label}
            {tab.data.length > 0 && <span style={{ fontSize: 9, opacity: 0.7 }}>({tab.data.length})</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
        {cur.data.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: "30px 20px", fontSize: 13 }}>
            No {cur.label.toLowerCase()} yet — keep chatting with TripAI!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cur.data.map(item => {
              const added = isAdded(item.id);
              return (
                <div key={item.id} style={{
                  background: "#fff", borderRadius: 12, border: added ? `2px solid ${cur.color}` : "1.5px solid #e2e8f0",
                  padding: "11px 12px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{item.location || item.cuisine || item.type}</div>
                      {item.description && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, lineHeight: 1.4 }}>{item.description}</div>}
                      {item.cuisine && subTab === "restaurants" && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{item.cuisine}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                        {typeof item.price === "number" ? (item.price === 0 ? "Free" : `$${item.price}`) : item.price}
                        {subTab === "hotels" && typeof item.price === "number" && item.price > 0 && <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>/nt</span>}
                      </div>
                      {item.rating && <Stars count={item.rating} />}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button onClick={() => toggle(item)} style={{
                      flex: 1, padding: "6px 0", borderRadius: 8, border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                      background: added ? "#fee2e2" : `${cur.color}18`, color: added ? "#dc2626" : cur.color
                    }}>
                      {added ? "✓ Saved" : "+ Save"}
                    </button>
                    <a href={bookUrl(item)} target="_blank" rel="noopener noreferrer" style={{
                      flex: 1, padding: "6px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 11.5, fontWeight: 700,
                      background: "#fff", color: "#475569", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 4
                    }}>
                      Book Now <Icon name="externalLink" size={11} color="#94a3b8" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Itinerary View (Calendar + Drag & Drop) ───────────────────────────────────

function ItineraryView({ trip, updateTrip }) {
  const [dragOver, setDragOver] = useState(null); // key of drop zone being hovered
  const { items, startDate, endDate, budget } = trip;

  // Mutations
  const setItemDate = (refId, date) =>
    updateTrip(trip.id, { items: items.map(i => i.refId === refId ? { ...i, date: date || undefined } : i) });
  const toggleBook = (refId) =>
    updateTrip(trip.id, { items: items.map(i => i.refId === refId ? { ...i, status: i.status === "booked" ? "bookmarked" : "booked" } : i) });
  const remove = (refId) =>
    updateTrip(trip.id, { items: items.filter(i => i.refId !== refId) });
  const setTripDates = (s, e) =>
    updateTrip(trip.id, { startDate: s || null, endDate: e || null });

  // Build date range
  const tripDates = (() => {
    if (!startDate || !endDate) return [];
    const dates = [];
    const cur = new Date(startDate + "T12:00:00");
    const last = new Date(endDate + "T12:00:00");
    while (cur <= last && dates.length < 60) { // cap at 60 days
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  })();

  // Group items by date key (date string or "unscheduled")
  const byDate = {};
  items.forEach(i => {
    const key = i.date || "unscheduled";
    (byDate[key] = byDate[key] || []).push(i);
  });

  // Drag handlers
  const onDragStart = (e, refId) => {
    e.dataTransfer.setData("text/plain", refId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e, dateKey) => {
    e.preventDefault();
    const refId = e.dataTransfer.getData("text/plain");
    if (refId) setItemDate(refId, dateKey === "unscheduled" ? "" : dateKey);
    setDragOver(null);
  };
  const onDragOver = (e, key) => { e.preventDefault(); setDragOver(key); };
  const onDragLeave = () => setDragOver(null);

  const spent = items.reduce((s, i) => s + (i.price || 0), 0);
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const barColor = pct <= 60 ? "#22c55e" : pct <= 85 ? "#f59e0b" : "#ef4444";
  const catEmoji = { flight: "✈️", hotel: "🏨", dining: "🍴", activity: "🎯" };

  const ItemCard = ({ item }) => (
    <div
      draggable
      onDragStart={e => onDragStart(e, item.refId)}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "7px 9px", borderRadius: 9,
        border: `1.5px solid ${item.status === "booked" ? "#bbf7d0" : "#fef08a"}`,
        background: item.status === "booked" ? "#f0fdf4" : "#fefce8",
        marginBottom: 5, cursor: "grab", userSelect: "none",
      }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{catEmoji[item.category] || "📌"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
        <div style={{ fontSize: 10, color: "#64748b" }}>
          ${item.price}{item.status === "booked" && <span style={{ color: "#16a34a", fontWeight: 700 }}> · ✓</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {item.status === "bookmarked" && (
          <button onClick={() => toggleBook(item.refId)} title="Mark booked" style={{ width: 20, height: 20, borderRadius: 5, border: "none", background: "#22c55e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={10} color="#fff" />
          </button>
        )}
        {item.status === "booked" && (
          <button onClick={() => toggleBook(item.refId)} title="Unbook" style={{ width: 20, height: 20, borderRadius: 5, border: "none", background: "#fef3c7", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bookmark" size={10} color="#d97706" />
          </button>
        )}
        <button onClick={() => remove(item.refId)} style={{ width: 20, height: 20, borderRadius: 5, border: "none", background: "#fee2e2", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={10} color="#ef4444" />
        </button>
      </div>
    </div>
  );

  // A droppable day column
  const DayZone = ({ dateKey, label, accent }) => {
    const zoneItems = byDate[dateKey] || [];
    const isOver = dragOver === dateKey;
    return (
      <div
        onDrop={e => onDrop(e, dateKey)}
        onDragOver={e => onDragOver(e, dateKey)}
        onDragLeave={onDragLeave}
        style={{
          marginBottom: 8, padding: "8px 10px", borderRadius: 12,
          border: isOver ? `2px dashed ${accent}` : "2px solid #f1f5f9",
          background: isOver ? `${accent}08` : "#fff",
          transition: "border-color 0.15s, background 0.15s",
        }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
        {zoneItems.map(item => <ItemCard key={item.refId} item={item} />)}
        {zoneItems.length === 0 && (
          <div style={{ border: "1.5px dashed #e2e8f0", borderRadius: 7, padding: "8px", textAlign: "center", fontSize: 10, color: "#cbd5e1" }}>
            Drop here
          </div>
        )}
      </div>
    );
  };

  if (items.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", padding: "14px" }}>
      {/* Date picker even when empty, so user can set range */}
      <div style={{ padding: "12px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Trip Dates</div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>From</div>
            <input type="date" value={startDate || ""} onChange={e => setTripDates(e.target.value, endDate)}
              style={{ width: "100%", fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "5px 7px", outline: "none" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>To</div>
            <input type="date" value={endDate || ""} onChange={e => setTripDates(startDate, e.target.value)}
              style={{ width: "100%", fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "5px 7px", outline: "none" }} />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#94a3b8", gap: 10 }}>
        <Icon name="calendar" size={40} color="#e2e8f0" />
        <div style={{ fontWeight: 600, fontSize: 14 }}>No items yet</div>
        <div style={{ fontSize: 12, textAlign: "center" }}>Save flights, hotels, and activities from the Flights and Map panels.</div>
      </div>
    </div>
  );

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "12px 12px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>{items.length}</span> items ·{" "}
          <span style={{ color: "#16a34a", fontWeight: 700 }}>{items.filter(i => i.status === "booked").length} booked</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>${spent}</div>
      </div>

      {/* Budget bar */}
      {budget > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 3 }}>
            <span>Budget</span>
            <span style={{ fontWeight: 700, color: barColor }}>${spent} / ${budget}</span>
          </div>
          <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 2, transition: "width 0.4s" }} />
          </div>
        </div>
      )}

      {/* Trip date range */}
      <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 }}>
          Trip Dates {tripDates.length > 0 && <span style={{ color: "#2563eb" }}>· {tripDates.length} days</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>From</div>
            <input type="date" value={startDate || ""} onChange={e => setTripDates(e.target.value, endDate)}
              style={{ width: "100%", fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "4px 6px", outline: "none", background: "#fff" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>To</div>
            <input type="date" value={endDate || ""} onChange={e => setTripDates(startDate, e.target.value)}
              style={{ width: "100%", fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "4px 6px", outline: "none", background: "#fff" }} />
          </div>
        </div>
        {tripDates.length > 0 && (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>Drag items between days to reschedule</div>
        )}
      </div>

      {/* Unscheduled pool */}
      <DayZone dateKey="unscheduled" label={`Unscheduled · ${(byDate["unscheduled"] || []).length} items`} accent="#94a3b8" />

      {/* Calendar days */}
      {tripDates.length > 0 ? (
        tripDates.map((date, idx) => (
          <DayZone
            key={date}
            dateKey={date}
            label={`Day ${idx + 1} · ${new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}
            accent="#2563eb"
          />
        ))
      ) : (
        <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", padding: "12px 0" }}>
          Set trip dates above to see your day-by-day calendar
        </div>
      )}
    </div>
  );
}

// ─── Budget Panel ──────────────────────────────────────────────────────────────

function BudgetPanel({ trip, updateTrip }) {
  const { budget, items } = trip;
  const spent = items.reduce((s, i) => s + (i.price || 0), 0);
  const remaining = budget - spent;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const barColor = pct <= 60 ? "#22c55e" : pct <= 85 ? "#f59e0b" : "#ef4444";

  const breakdown = { flights: 0, hotels: 0, dining: 0, activities: 0 };
  items.forEach(i => {
    if (i.category === "flight")    breakdown.flights    += i.price || 0;
    else if (i.category === "hotel")   breakdown.hotels  += i.price || 0;
    else if (i.category === "dining")  breakdown.dining  += i.price || 0;
    else                            breakdown.activities += i.price || 0;
  });

  return (
    <div style={{ padding: "16px", overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16 }}>Budget</div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Target</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>$</span>
          <input type="number" value={budget}
            onChange={e => updateTrip(trip.id, { budget: Number(e.target.value) || 0 })}
            style={{ flex: 1, padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 16, fontWeight: 700, outline: "none", color: "#0f172a" }} />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>Spent</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: remaining >= 0 ? "#22c55e" : "#ef4444" }}>${spent} / ${budget}</span>
        </div>
        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 4, transition: "width 0.4s" }} />
        </div>
        <div style={{ fontSize: 11.5, color: remaining >= 0 ? "#22c55e" : "#ef4444", marginTop: 4, fontWeight: 600 }}>
          {remaining >= 0 ? `$${remaining} remaining` : `$${Math.abs(remaining)} over budget`}
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Breakdown</div>
      {Object.entries(breakdown).map(([cat, amt]) => (
        <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
          <span style={{ color: "#475569", textTransform: "capitalize", fontSize: 13 }}>{cat}</span>
          <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>${amt}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function TripAI() {
  const [trips, setTrips] = useState([createTrip("New Trip")]);
  const [currentTripId, setCurrentTripId] = useState(trips[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState(null); // null | "flights" | "map" | "itinerary" | "budget"
  const [helpOpen, setHelpOpen] = useState(false);

  const currentTrip = trips.find(t => t.id === currentTripId) || trips[0];

  const updateTrip = useCallback((id, updates) => {
    setTrips(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const addNewTrip = () => {
    const t = createTrip("New Trip");
    setTrips(prev => [...prev, t]);
    setCurrentTripId(t.id);
    setRightPanel(null);
  };

  const renameTrip = useCallback((id, name) => {
    setTrips(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  }, []);

  const RIGHT_TABS = [
    { key: "flights",   icon: "plane",    label: "Flights",    color: "#2563eb" },
    { key: "map",       icon: "map",      label: "Map",        color: "#16a34a" },
    { key: "itinerary", icon: "calendar", label: "Itinerary",  color: "#7c3aed" },
    { key: "budget",    icon: "dollar",   label: "Budget",     color: "#d97706" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", color: "#1e293b", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;0,9..40,800;1,9..40,400&display=swap');
        html, body, #root { height: 100%; margin: 0; overflow: hidden; }
        * { box-sizing: border-box; margin: 0; }
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)} }
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
        .leaflet-container { font-family: inherit; }
      `}</style>

      {/* ── Left Sidebar ───────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <TripSidebar
          trips={trips}
          currentTripId={currentTripId}
          onSelectTrip={id => { setCurrentTripId(id); }}
          onNewTrip={addNewTrip}
          onRenameTrip={renameTrip}
          onHelp={() => setHelpOpen(true)}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main Chat ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <ChatView
          trip={currentTrip}
          updateTrip={updateTrip}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onFlightsReady={() => setRightPanel("flights")}
          onDestinationsReady={() => { setRightPanel(prev => prev === "map" ? prev : "map"); }}
          rightPanelOpen={!!rightPanel}
          onOpenPanel={setRightPanel}
        />
      </div>

      {/* ── Right Panel ────────────────────────────────────────────────────── */}
      {rightPanel && (
        <div style={{ width: 370, background: "#f8fafc", borderLeft: "1px solid #e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {/* Tab bar */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "stretch", flexShrink: 0 }}>
            {RIGHT_TABS.map(tab => (
              <button key={tab.key} onClick={() => setRightPanel(tab.key)} style={{
                flex: 1, padding: "12px 2px 10px", border: "none", background: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                color: rightPanel === tab.key ? tab.color : "#94a3b8",
                borderBottom: rightPanel === tab.key ? `2.5px solid ${tab.color}` : "2.5px solid transparent",
              }}>
                <Icon name={tab.icon} size={15} color={rightPanel === tab.key ? tab.color : "#94a3b8"} />
                {tab.label}
              </button>
            ))}
            <button onClick={() => setRightPanel(null)} style={{ padding: "12px 10px", border: "none", background: "none", cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center" }}>
              <Icon name="x" size={16} color="#94a3b8" />
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightPanel === "flights"   && <FlightsPanel      trip={currentTrip} updateTrip={updateTrip} />}
            {rightPanel === "map"       && <DestinationsPanel trip={currentTrip} updateTrip={updateTrip} />}
            {rightPanel === "itinerary" && <ItineraryView     trip={currentTrip} updateTrip={updateTrip} />}
            {rightPanel === "budget"    && <BudgetPanel       trip={currentTrip} updateTrip={updateTrip} />}
          </div>
        </div>
      )}

      {/* ── Help Modal ─────────────────────────────────────────────────────── */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
