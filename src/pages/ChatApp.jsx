import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../config/firebase";
import { useAuth } from "../context/AuthContext";
import { askGemini } from "../config/gemini";
import {
  collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, doc, setDoc, updateDoc, deleteDoc
} from "firebase/firestore";
import "./App.css";

const CLOUD_NAME    = "dsmeocmcx";
const UPLOAD_PRESET = "wetekie";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;
const DAILY_DOMAIN  = "wetekie";  // your Daily.co subdomain
const DAILY_API_KEY = "7166bf0788438e9f3200bc55c69a1fef0ac58735576f81939ab1aa975c0a2311";

const DEFAULT_ROOMS = [
  { id: "general",        name: "general",        emoji: "💬" },
  { id: "study-hall",     name: "study-hall",     emoji: "📚" },
  { id: "random",         name: "random",         emoji: "🎲" },
  { id: "project-corner", name: "project-corner", emoji: "🚀" },
  { id: "maths-help",     name: "maths-help",     emoji: "🧮" },
];

// ── HELPERS ───────────────────────────────────────
function getInitials(name) {
  if (!name) return "?";
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}
function getAvatarColor(name) {
  const colors = [
    ["#1a1040","#b8acff"],["#0d1f30","#60a5fa"],["#0d2015","#86efac"],
    ["#2a1015","#f87171"],["#1a200d","#d9f99d"],["#20100d","#fdba74"],
  ];
  const i = (name || "A").charCodeAt(0) % colors.length;
  return colors[i] || ["#1a1040","#b8acff"];
}
function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDuration(sec) {
  if (isNaN(sec) || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function renderText(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part.split("\n").map((line, j, arr) => (
      <span key={`${i}-${j}`}>{line}{j < arr.length - 1 && <br />}</span>
    ));
  });
}
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default")
    Notification.requestPermission();
}
function sendBrowserNotif(title, body, roomId) {
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification(`Wetekie — ${title}`, { body, icon: "/favicon.ico", tag: roomId });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

// ── RATE LIMITING ─────────────────────────────────
const AI_DAILY_LIMIT  = 20;
const AI_COOLDOWN_SEC = 10;

async function checkAiRateLimit(userId) {
  try {
    const today  = new Date().toISOString().slice(0, 10);
    const key    = `wetekie_ai_${userId}`;
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    const lastCallMs    = stored.lastCallMs || 0;
    const dailyCount    = stored.date === today ? (stored.dailyCount || 0) : 0;
    const secsSinceLast = (Date.now() - lastCallMs) / 1000;
    if (secsSinceLast < AI_COOLDOWN_SEC) {
      const wait = Math.ceil(AI_COOLDOWN_SEC - secsSinceLast);
      return { allowed: false, reason: `⏳ Please wait ${wait}s before asking @gemini again.` };
    }
    if (dailyCount >= AI_DAILY_LIMIT)
      return { allowed: false, reason: `🚫 Daily @gemini limit reached (${AI_DAILY_LIMIT}). Resets at midnight.` };
    localStorage.setItem(key, JSON.stringify({ date: today, dailyCount: dailyCount + 1, lastCallMs: Date.now() }));
    return { allowed: true, remaining: AI_DAILY_LIMIT - dailyCount - 1 };
  } catch (e) {
    return { allowed: true, remaining: AI_DAILY_LIMIT };
  }
}

// ── CLOUDINARY ────────────────────────────────────
async function uploadToCloudinary(fileOrBlob, filename, onProgress) {
  const fd = new FormData();
  fd.append("file", fileOrBlob, filename);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("folder", "wetekie");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_URL);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status === 200) { const r = JSON.parse(xhr.responseText); resolve({ url: r.secure_url }); }
      else reject(new Error(`Cloudinary error: ${xhr.status} ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

// ── WHATSAPP AUDIO PLAYER ─────────────────────────
function AudioPlayer({ src, isMe }) {
  const audioRef  = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [duration, setDuration] = useState(0);

  const BAR_COUNT = 28;
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const heights = [30,45,60,80,55,70,40,90,65,50,75,85,45,60,35,70,55,80,40,65,90,50,70,45,60,80,35,55];
    return heights[i % heights.length];
  });

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const progress = duration ? current / duration : 0;
  const filledBars = Math.floor(progress * BAR_COUNT);

  return (
    <div className={`wa-player${isMe ? " wa-me" : ""}`}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        preload="metadata"
        onContextMenu={e => e.preventDefault()}
      />
      <button className="wa-play" onClick={toggle}>
        {playing
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div className="wa-bars">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`wa-bar${i < filledBars ? " filled" : ""}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="wa-time">
        {playing ? formatDuration(current) : formatDuration(duration)}
      </span>
    </div>
  );
}

// ── IMAGE WITH DOWNLOAD ───────────────────────────
function ImageMessage({ src, fileName, onClick }) {
  const [hovered, setHovered] = useState(false);

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const res  = await fetch(src);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = fileName || "image.jpg";
      a.click(); URL.revokeObjectURL(url);
    } catch { window.open(src, "_blank"); }
  };

  return (
    <div
      className="img-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img src={src} alt={fileName} className="msg-img" onClick={onClick} />
      {hovered && (
        <button className="img-download-btn" onClick={handleDownload} title="Download image">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ── VOICE CALL COMPONENT ─────────────────────────
function VoiceCall({ roomId, user, onEnd }) {
  const callRef     = useRef(null);
  const [muted, setMuted]           = useState(false);
  const [joined, setJoined]         = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError]           = useState("");

  useEffect(() => {
    let call;
    const init = async () => {
      try {
        // Dynamically import Daily to avoid SSR issues
        const DailyIframe = (await import("@daily-co/daily-js")).default;
        call = DailyIframe.createCallObject({ audioSource: true, videoSource: false });
        callRef.current = call;

        call.on("joined-meeting", () => setJoined(true));
        call.on("participant-joined", () => setParticipants(Object.values(call.participants())));
        call.on("participant-left",   () => setParticipants(Object.values(call.participants())));
        call.on("error", e => setError(e.errorMsg || "Call error"));

        // Each room gets its own Daily room named after the Wetekie room
        const roomName = `wetekie-${roomId}`;
        await call.join({
          url: `https://${DAILY_DOMAIN}.daily.co/${roomName}`,
          token: undefined, // public room — no token needed
          userName: user?.displayName || "Anonymous",
        });

        setParticipants(Object.values(call.participants()));
      } catch (e) {
        setError(e.message || "Failed to join call");
      }
    };
    init();
    return () => { call?.leave(); call?.destroy(); };
  }, [roomId, user]);

  const toggleMute = () => {
    const call = callRef.current;
    if (!call) return;
    if (muted) { call.setLocalAudio(true); setMuted(false); }
    else        { call.setLocalAudio(false); setMuted(true); }
  };

  const handleEnd = () => {
    callRef.current?.leave();
    callRef.current?.destroy();
    onEnd();
  };

  return (
    <div className="voice-call">
      <div className="vc-header">
        <span className="vc-pulse" />
        <span className="vc-title">Voice call · #{roomId}</span>
        <span className="vc-count">{participants.length} in call</span>
      </div>

      {error && <div className="vc-error">{error}</div>}

      <div className="vc-participants">
        {participants.map(p => {
          const [pbg, pfg] = getAvatarColor(p.user_name);
          return (
            <div key={p.session_id} className="vc-participant">
              <div className="vc-av" style={{ background: pbg, color: pfg }}>
                {getInitials(p.user_name)}
                {!p.audio && <span className="vc-muted-icon">🔇</span>}
              </div>
              <span className="vc-name">{p.user_name || "Anonymous"}</span>
            </div>
          );
        })}
        {!joined && !error && (
          <div className="vc-connecting">
            <span className="spin" style={{ fontSize: 18 }}>◌</span>
            <span>Connecting...</span>
          </div>
        )}
      </div>

      <div className="vc-controls">
        <button className={`vc-btn${muted ? " muted" : ""}`} onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
          {muted
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
          <span>{muted ? "Unmute" : "Mute"}</span>
        </button>
        <button className="vc-btn vc-end" onClick={handleEnd} title="Leave call">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.42 19.42 0 013.43 9.19 19.79 19.79 0 01.36 10.6 2 2 0 012 8.72V5.91a2 2 0 011.72-2 12.84 12.84 0 002.81-.7 2 2 0 012.11.45l1.27 1.27a16 16 0 002.6 3.41z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)"/></svg>
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
}

// ── CALL BANNER (shown to others when a call is active) ───
function CallBanner({ callData, onJoin }) {
  return (
    <div className="call-banner">
      <span className="vc-pulse" />
      <span className="cb-text"><strong>{callData.startedBy}</strong> started a voice call</span>
      <button className="cb-join" onClick={onJoin}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Join call
      </button>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────
export default function ChatApp() {
  const { user, logout }   = useAuth();
  const nav                = useNavigate();
  const { roomId: urlRoom } = useParams();

  const [rooms, setRooms]               = useState(DEFAULT_ROOMS);
  const [activeRoom, setActiveRoom]     = useState(urlRoom || "general");
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState("");
  const [uploading, setUploading]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [aiLoading, setAiLoading]       = useState(false);
  const [onlineUsers, setOnlineUsers]   = useState([]);
  const [sidebarOpen, setSidebarOpen]   = useState(window.innerWidth > 768);
  const [newRoomName, setNewRoomName]   = useState("");
  const [showNewRoom, setShowNewRoom]   = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [unread, setUnread]             = useState({});
  const [lastSeen, setLastSeen]         = useState({});
  const [editingId, setEditingId]       = useState(null);
  const [editText, setEditText]         = useState("");
  const [hoveredId, setHoveredId]       = useState(null);
  const [aiLimitMsg, setAiLimitMsg]     = useState("");
  // Recording
  const [recording, setRecording]       = useState(false);
  const [recSeconds, setRecSeconds]     = useState(0);
  // Voice call
  const [inCall, setInCall]             = useState(false);
  const [activeCall, setActiveCall]     = useState(null); // Firestore call data
  // Search
  const [roomSearch, setRoomSearch]     = useState("");
  const [msgSearch, setMsgSearch]       = useState("");
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  // Link copy toast
  const [linkToast, setLinkToast]       = useState("");

  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const recTimerRef      = useRef(null);
  const bottomRef        = useRef(null);
  const fileRef          = useRef(null);
  const editRef          = useRef(null);
  const msgSearchRef     = useRef(null);
  const activeRoomRef    = useRef(activeRoom);
  activeRoomRef.current  = activeRoom;

  const isMobile = () => window.innerWidth <= 768;

  // Sync URL room param on mount
  useEffect(() => {
    if (urlRoom) setActiveRoom(urlRoom);
  }, [urlRoom]);

  useEffect(() => { requestNotifPermission(); }, []);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("wetekie_lastseen") || "{}");
    setLastSeen(stored);
  }, []);

  const markRoomSeen = useCallback((roomId) => {
    const now = Date.now();
    setLastSeen(prev => {
      const updated = { ...prev, [roomId]: now };
      localStorage.setItem("wetekie_lastseen", JSON.stringify(updated));
      return updated;
    });
    setUnread(prev => ({ ...prev, [roomId]: 0 }));
  }, []);

  const switchRoom = (roomId) => {
    setActiveRoom(roomId);
    markRoomSeen(roomId);
    nav(`/app/${roomId}`, { replace: true });
    setMsgSearch("");
    setShowMsgSearch(false);
    if (isMobile()) setSidebarOpen(false);
  };

  // Unread notifications
  useEffect(() => {
    const unsubs = [];
    const isFirst = {};
    rooms.forEach(room => {
      isFirst[room.id] = true;
      const q = query(collection(db, "rooms", room.id, "messages"), orderBy("createdAt"));
      const unsub = onSnapshot(q, snap => {
        if (isFirst[room.id]) { isFirst[room.id] = false; return; }
        if (room.id === activeRoomRef.current) return;
        const seenTime = JSON.parse(localStorage.getItem("wetekie_lastseen") || "{}")[room.id] || 0;
        const newMsgs = snap.docChanges()
          .filter(c => c.type === "added").map(c => c.doc.data())
          .filter(d => {
            if (d.uid === user?.uid) return false;
            const t = d.createdAt?.toMillis ? d.createdAt.toMillis() : 0;
            return t > seenTime;
          });
        if (newMsgs.length > 0) {
          setUnread(prev => ({ ...prev, [room.id]: (prev[room.id] || 0) + newMsgs.length }));
          const last = newMsgs[newMsgs.length - 1];
          const body = last.type === "audio" ? "🎙️ Voice message" : last.type === "image" ? "🖼️ Image" : last.type === "file" ? `📎 ${last.fileName}` : last.text?.slice(0, 80);
          sendBrowserNotif(`#${room.name}`, `${last.displayName}: ${body}`, room.id);
        }
      });
      unsubs.push(unsub);
    });
    return () => unsubs.forEach(u => u());
  }, [rooms, user]);

  // Presence
  useEffect(() => {
    if (!user) return;
    const uid = user.uid, name = user.displayName;
    setDoc(doc(db, "presence", uid), { uid, name, online: true, lastSeen: serverTimestamp() })
      .catch(e => console.warn("Presence error:", e.message));
    const unsub = onSnapshot(collection(db, "presence"), snap => {
      setOnlineUsers(snap.docs.map(d => d.data()).filter(u => u.online));
    });
    return () => {
      setDoc(doc(db, "presence", uid), { uid, name, online: false, lastSeen: serverTimestamp() })
        .catch(() => {});
      unsub();
    };
  }, [user]);

  // Messages listener
  useEffect(() => {
    if (!activeRoom) return;
    markRoomSeen(activeRoom);
    const q = query(collection(db, "rooms", activeRoom, "messages"), orderBy("createdAt"));
    let mounted = true;
    const unsub = onSnapshot(q, snap => {
      if (!mounted) return;
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { mounted = false; unsub(); };
  }, [activeRoom, markRoomSeen]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Custom rooms
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "customRooms"), snap => {
      const custom = snap.docs.map(d => ({ id: d.id, name: d.data().name, emoji: "💡" }));
      setRooms([...DEFAULT_ROOMS, ...custom]);
    });
    return unsub;
  }, []);

  // Listen for active call in current room
  useEffect(() => {
    if (!activeRoom) return;
    const unsub = onSnapshot(doc(db, "calls", activeRoom), snap => {
      if (snap.exists()) setActiveCall(snap.data());
      else { setActiveCall(null); setInCall(false); }
    });
    return unsub;
  }, [activeRoom]);

  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (showMsgSearch) msgSearchRef.current?.focus(); }, [showMsgSearch]);

  // Filtered data
  const filteredRooms = rooms.filter(r => r.name.toLowerCase().includes(roomSearch.toLowerCase()));
  const filteredMessages = msgSearch.trim()
    ? messages.filter(m => m.text?.toLowerCase().includes(msgSearch.toLowerCase()))
    : messages;

  const saveMessage = async (data) => {
    try {
      await addDoc(collection(db, "rooms", activeRoom, "messages"), {
        uid: user.uid, displayName: user.displayName || "Anonymous",
        createdAt: serverTimestamp(), edited: false, ...data,
      });
    } catch (e) { console.error("saveMessage failed:", e.message); alert("Failed to send. Check connection."); }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg) return;
    if (msg.length > 2000) { setAiLimitMsg("⚠️ Max 2000 characters."); setTimeout(() => setAiLimitMsg(""), 3000); return; }
    setInput("");
    await saveMessage({ text: msg, type: "text" });
    if (msg.toLowerCase().includes("@gemini")) {
      const { allowed, reason, remaining } = await checkAiRateLimit(user.uid);
      if (!allowed) { setAiLimitMsg(reason); setTimeout(() => setAiLimitMsg(""), 6000); return; }
      setAiLoading(true);
      const prompt = msg.replace(/@gemini/gi, "").trim() || "Hello!";
      const reply  = await askGemini(`You are Gemini, a helpful AI in a student group chat called Wetekie. Be concise and friendly. No markdown headers. Use **bold** sparingly. Student asks: ${prompt}`);
      setAiLoading(false);
      try {
        await addDoc(collection(db, "rooms", activeRoom, "messages"), {
          text: reply, uid: user.uid, senderType: "ai",
          displayName: "Gemini AI", type: "ai", createdAt: serverTimestamp(),
        });
      } catch (e) { console.error("Gemini save failed:", e.message); }
      if (remaining <= 5) { setAiLimitMsg(`⚠️ @gemini: ${remaining} call${remaining !== 1 ? "s" : ""} left today.`); setTimeout(() => setAiLimitMsg(""), 5000); }
    }
  };

  const handleKeyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const handleFileUpload = async e => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true); setUploadProgress(0);
    try {
      const isImage = file.type.startsWith("image/");
      const { url } = await uploadToCloudinary(file, file.name, setUploadProgress);
      await saveMessage({ type: isImage ? "image" : "file", text: file.name, fileUrl: url, fileName: file.name, fileSize: `${Math.round(file.size / 1024)} KB` });
    } catch (err) { alert(`Upload failed: ${err.message}`); }
    setUploading(false); setUploadProgress(0); e.target.value = "";
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick a MIME type that the browser actually supports
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
        "",
      ].find(t => t === "" || MediaRecorder.isTypeSupported(t));

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = e => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());

        const chunks = audioChunksRef.current;
        if (!chunks.length || chunks.every(c => c.size === 0)) {
          alert("Recording was empty. Please try again and speak into the mic.");
          setUploading(false);
          return;
        }

        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });

        if (blob.size < 1000) {
          alert("Recording too short or empty. Please hold the button and speak.");
          return;
        }

        // Pick extension based on actual MIME type
        const ext = mr.mimeType?.includes("mp4") ? "mp4"
          : mr.mimeType?.includes("ogg") ? "ogg"
          : "webm";

        setUploading(true); setUploadProgress(0);
        try {
          const { url } = await uploadToCloudinary(blob, `voice_${Date.now()}.${ext}`, setUploadProgress);
          await saveMessage({ type: "audio", text: "Voice message", fileUrl: url, fileName: "Voice message" });
        } catch (err) {
          alert(`Audio upload failed: ${err.message}`);
        }
        setUploading(false); setUploadProgress(0);
      };

      // Request data every 250ms to avoid empty chunks on mobile
      mr.start(250);
      setRecording(true); setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (err) {
      alert("Microphone access denied. Please allow mic access in your browser settings.");
    }
  };
  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    clearInterval(recTimerRef.current); setRecording(false); setRecSeconds(0);
  };
  const cancelRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.ondataavailable = null;
      mr.onstop = null;
      mr.stop();
      mr.stream?.getTracks().forEach(t => t.stop());
    }
    clearInterval(recTimerRef.current); setRecording(false); setRecSeconds(0);
  };

  // Edit / Delete
  const startEdit  = msg => { setEditingId(msg.id); setEditText(msg.text); };
  const cancelEdit = ()  => { setEditingId(null); setEditText(""); };
  const saveEdit   = async (msgId) => {
    if (!editText.trim()) return;
    try { await updateDoc(doc(db, "rooms", activeRoom, "messages", msgId), { text: editText.trim(), edited: true }); cancelEdit(); }
    catch (e) { alert("Failed to edit."); }
  };
  const handleDelete = async (msgId) => {
    if (!window.confirm("Delete this message?")) return;
    try { await deleteDoc(doc(db, "rooms", activeRoom, "messages", msgId)); }
    catch (e) { alert("Failed to delete."); }
  };
  const canActOn = msg => msg.uid === user?.uid && !msg.senderType && msg.createdAt && (Date.now() - (msg.createdAt.toMillis?.() || 0)) < 5 * 60 * 1000;

  // Room creation
  const handleCreateRoom = async () => {
    const name = newRoomName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    await setDoc(doc(db, "customRooms", name), { name });
    setNewRoomName(""); setShowNewRoom(false); switchRoom(name);
  };

  // Share room link
  const handleShareLink = () => {
    const link = `${window.location.origin}/app/${activeRoom}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkToast("🔗 Link copied!");
      setTimeout(() => setLinkToast(""), 3000);
    });
  };

  // Voice call handlers
  const startCall = async () => {
    try {
      await setDoc(doc(db, "calls", activeRoom), {
        roomId: activeRoom,
        startedBy: user.displayName || "Someone",
        startedAt: serverTimestamp(),
        active: true,
      });
      setInCall(true);
    } catch (e) { alert("Failed to start call: " + e.message); }
  };

  const joinCall  = () => setInCall(true);

  const endCall   = async () => {
    setInCall(false);
    // Only delete if you started it
    if (activeCall?.startedBy === user.displayName) {
      try { await deleteDoc(doc(db, "calls", activeRoom)); } catch {}
    }
  };

  const handleLogout = async () => { await logout(); nav("/"); };
  const totalUnread  = Object.values(unread).reduce((a, b) => a + b, 0);
  const [bg, fg]     = getAvatarColor(user?.displayName || user?.email || "A");

  return (
    <div className="chat-app page-fade">
      {sidebarOpen && isMobile() && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sb-top">
          <div className="sb-brand">wete<em>kie</em></div>
          <button className="sb-close" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>

        {/* Room search */}
        <div className="sb-room-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input
            value={roomSearch}
            onChange={e => setRoomSearch(e.target.value)}
            placeholder="Search rooms..."
          />
          {roomSearch && <button onClick={() => setRoomSearch("")}>✕</button>}
        </div>

        <div className="sb-section-label">Rooms</div>
        {filteredRooms.map(r => {
          const count = unread[r.id] || 0;
          return (
            <button key={r.id} className={`sb-room-btn${activeRoom === r.id ? " active" : ""}`} onClick={() => switchRoom(r.id)}>
              <span className="room-emoji">{r.emoji}</span>
              <span className="room-name">#{r.name}</span>
              {count > 0 && activeRoom !== r.id && <span className="unread-badge">{count > 99 ? "99+" : count}</span>}
            </button>
          );
        })}
        {filteredRooms.length === 0 && <div className="sb-no-results">No rooms found</div>}

        {showNewRoom ? (
          <div className="new-room-form">
            <input value={newRoomName} onChange={e => setNewRoomName(e.target.value)} placeholder="room-name" onKeyDown={e => e.key === "Enter" && handleCreateRoom()} autoFocus />
            <div className="nr-btns">
              <button className="nr-confirm" onClick={handleCreateRoom}>Create</button>
              <button className="nr-cancel" onClick={() => setShowNewRoom(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="add-room-btn" onClick={() => setShowNewRoom(true)}>+ New room</button>
        )}

        <div className="sb-section-label" style={{ marginTop: 24 }}>Online — {onlineUsers.length}</div>
        {onlineUsers.map(u => {
          const [ubg, ufg] = getAvatarColor(u.name);
          return (
            <div key={u.uid} className="online-user">
              <div className="ou-av" style={{ background: ubg, color: ufg }}>{getInitials(u.name)}</div>
              <span>{u.name}</span>
              <span className="ou-dot" />
            </div>
          );
        })}

        <div className="sb-user-row">
          <div className="sb-me-av" style={{ background: bg, color: fg }}>{getInitials(user?.displayName)}</div>
          <div className="sb-me-info">
            <span className="sb-me-name">{user?.displayName}</span>
            <span className="sb-me-email">{user?.email}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Sign out">↩</button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="chat-main">
        <div className="chat-header">
          <div className="ch-left">
            <button className="hamburger" onClick={() => setSidebarOpen(s => !s)}>
              ☰
              {totalUnread > 0 && !sidebarOpen && <span className="hamburger-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>}
            </button>
            <div className="ch-room"><span className="ch-hash">#</span><span>{activeRoom}</span></div>
          </div>
          <div className="ch-right">
            {/* Message search toggle */}
            <button className="ch-icon-btn" onClick={() => setShowMsgSearch(s => !s)} title="Search messages">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            {/* Share room link */}
            <button className="ch-icon-btn" onClick={handleShareLink} title="Copy room link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {/* Voice call button */}
            {!inCall && (
              <button className={`ch-icon-btn${activeCall ? " ch-call-active" : ""}`} onClick={activeCall ? joinCall : startCall} title={activeCall ? "Join call" : "Start voice call"}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
            <span className="ch-ai-badge">✦ @gemini</span>
            <span className="ch-online">{onlineUsers.length} online</span>
          </div>
        </div>

        {/* Message search bar */}
        {showMsgSearch && (
          <div className="msg-search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            <input
              ref={msgSearchRef}
              value={msgSearch}
              onChange={e => setMsgSearch(e.target.value)}
              placeholder={`Search in #${activeRoom}...`}
            />
            {msgSearch && (
              <span className="msg-search-count">
                {filteredMessages.length} result{filteredMessages.length !== 1 ? "s" : ""}
              </span>
            )}
            <button onClick={() => { setMsgSearch(""); setShowMsgSearch(false); }}>✕</button>
          </div>
        )}

        {/* Upload progress */}
        {uploading && (
          <div className="upload-bar">
            <div className="upload-fill" style={{ width: `${uploadProgress}%` }} />
            <span className="upload-label">{uploadProgress < 100 ? `Uploading... ${uploadProgress}%` : "Processing..."}</span>
          </div>
        )}

        {/* AI limit / link toast */}
        {aiLimitMsg && <div className="ai-limit-toast">{aiLimitMsg}</div>}
        {linkToast   && <div className="link-toast">{linkToast}</div>}

        {/* Active call banner — shown to users not yet in call */}
        {activeCall && !inCall && (
          <CallBanner callData={activeCall} onJoin={joinCall} />
        )}

        {/* Voice call panel */}
        {inCall && (
          <VoiceCall roomId={activeRoom} user={user} onEnd={endCall} />
        )}

        {/* Messages */}
        <div className="messages-area">
          {filteredMessages.length === 0 && !msgSearch && (
            <div className="empty-state">
              <div className="es-icon">💬</div>
              <div className="es-text">No messages yet. Start the conversation!</div>
              <div className="es-hint">Tip: mention <strong>@gemini</strong> to get AI help</div>
            </div>
          )}
          {filteredMessages.length === 0 && msgSearch && (
            <div className="empty-state">
              <div className="es-icon">🔍</div>
              <div className="es-text">No messages match "{msgSearch}"</div>
            </div>
          )}

          {filteredMessages.map(msg => {
            const isAi  = msg.senderType === "ai" || msg.uid === "gemini-ai";
            const isMe  = msg.uid === user?.uid && !isAi;
            const canAct = canActOn(msg);
            const [mbg, mfg] = getAvatarColor(msg.displayName);
            const isEditing  = editingId === msg.id;

            return (
              <div key={msg.id}
                className={`msg-row${isMe ? " me" : ""}${isAi ? " ai" : ""}`}
                onMouseEnter={() => setHoveredId(msg.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {!isMe && (
                  <div className="msg-av" style={{ background: isAi ? "rgba(139,127,255,0.15)" : mbg, color: isAi ? "var(--v)" : mfg }}>
                    {isAi ? "✦" : getInitials(msg.displayName)}
                  </div>
                )}

                <div className="msg-content">
                  {!isMe && (
                    <div className="msg-meta">
                      <span className="msg-name">{msg.displayName}</span>
                      <span className="msg-time">{formatTime(msg.createdAt)}</span>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="edit-wrap">
                      <textarea ref={editRef} className="edit-input" value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id); } if (e.key === "Escape") cancelEdit(); }} />
                      <div className="edit-actions">
                        <button className="edit-save" onClick={() => saveEdit(msg.id)}>Save</button>
                        <button className="edit-cancel" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : msg.type === "image" ? (
                    <div className="msg-bubble img-bubble">
                      <ImageMessage src={msg.fileUrl} fileName={msg.fileName} onClick={() => setImagePreview(msg.fileUrl)} />
                    </div>
                  ) : msg.type === "audio" ? (
                    <div className="msg-bubble audio-bubble-wrap">
                      <AudioPlayer src={msg.fileUrl} isMe={isMe} />
                    </div>
                  ) : msg.type === "file" ? (
                    <div className="msg-bubble file-bubble">
                      <span className="file-icon">📎</span>
                      <div className="file-info">
                        <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="file-link">{msg.fileName}</a>
                        {msg.fileSize && <span className="file-size">{msg.fileSize}</span>}
                      </div>
                    </div>
                  ) : (
                    <div className={`msg-bubble${isAi ? " ai-bubble" : ""}`}>
                      {renderText(msg.text)}
                      {msg.edited && <span className="edited-label"> (edited)</span>}
                    </div>
                  )}

                  {isMe && !isEditing && <div className="msg-time-me">{formatTime(msg.createdAt)}</div>}
                </div>

                {isMe && (
                  <div className="msg-av me-av" style={{ background: bg, color: fg }}>{getInitials(user?.displayName)}</div>
                )}

                {canAct && hoveredId === msg.id && !isEditing && (
                  <div className={`msg-actions${isMe ? " act-left" : " act-right"}`}>
                    {msg.type === "text" && <button className="act-btn" onClick={() => startEdit(msg)} title="Edit">✏️</button>}
                    <button className="act-btn del" onClick={() => handleDelete(msg.id)} title="Delete">🗑️</button>
                  </div>
                )}
              </div>
            );
          })}

          {aiLoading && (
            <div className="msg-row ai">
              <div className="msg-av" style={{ background: "rgba(139,127,255,0.15)", color: "var(--v)" }}>✦</div>
              <div className="msg-content">
                <div className="msg-meta"><span className="msg-name">Gemini AI</span></div>
                <div className="msg-bubble ai-bubble typing"><span /><span /><span /></div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="input-area">
          <input type="file" ref={fileRef} onChange={handleFileUpload} style={{ display: "none" }} accept="image/*,.pdf,.doc,.docx,.txt,.zip,.csv" />
          {recording ? (
            <div className="rec-bar">
              <span className="rec-dot" />
              <span className="rec-time">{formatDuration(recSeconds)}</span>
              <button className="rec-cancel" onClick={cancelRecording}>✕</button>
              <button className="rec-send" onClick={stopRecording}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Send
              </button>
            </div>
          ) : (
            <>
              <button className="attach-btn" onClick={() => fileRef.current.click()} disabled={uploading} title="Attach file">
                {uploading ? <span className="spin" style={{ fontSize: 13 }}>◌</span>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </button>
              <textarea className="msg-input" value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={`Message #${activeRoom} or @gemini...`} rows={1} />
              {input.trim()
                ? <button className="send-btn" onClick={handleSend}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                : <button className="mic-btn" onClick={startRecording} title="Record voice message">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
              }
            </>
          )}
        </div>
      </main>

      {/* Image modal */}
      {imagePreview && (
        <div className="img-modal" onClick={() => setImagePreview(null)}>
          <img src={imagePreview} alt="preview" />
          <button className="img-modal-close" onClick={() => setImagePreview(null)}>✕</button>
        </div>
      )}
    </div>
  );
}