import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../config/firebase";
import { useAuth } from "../context/AuthContext";
import { askGemini } from "../config/gemini";
import {
  collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, doc, setDoc, updateDoc, deleteDoc
} from "firebase/firestore";
import "./App.css";

const CLOUD_NAME = "dsmeocmcx";
const UPLOAD_PRESET = "wetekie";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;

const DEFAULT_ROOMS = [
  { id: "general",        name: "general",        emoji: "💬" },
  { id: "study-hall",     name: "study-hall",     emoji: "📚" },
  { id: "random",         name: "random",         emoji: "🎲" },
  { id: "project-corner", name: "project-corner", emoji: "🚀" },
  { id: "maths-help",     name: "maths-help",     emoji: "🧮" },
];

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
  const m = Math.floor(sec / 60);
  const s = sec % 60;
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
const AI_DAILY_LIMIT  = 20;   // max @gemini calls per user per day
const AI_COOLDOWN_SEC = 10;   // seconds between calls

async function checkAiRateLimit(userId) {
  try {
    const today   = new Date().toISOString().slice(0, 10);
    const key     = `wetekie_ai_${userId}`;
    const stored  = JSON.parse(localStorage.getItem(key) || "{}");

    const lastCallMs    = stored.lastCallMs || 0;
    const dailyCount    = stored.date === today ? (stored.dailyCount || 0) : 0;
    const secsSinceLast = (Date.now() - lastCallMs) / 1000;

    if (secsSinceLast < AI_COOLDOWN_SEC) {
      const wait = Math.ceil(AI_COOLDOWN_SEC - secsSinceLast);
      return { allowed: false, reason: `⏳ Please wait ${wait} more second${wait !== 1 ? "s" : ""} before asking @gemini again.` };
    }
    if (dailyCount >= AI_DAILY_LIMIT) {
      return { allowed: false, reason: `🚫 You've reached your daily @gemini limit (${AI_DAILY_LIMIT}/${AI_DAILY_LIMIT}). Resets at midnight.` };
    }

    // Save updated usage to localStorage
    localStorage.setItem(key, JSON.stringify({
      date: today,
      dailyCount: dailyCount + 1,
      lastCallMs: Date.now()
    }));

    return { allowed: true, remaining: AI_DAILY_LIMIT - dailyCount - 1 };
  } catch (err) {
    console.warn("Rate limit check failed (allowing call):", err.message);
    return { allowed: true, remaining: AI_DAILY_LIMIT };
  }
}


async function uploadToCloudinary(fileOrBlob, filename, onProgress) {
  const fd = new FormData();
  fd.append("file", fileOrBlob, filename);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("folder", "wetekie");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_URL);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const res = JSON.parse(xhr.responseText);
        resolve({ url: res.secure_url, type: res.resource_type });
      } else {
        reject(new Error(`Cloudinary error: ${xhr.status} ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

export default function ChatApp() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [rooms, setRooms]               = useState(DEFAULT_ROOMS);
  const [activeRoom, setActiveRoom]     = useState("general");
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
  // Audio recording
  const [recording, setRecording]       = useState(false);
  const [recSeconds, setRecSeconds]     = useState(0);
  const [aiLimitMsg, setAiLimitMsg]     = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const recTimerRef      = useRef(null);

  const bottomRef     = useRef(null);
  const fileRef       = useRef(null);
  const editRef       = useRef(null);
  const activeRoomRef = useRef(activeRoom);
  activeRoomRef.current = activeRoom;

  const isMobile = () => window.innerWidth <= 768;

  useEffect(() => { requestNotifPermission(); }, []);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("wetekie_lastseen") || "{}");
    setLastSeen(stored);
  }, []);

  const markRoomSeen = (roomId) => {
    const now = Date.now();
    setLastSeen(prev => {
      const updated = { ...prev, [roomId]: now };
      localStorage.setItem("wetekie_lastseen", JSON.stringify(updated));
      return updated;
    });
    setUnread(prev => ({ ...prev, [roomId]: 0 }));
  };

  const switchRoom = (roomId) => {
    setActiveRoom(roomId);
    markRoomSeen(roomId);
    if (isMobile()) setSidebarOpen(false);
  };

  // Unread + browser notifications — subscribe to all rooms, use ref to skip active
  useEffect(() => {
    const unsubs = [];
    const isFirst = {};
    rooms.forEach(room => {
      isFirst[room.id] = true;
      const q = query(collection(db, "rooms", room.id, "messages"), orderBy("createdAt"));
      const unsub = onSnapshot(q, snap => {
        if (isFirst[room.id]) { isFirst[room.id] = false; return; }
        // Use ref — no stale closure, always current active room
        if (room.id === activeRoomRef.current) return;
        const seenTime = JSON.parse(localStorage.getItem("wetekie_lastseen") || "{}")[room.id] || 0;
        const newMsgs = snap.docChanges()
          .filter(c => c.type === "added")
          .map(c => c.doc.data())
          .filter(d => {
            if (d.uid === user?.uid) return false;
            const t = d.createdAt?.toMillis ? d.createdAt.toMillis() : 0;
            return t > seenTime;
          });
        if (newMsgs.length > 0) {
          setUnread(prev => ({ ...prev, [room.id]: (prev[room.id] || 0) + newMsgs.length }));
          const last = newMsgs[newMsgs.length - 1];
          const body = last.type === "audio" ? "🎙️ Voice message"
            : last.type === "image" ? "🖼️ Image"
            : last.type === "file"  ? `📎 ${last.fileName}`
            : last.text?.slice(0, 80);
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
    const presRef = doc(db, "presence", user.uid);
    const uid = user.uid;
    const name = user.displayName;

    setDoc(presRef, { uid, name, online: true, lastSeen: serverTimestamp() })
      .catch(e => console.warn("Presence online set failed:", e.message));

    const unsub = onSnapshot(collection(db, "presence"), snap => {
      setOnlineUsers(snap.docs.map(d => d.data()).filter(u => u.online));
    });
    return () => {
      // Use uid/name captured in closure — auth may be gone by cleanup time
      setDoc(doc(db, "presence", uid), { uid, name, online: false, lastSeen: serverTimestamp() })
        .catch(e => console.warn("Presence offline set failed:", e.message));
      unsub();
    };
  }, [user]);

  // Messages — single dedicated listener for active room only
  useEffect(() => {
    if (!activeRoom) return;
    markRoomSeen(activeRoom);
    const q = query(collection(db, "rooms", activeRoom, "messages"), orderBy("createdAt"));
    let mounted = true;
    const unsub = onSnapshot(q, snap => {
      if (!mounted) return;
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [activeRoom]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Custom rooms
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "customRooms"), snap => {
      const custom = snap.docs.map(d => ({ id: d.id, name: d.data().name, emoji: "💡" }));
      setRooms([...DEFAULT_ROOMS, ...custom]);
    });
    return unsub;
  }, []);

  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);

  const saveMessage = async (data) => {
    try {
      await addDoc(collection(db, "rooms", activeRoom, "messages"), {
        uid: user.uid,
        displayName: user.displayName || "Anonymous",
        createdAt: serverTimestamp(),
        edited: false,
        ...data,
      });
    } catch (e) {
      console.error("saveMessage failed:", e.message);
      alert("Failed to send message. Check your connection.");
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg) return;

    // Input length guard
    if (msg.length > 2000) {
      setAiLimitMsg("⚠️ Message too long. Max 2000 characters.");
      setTimeout(() => setAiLimitMsg(""), 4000);
      return;
    }

    setInput("");
    await saveMessage({ text: msg, type: "text" });

    if (msg.toLowerCase().includes("@gemini")) {
      // Check rate limit before calling AI
      const { allowed, reason, remaining } = await checkAiRateLimit(user.uid);
      if (!allowed) {
        // Post limit message visibly in chat as a system notice
        setAiLimitMsg(reason);
        setTimeout(() => setAiLimitMsg(""), 6000);
        return;
      }

      setAiLoading(true);
      const prompt = msg.replace(/@gemini/gi, "").trim() || "Hello!";
      const reply = await askGemini(
        `You are Gemini, a helpful AI in a student group chat called Wetekie. Be concise and friendly. No markdown headers. Use **bold** sparingly. Student asks: ${prompt}`
      );
      setAiLoading(false);
      try {
        await addDoc(collection(db, "rooms", activeRoom, "messages"), {
          text: reply,
          uid: user.uid,        // must match auth.uid to satisfy Firestore rules
          senderType: "ai",     // flag to identify as AI message in UI
          displayName: "Gemini AI",
          type: "ai",
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to save Gemini response:", e.message);
      }

      // Show remaining calls as a subtle hint
      if (remaining <= 5) {
        setAiLimitMsg(`⚠️ @gemini limit: ${remaining} call${remaining !== 1 ? "s" : ""} remaining today.`);
        setTimeout(() => setAiLimitMsg(""), 5000);
      }
    }
  };

  const handleKeyDown = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // File upload via Cloudinary
  const handleFileUpload = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const isImage = file.type.startsWith("image/");
      const { url } = await uploadToCloudinary(file, file.name, setUploadProgress);
      const sizeKB = Math.round(file.size / 1024);
      await saveMessage({
        type: isImage ? "image" : "file",
        text: file.name,
        fileUrl: url,
        fileName: file.name,
        fileSize: `${sizeKB} KB`,
      });
    } catch (err) {
      console.error("Upload error:", err);
      alert(`Upload failed: ${err.message}`);
    }
    setUploading(false);
    setUploadProgress(0);
    e.target.value = "";
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setUploading(true);
        setUploadProgress(0);
        try {
          const { url } = await uploadToCloudinary(blob, `voice_${Date.now()}.webm`, setUploadProgress);
          await saveMessage({ type: "audio", text: "Voice message", fileUrl: url, fileName: "Voice message" });
        } catch (err) {
          console.error("Audio upload error:", err);
          alert(`Audio upload failed: ${err.message}`);
        }
        setUploading(false);
        setUploadProgress(0);
      };
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (err) {
      alert("Microphone access denied. Please allow mic access and try again.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    clearInterval(recTimerRef.current);
    setRecording(false);
    setRecSeconds(0);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    }
    clearInterval(recTimerRef.current);
    setRecording(false);
    setRecSeconds(0);
  };

  // Edit / Delete
  const startEdit = msg => { setEditingId(msg.id); setEditText(msg.text); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); };
  const saveEdit = async (msgId) => {
    if (!editText.trim()) return;
    try {
      await updateDoc(doc(db, "rooms", activeRoom, "messages", msgId), { text: editText.trim(), edited: true });
      cancelEdit();
    } catch (e) {
      console.error("Edit failed:", e.message);
      alert("Failed to edit message. You can only edit your own messages within 5 minutes.");
    }
  };
  const handleDelete = async (msgId) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      await deleteDoc(doc(db, "rooms", activeRoom, "messages", msgId));
    } catch (e) {
      console.error("Delete failed:", e.message);
      alert("Failed to delete message.");
    }
  };
  const canActOn = msg => {
    if (msg.uid !== user?.uid) return false;
    const t = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : 0;
    return Date.now() - t < 5 * 60 * 1000;
  };

  const handleCreateRoom = async () => {
    const name = newRoomName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    await setDoc(doc(db, "customRooms", name), { name });
    setNewRoomName(""); setShowNewRoom(false);
    switchRoom(name);
  };

  const handleLogout = async () => { await logout(); nav("/"); };
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const [bg, fg] = getAvatarColor(user?.displayName || user?.email || "A");

  return (
    <div className="chat-app page-fade">
      {sidebarOpen && isMobile() && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sb-top">
          <div className="sb-brand">wete<em>kie</em></div>
          <button className="sb-close" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        <div className="sb-section-label">Rooms</div>
        {rooms.map(r => {
          const count = unread[r.id] || 0;
          return (
            <button key={r.id} className={`sb-room-btn${activeRoom === r.id ? " active" : ""}`} onClick={() => switchRoom(r.id)}>
              <span className="room-emoji">{r.emoji}</span>
              <span className="room-name">#{r.name}</span>
              {count > 0 && activeRoom !== r.id && <span className="unread-badge">{count > 99 ? "99+" : count}</span>}
            </button>
          );
        })}
        {showNewRoom ? (
          <div className="new-room-form">
            <input value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
              placeholder="room-name" onKeyDown={e => e.key === "Enter" && handleCreateRoom()} autoFocus />
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

      {/* MAIN */}
      <main className="chat-main">
        <div className="chat-header">
          <div className="ch-left">
            <button className="hamburger" onClick={() => setSidebarOpen(s => !s)}>
              ☰
              {totalUnread > 0 && !sidebarOpen && (
                <span className="hamburger-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>
              )}
            </button>
            <div className="ch-room"><span className="ch-hash">#</span><span>{activeRoom}</span></div>
          </div>
          <div className="ch-right">
            <span className="ch-ai-badge">✦ @gemini</span>
            <span className="ch-online">{onlineUsers.length} online</span>
          </div>
        </div>

        {uploading && (
          <div className="upload-bar">
            <div className="upload-fill" style={{ width: `${uploadProgress}%` }} />
            <span className="upload-label">{uploadProgress < 100 ? `Uploading... ${uploadProgress}%` : "Processing..."}</span>
          </div>
        )}

        {aiLimitMsg && (
          <div className="ai-limit-toast">
            {aiLimitMsg}
          </div>
        )}

        <div className="messages-area">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="es-icon">💬</div>
              <div className="es-text">No messages yet. Start the conversation!</div>
              <div className="es-hint">Tip: mention <strong>@gemini</strong> to get AI help</div>
            </div>
          )}

          {messages.map(msg => {
            const isAi  = msg.senderType === "ai" || msg.uid === "gemini-ai";
            const isMe  = msg.uid === user?.uid && !isAi;
            const canAct = canActOn(msg);
            const [mbg, mfg] = getAvatarColor(msg.displayName);
            const isEditing = editingId === msg.id;

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
                        onKeyDown={e => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id); }
                          if (e.key === "Escape") cancelEdit();
                        }} />
                      <div className="edit-actions">
                        <button className="edit-save" onClick={() => saveEdit(msg.id)}>Save</button>
                        <button className="edit-cancel" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : msg.type === "image" ? (
                    <div className="msg-bubble img-bubble">
                      <img src={msg.fileUrl} alt={msg.fileName} className="msg-img" onClick={() => setImagePreview(msg.fileUrl)} />
                    </div>
                  ) : msg.type === "audio" ? (
                    <div className="msg-bubble audio-bubble">
                      <span className="audio-icon">🎙️</span>
                      <audio controls src={msg.fileUrl} className="audio-player" />
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
                    {msg.type === "text" && (
                      <button className="act-btn" onClick={() => startEdit(msg)} title="Edit">✏️</button>
                    )}
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

        {/* INPUT */}
        <div className="input-area">
          <input type="file" ref={fileRef} onChange={handleFileUpload} style={{ display: "none" }}
            accept="image/*,.pdf,.doc,.docx,.txt,.zip,.csv" />

          {recording ? (
            <div className="rec-bar">
              <span className="rec-dot" />
              <span className="rec-time">{formatDuration(recSeconds)}</span>
              <button className="rec-cancel" onClick={cancelRecording}>✕</button>
              <button className="rec-send" onClick={stopRecording}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Send
              </button>
            </div>
          ) : (
            <>
              <button className="attach-btn" onClick={() => fileRef.current.click()} disabled={uploading} title="Attach file">
                {uploading
                  ? <span className="spin" style={{ fontSize: 13 }}>◌</span>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </button>
              <textarea className="msg-input" value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={`Message #${activeRoom} or @gemini...`} rows={1} />
              {input.trim() ? (
                <button className="send-btn" onClick={handleSend}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ) : (
                <button className="mic-btn" onClick={startRecording} title="Record voice message">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </main>

      {imagePreview && (
        <div className="img-modal" onClick={() => setImagePreview(null)}>
          <img src={imagePreview} alt="preview" />
          <button className="img-modal-close" onClick={() => setImagePreview(null)}>✕</button>
        </div>
      )}
    </div>
  );
}