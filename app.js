/* ===== AURA AI — APP LOGIC ===== */

// ── STATE ──────────────────────────────────────────────────────────────────
const STATE = {
  apiKeys: [],
  currentKeyIndex: 0,
  model: 'llama-3.3-70b-versatile',
  temperature: 0.7,
  maxTokens: 2048,
  streamEnabled: true,
  systemPrompt: 'You are void, a highly intelligent and helpful AI assistant powered by Groq. You are concise, accurate, and thoughtful.',
  chats: {},       // { id: { id, title, messages, model, createdAt, updatedAt } }
  currentChatId: null,
  theme: 'nebula',
  stats: { totalMessages: 0, totalTokens: 0 },
  pendingImages: [], // [{ dataUrl, base64, type }]
  isStreaming: false,
  abortController: null,
};

// ── PERSISTENCE ────────────────────────────────────────────────────────────
function save() {
  const data = {
    apiKeys: STATE.apiKeys,
    model: STATE.model,
    temperature: STATE.temperature,
    maxTokens: STATE.maxTokens,
    streamEnabled: STATE.streamEnabled,
    systemPrompt: STATE.systemPrompt,
    chats: STATE.chats,
    currentChatId: STATE.currentChatId,
    theme: STATE.theme,
    stats: STATE.stats,
  };
  try { localStorage.setItem('void_state', JSON.stringify(data)); } catch(e) {}
}

function load() {
  try {
    const raw = localStorage.getItem('void_state');
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(STATE, data);
  } catch(e) {}
}

// ── GROQ API ───────────────────────────────────────────────────────────────
async function callGroq(messages, onChunk, signal) {
  const keysToTry = [...STATE.apiKeys];
  let lastError = null;

  for (let attempt = 0; attempt < keysToTry.length; attempt++) {
    const keyIndex = (STATE.currentKeyIndex + attempt) % keysToTry.length;
    const apiKey = keysToTry[keyIndex];
    if (!apiKey) continue;

    try {
      const body = {
        model: STATE.model,
        messages: [
          { role: 'system', content: STATE.systemPrompt },
          ...messages
        ],
        temperature: STATE.temperature,
        max_tokens: STATE.maxTokens,
        stream: STATE.streamEnabled,
      };

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      // Rate limit? Rotate key
      if (res.status === 429) {
        STATE.currentKeyIndex = (keyIndex + 1) % keysToTry.length;
        save();
        toast('Key rate limited, rotating…', 'info');
        lastError = new Error('Rate limited');
        continue;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }

      STATE.currentKeyIndex = keyIndex;
      save();

      if (!STATE.streamEnabled) {
        const data = await res.json();
        const content = data.choices[0].message.content;
        STATE.stats.totalTokens += data.usage?.total_tokens || 0;
        save();
        onChunk(content, true);
        return { content, usage: data.usage };
      }

      // Streaming
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              onChunk(delta, false);
            }
            if (parsed.x_groq?.usage?.total_tokens) {
              totalTokens = parsed.x_groq.usage.total_tokens;
            }
          } catch(e) {}
        }
      }

      STATE.stats.totalTokens += totalTokens;
      save();
      onChunk('', true); // signal done
      return { content: fullContent };
    } catch(e) {
      if (e.name === 'AbortError') throw e;
      lastError = e;
    }
  }

  throw lastError || new Error('All API keys failed');
}

// ── CHAT MANAGEMENT ────────────────────────────────────────────────────────
function createChat() {
  const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  STATE.chats[id] = {
    id,
    title: 'New Chat',
    messages: [],
    model: STATE.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  STATE.currentChatId = id;
  save();
  return id;
}

function deleteChat(id) {
  delete STATE.chats[id];
  if (STATE.currentChatId === id) {
    const ids = Object.keys(STATE.chats);
    STATE.currentChatId = ids.length ? ids[ids.length - 1] : null;
  }
  save();
}

function generateTitle(text) {
  const clean = text.trim().slice(0, 60);
  return clean.length > 40 ? clean.slice(0, 40) + '…' : clean;
}

// ── MARKDOWN RENDERER ──────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';

  // Code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang || 'code';
    return `<pre><div class="code-header"><span>${langLabel}</span><button class="code-copy" onclick="copyCode(this)">Copy</button></div><code>${escHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  text = text.replace(/^(\s*[-*+] .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n')
      .filter(l => l.trim())
      .map(l => `<li>${l.replace(/^\s*[-*+] /, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  text = text.replace(/^(\s*\d+\. .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n')
      .filter(l => l.trim())
      .map(l => `<li>${l.replace(/^\s*\d+\. /, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Tables
  text = text.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (_, header, body) => {
    const heads = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Paragraphs (double newlines)
  text = text.replace(/\n{2,}/g, '</p><p>');
  text = `<p>${text}</p>`;

  // Single newlines in paragraphs
  text = text.replace(/(?<!>)\n(?!<)/g, '<br>');

  // Cleanup empty paragraphs
  text = text.replace(/<p>\s*<\/p>/g, '');
  text = text.replace(/<p>(<(?:pre|ul|ol|h[1-3]|blockquote|table))/g, '$1');
  text = text.replace(/(<\/(?:pre|ul|ol|h[1-3]|blockquote|table)>)<\/p>/g, '$1');

  return text;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.copyCode = (btn) => {
  const code = btn.closest('pre').querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
};

// ── UI HELPERS ─────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => t.remove(), 250);
  }, 3500);
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString();
}

// ── RENDER SIDEBAR CHAT LIST ───────────────────────────────────────────────
function renderChatList(filter = '') {
  const list = document.getElementById('chatList');
  const chats = Object.values(STATE.chats)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(c => !filter || c.title.toLowerCase().includes(filter.toLowerCase()));

  list.innerHTML = '';

  if (!chats.length) {
    list.innerHTML = `<div style="padding:12px;font-size:0.76rem;color:var(--text3);text-align:center">No chats yet</div>`;
    return;
  }

  chats.forEach(chat => {
    const el = document.createElement('div');
    el.className = `chat-item${STATE.currentChatId === chat.id ? ' active' : ''}`;
    el.innerHTML = `
      <span class="chat-item-title">${escHtml(chat.title)}</span>
      <button class="chat-item-del" title="Delete" onclick="event.stopPropagation();confirmDeleteChat('${chat.id}')">✕</button>
    `;
    el.addEventListener('click', () => switchChat(chat.id));
    list.appendChild(el);
  });
}

window.confirmDeleteChat = (id) => {
  deleteChat(id);
  if (STATE.currentChatId && STATE.chats[STATE.currentChatId]) {
    switchChat(STATE.currentChatId);
  } else {
    STATE.currentChatId = null;
    showDashboard();
  }
  renderChatList();
  renderRecentChats();
  updateStats();
};

// ── SWITCH / LOAD CHAT ─────────────────────────────────────────────────────
function switchChat(id) {
  if (!STATE.chats[id]) return;
  STATE.currentChatId = id;
  save();
  showChatView();
  renderMessages();
  renderChatList();
  const chat = STATE.chats[id];
  document.getElementById('chatModelSelect').value = chat.model || STATE.model;
}

// ── RENDER MESSAGES ────────────────────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById('messagesContainer');
  const emptyState = document.getElementById('chatEmptyState');
  const chat = STATE.currentChatId ? STATE.chats[STATE.currentChatId] : null;

  container.innerHTML = '';

  if (!chat || !chat.messages.length) {
    if (emptyState) {
    container.appendChild(emptyState);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-empty-state';
    placeholder.innerHTML = '<div class="empty-aura"><svg width="48" height="48" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="38" fill="#141425"/><circle cx="40" cy="40" r="32" stroke="#7c6fff" stroke-width="1" opacity="0.4"/><line x1="22" y1="28" x2="40" y2="50" stroke="#c8b8ff" stroke-width="2.5" stroke-linecap="round"/><line x1="58" y1="28" x2="40" y2="50" stroke="#c8b8ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="40" cy="50" r="2.5" fill="#e0d8ff"/></svg></div><p>Start a conversation</p>';
    container.appendChild(placeholder);
  }
    return;
  }

  chat.messages.forEach(msg => {
    appendMessageBubble(msg, container);
  });

  scrollToBottom();
}

function appendMessageBubble(msg, container) {
  if (!container) container = document.getElementById('messagesContainer');
  
  const group = document.createElement('div');
  group.className = 'msg-group';
  group.dataset.msgId = msg.id;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `
    <span class="msg-role">${msg.role === 'user' ? 'You' : 'void'}</span>
    <span class="msg-time">${formatTime(msg.ts)}</span>
    <button class="copy-msg-btn" onclick="copyMsgText('${msg.id}')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Copy
    </button>
  `;

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${msg.role}`;

  // Images
  if (msg.images && msg.images.length) {
    msg.images.forEach(imgData => {
      const img = document.createElement('img');
      img.className = 'msg-image';
      img.src = imgData;
      img.alt = 'Attached image';
      bubble.appendChild(img);
    });
    const br = document.createElement('div');
    br.style.marginTop = '8px';
    bubble.appendChild(br);
  }

  const textEl = document.createElement('div');
  if (msg.role === 'assistant') {
    textEl.innerHTML = renderMarkdown(msg.content);
  } else {
    textEl.textContent = msg.content;
  }
  bubble.appendChild(textEl);

  group.appendChild(meta);
  group.appendChild(bubble);

  // Remove empty state if present
  const empty = container.querySelector('.chat-empty-state');
  if (empty) empty.remove();

  container.appendChild(group);
}

window.copyMsgText = (id) => {
  const el = document.querySelector(`[data-msg-id="${id}"] .msg-bubble`);
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(() => toast('Copied!', 'success'));
  }
};

function scrollToBottom() {
  const c = document.getElementById('messagesContainer');
  c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
}

// ── SEND MESSAGE ───────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  const images = [...STATE.pendingImages];

  if (!text && !images.length) return;
  if (!STATE.apiKeys.filter(k => k.trim()).length) { toast('Add an API key first!', 'error'); document.getElementById('openSettings').click(); return; }
  if (STATE.isStreaming) return;

  // Ensure chat exists
  if (!STATE.currentChatId || !STATE.chats[STATE.currentChatId]) {
    createChat();
    showChatView();
  }

  const chat = STATE.chats[STATE.currentChatId];
  input.value = '';
  input.style.height = 'auto';
  clearImagePreviews();
  toggleSendBtn(false);

  // Build user message
  const userMsg = {
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
    images: images.map(i => i.dataUrl),
    ts: Date.now(),
  };

  chat.messages.push(userMsg);
  if (chat.title === 'New Chat' && text) {
    chat.title = generateTitle(text);
  }
  chat.updatedAt = Date.now();
  STATE.stats.totalMessages++;
  save();

  appendMessageBubble(userMsg);
  scrollToBottom();
  renderChatList();

  // Show typing indicator
  const typingEl = addTypingIndicator();

  // Build API messages
  const apiMessages = chat.messages.slice(0, -1).map(m => {
    if (m.images && m.images.length) {
      const content = [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.images.map(img => ({
          type: 'image_url',
          image_url: { url: img }
        }))
      ];
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });

  // Add current user message
  const currentContent = [
    ...(text ? [{ type: 'text', text }] : []),
    ...images.map(i => ({
      type: 'image_url',
      image_url: { url: i.dataUrl }
    }))
  ];
  apiMessages.push({
    role: 'user',
    content: images.length ? currentContent : text
  });

  STATE.isStreaming = true;
  STATE.abortController = new AbortController();

  // Show stop btn
  document.getElementById('stopBtn').classList.remove('hidden');

  let assistantMsgId = `msg_${Date.now()}_ai`;
  let assistantContent = '';
  let msgGroup = null;
  let textContainer = null;

  try {
    await callGroq(
      apiMessages,
      (chunk, done) => {
        if (typingEl) typingEl.remove();

        if (!msgGroup) {
          // Create AI bubble
          const assistantMsg = { id: assistantMsgId, role: 'assistant', content: '', ts: Date.now() };
          chat.messages.push(assistantMsg);

          msgGroup = document.createElement('div');
          msgGroup.className = 'msg-group';
          msgGroup.dataset.msgId = assistantMsgId;

          const meta = document.createElement('div');
          meta.className = 'msg-meta';
          meta.innerHTML = `
            <span class="msg-role">void</span>
            <span class="msg-time">just now</span>
            <button class="copy-msg-btn" onclick="copyMsgText('${assistantMsgId}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          `;

          const bubble = document.createElement('div');
          bubble.className = 'msg-bubble assistant cursor-blink';

          textContainer = document.createElement('div');
          bubble.appendChild(textContainer);
          msgGroup.appendChild(meta);
          msgGroup.appendChild(bubble);

          const container = document.getElementById('messagesContainer');
          const empty = container.querySelector('.chat-empty-state');
          if (empty) empty.remove();
          container.appendChild(msgGroup);
        }

        if (!done) {
          assistantContent += chunk;
          textContainer.innerHTML = renderMarkdown(assistantContent);
          scrollToBottom();
        } else {
          // Finalize
          const bubble = msgGroup.querySelector('.msg-bubble');
          bubble.classList.remove('cursor-blink');
          textContainer.innerHTML = renderMarkdown(assistantContent);

          // Save to state
          const lastMsg = chat.messages[chat.messages.length - 1];
          if (lastMsg && lastMsg.id === assistantMsgId) {
            lastMsg.content = assistantContent;
            lastMsg.ts = Date.now();
          }
          chat.updatedAt = Date.now();
          STATE.stats.totalMessages++;
          save();
          updateStats();
          updateTokenCounter();
        }
      },
      STATE.abortController.signal
    );
  } catch(e) {
    if (typingEl && typingEl.isConnected) typingEl.remove();
    if (e.name !== 'AbortError') {
      const errEl = document.createElement('div');
      errEl.className = 'error-msg';
      errEl.textContent = `Error: ${e.message}`;
      document.getElementById('messagesContainer').appendChild(errEl);
      toast(e.message, 'error');
    }
  } finally {
    STATE.isStreaming = false;
    STATE.abortController = null;
    document.getElementById('stopBtn').classList.add('hidden');
    toggleSendBtn(true);
    scrollToBottom();
    renderRecentChats();
  }
}

function addTypingIndicator() {
  const container = document.getElementById('messagesContainer');
  const empty = container.querySelector('.chat-empty-state');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'msg-group';
  el.id = 'typingIndicator';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = '<span class="msg-role">void</span>';

  const ind = document.createElement('div');
  ind.className = 'typing-indicator';
  ind.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;

  el.appendChild(meta);
  el.appendChild(ind);
  container.appendChild(el);
  scrollToBottom();
  return el;
}

// ── IMAGE HANDLING ─────────────────────────────────────────────────────────
document.getElementById('imageFileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    STATE.pendingImages.push({ dataUrl, type: file.type });
    addImagePreview(dataUrl);
  }
  e.target.value = '';
  document.getElementById('imagePreviewStrip').style.display = 'flex';
});

function readFileAsDataUrl(file) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.readAsDataURL(file);
  });
}

function addImagePreview(dataUrl) {
  const strip = document.getElementById('imagePreviewStrip');
  const item = document.createElement('div');
  item.className = 'img-preview-item';
  const idx = STATE.pendingImages.length - 1;
  item.innerHTML = `
    <img src="${dataUrl}" alt="preview" />
    <button class="img-remove" onclick="removeImage(this)">✕</button>
  `;
  strip.appendChild(item);
}

window.removeImage = (btn) => {
  const item = btn.closest('.img-preview-item');
  const allItems = Array.from(document.querySelectorAll('.img-preview-item'));
  const idx = allItems.indexOf(item);
  if (idx > -1) STATE.pendingImages.splice(idx, 1);
  item.remove();
  if (!STATE.pendingImages.length) {
    document.getElementById('imagePreviewStrip').style.display = 'none';
  }
};

function clearImagePreviews() {
  STATE.pendingImages = [];
  document.getElementById('imagePreviewStrip').innerHTML = '';
  document.getElementById('imagePreviewStrip').style.display = 'none';
}

// ── INPUT AUTO-RESIZE ──────────────────────────────────────────────────────
const chatInput = document.getElementById('chatInput');

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';
  toggleSendBtn(chatInput.value.trim().length > 0 || STATE.pendingImages.length > 0);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function toggleSendBtn(enabled) {
  document.getElementById('sendBtn').disabled = !enabled;
}

// ── VIEWS ──────────────────────────────────────────────────────────────────
function showDashboard() {
  document.getElementById('dashboardView').classList.add('active');
  document.getElementById('chatView').classList.remove('active');
  document.getElementById('topbarTitle').textContent = 'Dashboard';
  document.getElementById('clearChatBtn').style.display = 'none';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-view="dashboard"]').classList.add('active');

  updateGreeting();
  renderRecentChats();
  updateStats();
}

function showChatView() {
  document.getElementById('chatView').classList.add('active');
  document.getElementById('dashboardView').classList.remove('active');
  document.getElementById('clearChatBtn').style.display = 'flex';

  const chat = STATE.currentChatId ? STATE.chats[STATE.currentChatId] : null;
  document.getElementById('topbarTitle').textContent = chat?.title || 'Chat';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-view="chat"]').classList.add('active');

  closeSidebar();
}

function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dashGreeting').textContent = g;
}

function updateStats() {
  const chats = Object.values(STATE.chats);
  document.getElementById('statChats').textContent = chats.length;
  document.getElementById('statMessages').textContent = STATE.stats.totalMessages;
  document.getElementById('statKeys').textContent = STATE.apiKeys.filter(k => k.trim()).length;
  document.getElementById('statTokens').textContent = STATE.stats.totalTokens > 1000
    ? `${(STATE.stats.totalTokens / 1000).toFixed(1)}K`
    : STATE.stats.totalTokens;
  document.getElementById('keyStatusText').textContent =
    `${STATE.apiKeys.filter(k => k.trim()).length} key${STATE.apiKeys.filter(k => k.trim()).length !== 1 ? 's' : ''} active`;
}

function updateTokenCounter() {
  document.getElementById('tokenCounter').textContent = `${STATE.stats.totalTokens.toLocaleString()} tokens`;
}

function renderRecentChats() {
  const grid = document.getElementById('recentChatsGrid');
  const chats = Object.values(STATE.chats)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);

  if (!chats.length) {
    grid.innerHTML = `<div class="empty-recent">No chats yet — start one above!</div>`;
    return;
  }

  grid.innerHTML = chats.map(c => {
    const lastMsg = c.messages[c.messages.length - 1];
    return `
      <div class="recent-chat-card" onclick="switchChat('${c.id}')">
        <div class="rcard-title">${escHtml(c.title)}</div>
        <div class="rcard-preview">${lastMsg ? escHtml(lastMsg.content.slice(0, 60)) : 'No messages'}</div>
        <div class="rcard-time">${formatTime(c.updatedAt)}</div>
      </div>
    `;
  }).join('');
}

// ── SIDEBAR TOGGLE ─────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('show');
}

function closeSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
  }
}

// ── THEME ──────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  STATE.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  save();

  // Recolor logo SVG after CSS vars are applied
  requestAnimationFrame(() => requestAnimationFrame(recolorLogo));
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function openSettings() {
  renderSettingsKeys();
  document.getElementById('settingsModel').value = STATE.model;
  document.getElementById('tempSlider').value = STATE.temperature;
  document.getElementById('tempVal').textContent = STATE.temperature;
  document.getElementById('maxTokens').value = STATE.maxTokens;
  document.getElementById('streamToggle').checked = STATE.streamEnabled;
  document.getElementById('systemPrompt').value = STATE.systemPrompt;
  document.getElementById('settingsModal').classList.remove('hidden');
}

function renderSettingsKeys() {
  const list = document.getElementById('settingsKeyList');
  const keys = STATE.apiKeys.length ? STATE.apiKeys : [''];
  list.innerHTML = keys.map((key, i) => `
    <div class="settings-key-item">
      <div class="key-status-indicator ${key.trim() ? 'active' : 'pending'}"></div>
      <input type="password" class="settings-key-input" value="${key}" placeholder="gsk_..." data-idx="${i}"
        oninput="updateKey(${i}, this.value)" autocomplete="off" spellcheck="false" />
      <button class="remove-key-btn" onclick="removeSettingsKey(${i})" style="opacity:${keys.length > 1 ? 1 : 0.3};pointer-events:${keys.length > 1 ? 'all' : 'none'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

window.updateKey = (idx, val) => {
  while (STATE.apiKeys.length <= idx) STATE.apiKeys.push('');
  STATE.apiKeys[idx] = val;
  save();
  updateStats();
};

window.removeSettingsKey = (idx) => {
  STATE.apiKeys.splice(idx, 1);
  save();
  renderSettingsKeys();
  updateStats();
};

// ── ONBOARDING ─────────────────────────────────────────────────────────────
function initOnboarding() {
  // Add key button
  document.getElementById('addKeyBtn').addEventListener('click', () => {
    const inputs = document.getElementById('keyInputs');
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `
      <div class="input-wrapper">
        <span class="key-icon">⚡</span>
        <input type="password" placeholder="gsk_..." class="api-key-input" autocomplete="off" spellcheck="false" />
        <button class="toggle-visibility" tabindex="-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <button class="remove-key-btn" onclick="this.closest('.key-row').remove()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    inputs.appendChild(row);

    // Show remove buttons on first row
    document.querySelectorAll('.remove-key-btn').forEach(b => b.classList.remove('hidden'));
    setupVisibilityToggles();
  });

  // Start button
  document.getElementById('startBtn').addEventListener('click', () => {
    const inputs = document.querySelectorAll('.api-key-input');
    const keys = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);

    if (!keys.length) { toast('Please add at least one API key', 'error'); return; }

    STATE.apiKeys = keys;
    STATE.model = document.getElementById('modelSelect').value;
    save();
    enterApp();
  });

  setupVisibilityToggles();
}

function setupVisibilityToggles() {
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.replaceWith(btn.cloneNode(true));
  });
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

function enterApp() {
  document.getElementById('onboarding').classList.remove('active');
  document.getElementById('app').classList.add('active');
  showDashboard();
  renderChatList();
  updateStats();
  applyTheme(STATE.theme);
}

// ── MAIN INIT ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  applyTheme(STATE.theme);

  // Decide screen
  if (STATE.apiKeys.filter(k => k.trim()).length > 0) {
    enterApp();
  } else {
    document.getElementById('onboarding').classList.add('active');
    initOnboarding();
  }

  // ── EVENT LISTENERS ──

  // Nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'dashboard') showDashboard();
      else if (btn.dataset.view === 'chat') {
        if (!STATE.currentChatId || !STATE.chats[STATE.currentChatId]) {
          createChat();
        }
        showChatView();
        renderMessages();
      }
      closeSidebar();
    });
  });

  // New chat
  document.getElementById('newChatBtn').addEventListener('click', () => {
    createChat();
    showChatView();
    renderMessages();
    renderChatList();
    closeSidebar();
  });

  // Send button
  document.getElementById('sendBtn').addEventListener('click', sendMessage);

  // Stop button
  document.getElementById('stopBtn').addEventListener('click', () => {
    if (STATE.abortController) STATE.abortController.abort();
  });

  // Attach image
  document.getElementById('attachImageBtn').addEventListener('click', () => {
    document.getElementById('imageFileInput').click();
  });

  // Clear chat
  document.getElementById('clearChatBtn').addEventListener('click', () => {
    if (!STATE.currentChatId || !STATE.chats[STATE.currentChatId]) return;
    if (!confirm('Clear all messages in this chat?')) return;
    STATE.chats[STATE.currentChatId].messages = [];
    save();
    renderMessages();
    toast('Chat cleared', 'success');
  });

  // Menu toggle
  document.getElementById('menuToggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    sb.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  // Sidebar overlay
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Theme picker
  document.getElementById('themePickerBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('themePicker').classList.toggle('hidden');
  });

  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      document.getElementById('themePicker').classList.add('hidden');
    });
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('themePicker').contains(e.target) &&
        e.target !== document.getElementById('themePickerBtn')) {
      document.getElementById('themePicker').classList.add('hidden');
    }
  });

  // Settings
  document.getElementById('openSettings').addEventListener('click', openSettings);

  document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('hidden');
  });

  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsModal')) {
      document.getElementById('settingsModal').classList.add('hidden');
    }
  });

  document.getElementById('settingsAddKey').addEventListener('click', () => {
    STATE.apiKeys.push('');
    renderSettingsKeys();
  });

  document.getElementById('settingsModel').addEventListener('change', (e) => {
    STATE.model = e.target.value;
    document.getElementById('chatModelSelect').value = e.target.value;
    save();
  });

  document.getElementById('tempSlider').addEventListener('input', (e) => {
    STATE.temperature = parseFloat(e.target.value);
    document.getElementById('tempVal').textContent = STATE.temperature;
    save();
  });

  document.getElementById('maxTokens').addEventListener('change', (e) => {
    STATE.maxTokens = parseInt(e.target.value) || 2048;
    save();
  });

  document.getElementById('streamToggle').addEventListener('change', (e) => {
    STATE.streamEnabled = e.target.checked;
    save();
  });

  document.getElementById('systemPrompt').addEventListener('input', (e) => {
    STATE.systemPrompt = e.target.value;
    save();
  });

  // Model select in chat
  document.getElementById('chatModelSelect').addEventListener('change', (e) => {
    STATE.model = e.target.value;
    if (STATE.currentChatId && STATE.chats[STATE.currentChatId]) {
      STATE.chats[STATE.currentChatId].model = e.target.value;
    }
    save();
  });

  // Search chats
  document.getElementById('searchChats').addEventListener('input', (e) => {
    renderChatList(e.target.value);
  });

  // Prompt cards
  document.querySelectorAll('.prompt-card').forEach(card => {
    card.addEventListener('click', () => {
      createChat();
      showChatView();
      renderMessages();
      renderChatList();
      document.getElementById('chatInput').value = card.dataset.prompt;
      toggleSendBtn(true);
      sendMessage();
    });
  });

  // Clear all data
  document.getElementById('clearAllData').addEventListener('click', () => {
    if (!confirm('Delete all chats and settings? This cannot be undone.')) return;
    localStorage.removeItem('void_state');
    location.reload();
  });

  // Export chats
  document.getElementById('exportData').addEventListener('click', () => {
    const data = JSON.stringify(STATE.chats, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `void-chats-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Sync chat model select on load
  document.getElementById('chatModelSelect').value = STATE.model;
  updateTokenCounter();
});

// ── PWA / INSTALL PROMPT ───────────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem('void_install_dismissed')) {
    setTimeout(() => document.getElementById('installBanner').classList.remove('hidden'), 3000);
  }
});

document.getElementById('installBtn')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') toast('void installed!', 'success');
  deferredPrompt = null;
  document.getElementById('installBanner').classList.add('hidden');
});

document.getElementById('dismissInstall')?.addEventListener('click', () => {
  document.getElementById('installBanner').classList.add('hidden');
  localStorage.setItem('void_install_dismissed', '1');
});

// ── SERVICE WORKER ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.log('[void] SW registered, scope:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Update available — refresh to get the latest', 'info');
            }
          });
        });
      })
      .catch(err => console.warn('[void] SW registration failed:', err));
  });
}

// ── LOGO THEME RECOLOR ─────────────────────────────────────────────────────
function recolorLogo() {
  const svg = document.getElementById('logoSvg');
  if (!svg) return;

  const style = getComputedStyle(document.documentElement);
  const a1 = style.getPropertyValue('--accent').trim();
  const a2 = style.getPropertyValue('--accent2').trim();

  // Helper: lighten a hex color by mixing with white
  function mixWhite(hex, pct) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    const nr = Math.round(r + (255-r)*pct);
    const ng = Math.round(g + (255-g)*pct);
    const nb = Math.round(b + (255-b)*pct);
    return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
  }

  const aLight = mixWhite(a1, 0.55);  // very light tint for V top
  const aMid   = mixWhite(a1, 0.25);  // mid tint

  // Update all gradient stops inside the SVG
  const updates = {
    'heroAtmo':   [[a1, 0.28], [a1, 0.06], [a1, 0]],
    'heroAtmo2':  [[a2, 0.20], [a2, 0]],
    'tipBloom':   [['#ffffff', 1], [aMid, 0.7], [a1, 0]],
    'heroVGrad':  [[aLight, 1], [aMid, 1], [a2, 1]],
    'ringGrad1':  [[a1, 0.9], [a2, 0.3], [a1, 0.05]],
  };

  for (const [id, stops] of Object.entries(updates)) {
    const grad = svg.querySelector(`#${id}`);
    if (!grad) continue;
    const stopEls = grad.querySelectorAll('stop');
    stops.forEach(([color, opacity], i) => {
      if (stopEls[i]) {
        stopEls[i].setAttribute('stop-color', color);
        if (opacity !== undefined) stopEls[i].setAttribute('stop-opacity', opacity);
      }
    });
  }

  // Update stroke colors on rings and lines
  svg.querySelectorAll('circle[stroke]').forEach(el => {
    const s = el.getAttribute('stroke');
    if (s && s.startsWith('#') && !s.includes('url') && s !== '#ffffff') {
      // Determine if it was accent1 or accent2 based on original hue
      el.setAttribute('stroke', s.includes('bf7') || s.includes('9f8') || s.includes('8a7') ? a2 : a1);
    }
  });

  // Update fill colors on decorative dots/halos (not white tip)
  svg.querySelectorAll('circle[fill]').forEach(el => {
    const f = el.getAttribute('fill');
    if (!f || f.startsWith('url') || f === 'white' || f === '#f0ecff') return;
    if (f.startsWith('#')) {
      el.setAttribute('fill', f.includes('bf7') ? a2 : a1);
    }
  });

  // Update lines (V bloom layers)
  svg.querySelectorAll('line').forEach(el => {
    const s = el.getAttribute('stroke');
    if (s && s.startsWith('#') && !s.startsWith('url')) {
      el.setAttribute('stroke', s.includes('a8') || s.includes('bf7') ? a2 : a1);
    }
  });

  // Update the background gradient for themed mood
  const heroBg = svg.querySelector('#heroBg');
  if (heroBg) {
    // Get bg3 for a subtle themed dark bg
    const bg3 = style.getPropertyValue('--bg3').trim() || '#141425';
    const stops = heroBg.querySelectorAll('stop');
    if (stops[0]) stops[0].setAttribute('stop-color', bg3);
  }
}


