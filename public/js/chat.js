// Chatroom. Simple WebSocket-based chat with in-memory history.

const $ = (id) => document.getElementById(id);
const NAME_KEY = "lux.chat.name";

let ws = null;
let reconnectTimer = null;

function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || "Anonymous"; } catch { return "Anonymous"; }
}

function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch {}
}

export function initChat() {
  const messages = $("chat-messages");
  const input = $("chat-input");
  const nameInput = $("chat-name");
  const sendBtn = $("chat-send");

  if (!messages || !input || !sendBtn) return;

  // Restore name
  nameInput.value = getSavedName();
  nameInput.onchange = () => saveName(nameInput.value.trim() || "Anonymous");

  // Connect lazily: only when the chat panel is actually opened, not at boot.
  // This avoids opening a WebSocket on every page load for users who never
  // use chat. The first time the panel becomes visible, connect.
  const chatPanel = $("panel-chat");
  if (chatPanel) {
    const observer = new MutationObserver(() => {
      if (chatPanel.classList.contains("open") && !ws) {
        connect();
      }
    });
    observer.observe(chatPanel, { attributes: true, attributeFilter: ["class"] });
  }

  sendBtn.onclick = sendMessage;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = proto + "://" + location.host + "/chat/";

  try {
    ws = new WebSocket(url);
  } catch (e) {
    addSystemMessage("Connection failed: " + e.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    addSystemMessage("Connected.");
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleMessage(data);
    } catch {}
  };

  ws.onclose = () => {
    ws = null;
    addSystemMessage("Disconnected. Reconnecting...");
    scheduleReconnect();
  };

  ws.onerror = () => {
    addSystemMessage("Connection error.");
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function sendMessage() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    addSystemMessage("Not connected.");
    return;
  }
  const input = $("chat-input");
  const nameInput = $("chat-name");
  const text = input.value.trim();
  if (!text) return;

  const name = nameInput.value.trim() || "Anonymous";
  ws.send(JSON.stringify({ type: "message", name, text }));
  input.value = "";
}

function handleMessage(data) {
  const messages = $("chat-messages");
  if (!messages) return;

  if (data.type === "history") {
    messages.innerHTML = "";
    for (const msg of data.messages) {
      if (msg.type === "message") {
        addMessage(msg.name || "Anonymous", msg.text, msg.time);
      } else if (msg.type === "system") {
        addSystemMessage(msg.text);
      }
    }
    return;
  }

  if (data.type === "message") {
    addMessage(data.name || "Anonymous", data.text, data.time);
  } else if (data.type === "system") {
    addSystemMessage(data.text);
  }
}

function addMessage(name, text, time) {
  const messages = $("chat-messages");
  if (!messages) return;

  const el = document.createElement("div");
  el.style.cssText = "padding:6px 10px;border-radius:8px;background:var(--line);font-size:13px;line-height:1.4;word-break:break-word";

  const nameEl = document.createElement("strong");
  nameEl.style.cssText = "font-size:12px;color:var(--ink-soft);margin-right:6px";
  nameEl.textContent = name;

  const textEl = document.createElement("span");
  textEl.textContent = text;

  el.appendChild(nameEl);
  el.appendChild(textEl);
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
  const messages = $("chat-messages");
  if (!messages) return;

  const el = document.createElement("div");
  el.style.cssText = "font-size:12px;color:var(--ink-soft);font-style:italic;text-align:center;padding:4px 0";
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

export function disconnectChat() {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}
