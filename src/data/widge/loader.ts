/**
 * Script del widget exportado como string.
 * URLs opacas — el token JWT es la única superficie visible.
 *   /widget/v?t=TOKEN  → este loader
 *   /widget/r?t=TOKEN  → resolve config
 */
export const WIDGET_LOADER_SCRIPT = /* js */ `
(function () {
  'use strict';

  // ─── Leer token y base desde la URL del propio script ────────────────────
  function getScriptParams() {
    const scripts = document.querySelectorAll('script[src*="/widget/v"]');
    for (const script of scripts) {
      const url   = new URL(script.src);
      const token = url.searchParams.get('t');
      if (token) return { token, base: url.origin };
    }
    console.error('[ChatWidget] No se encontró el parámetro t en la URL del script.');
    return null;
  }

  const params = getScriptParams();
  if (!params) return;

  const { token, base } = params;

  // ─── Estado ──────────────────────────────────────────────────────────────
  const state = {
    open:        false,
    sessionId:   null,
    visitorId:   'visitor_' + Math.random().toString(36).slice(2),
    config:      null,
    botConfigId: null,
    companyId:   null,
    messages:    [],
    loading:     false,
  };

  // ─── Desenvuelve el wrapper { success, data, ... } del interceptor ────────
  function unwrap(raw) {
    return (raw && typeof raw === 'object' && 'data' in raw) ? raw.data : raw;
  }

  // ─── Fetch config /widget/r ───────────────────────────────────────────────
  async function loadConfig() {
    try {
      const res = await fetch(base + '/widget/r?t=' + token);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = unwrap(await res.json());
      state.config      = data;
      state.botConfigId = data.botConfigId;
      state.companyId   = data.companyId;
      return data;
    } catch (err) {
      console.error('[ChatWidget] Error al cargar configuración:', err);
      return null;
    }
  }

  // ─── Enviar mensaje al engine ─────────────────────────────────────────────
  async function sendMessage(text) {
    if (!state.botConfigId || !state.companyId) {
      console.error('[ChatWidget] botConfigId o companyId no disponibles.');
      state.messages.push({ role: 'bot', text: 'Error de configuración del widget.' });
      renderMessages();
      return;
    }

    state.loading = true;
    renderMessages();

    try {
      const res = await fetch(base + '/chat/widget/' + state.companyId + '/' + state.botConfigId, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message:   text,
          visitorId: state.visitorId,
          sessionId: state.sessionId ?? undefined,
        }),
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = unwrap(await res.json());

      if (data.sessionId) state.sessionId = data.sessionId;

      const botTexts = (data.messages ?? [{ text: data.message }])
        .map(function (m) { return m.text; })
        .filter(function (t) { return t && t.trim(); });

      for (const t of botTexts) {
        state.messages.push({ role: 'bot', text: t });
      }

      if (data.done) state.sessionId = null;

    } catch (err) {
      console.error('[ChatWidget] Error al enviar mensaje:', err);
      state.messages.push({ role: 'bot', text: 'Hubo un error. Intenta de nuevo.' });
    } finally {
      state.loading = false;
      renderMessages();
      scrollToBottom();
    }
  }

  // ─── DOM / Shadow DOM ─────────────────────────────────────────────────────
  let shadow, messagesEl, inputEl;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildWidget(config) {
    const host = document.createElement('div');
    host.id    = 'chat-widget-host';
    Object.assign(host.style, {
      position:   'fixed',
      zIndex:     '2147483647',
      bottom:     '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    host.style[config.position === 'bottom-left' ? 'left' : 'right'] = '24px';

    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const primary   = config.primaryColor   || '#3B82F6';
    const secondary = config.secondaryColor || '#F3F4F6';

    shadow.innerHTML = \`
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        #toggle-btn {
          width: 56px; height: 56px; border-radius: 50%;
          background: \${primary}; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(0,0,0,.20); margin-left: auto;
          transition: transform .2s, box-shadow .2s;
        }
        #toggle-btn:hover { transform: scale(1.08); }
        #toggle-btn svg { width: 26px; height: 26px; fill: #fff; }
        #chat-window {
          width: 360px; height: 520px; border-radius: 16px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,.18);
          display: flex; flex-direction: column;
          margin-bottom: 12px; background: #fff;
          opacity: 0; transform: translateY(12px) scale(.97);
          transition: opacity .22s ease, transform .22s ease;
          pointer-events: none;
        }
        #chat-window.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: all; }
        #header {
          background: \${primary}; padding: 14px 16px;
          display: flex; align-items: center; gap: 10px; flex-shrink: 0;
        }
        #header img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
        #header-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(255,255,255,.25);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        #header-avatar svg { width: 18px; height: 18px; fill: #fff; }
        #header-name { color: #fff; font-size: 15px; font-weight: 600; flex: 1; }
        #close-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,.8); font-size: 20px; line-height: 1;
          padding: 2px 4px; border-radius: 4px; transition: color .15s;
        }
        #close-btn:hover { color: #fff; }
        #messages {
          flex: 1; overflow-y: auto; padding: 16px 14px;
          display: flex; flex-direction: column; gap: 10px; background: #fafafa;
        }
        #messages::-webkit-scrollbar { width: 4px; }
        #messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        .msg { max-width: 80%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45; word-break: break-word; }
        .msg.bot  { background: \${secondary}; color: #1a1a1a; align-self: flex-start; border-bottom-left-radius: 4px; }
        .msg.user { background: \${primary};   color: #fff;    align-self: flex-end;   border-bottom-right-radius: 4px; }
        .typing { display: flex; gap: 5px; align-items: center; padding: 10px 14px; }
        .typing span { width: 7px; height: 7px; border-radius: 50%; background: #aaa; animation: bounce .9s infinite ease-in-out; }
        .typing span:nth-child(2) { animation-delay: .15s; }
        .typing span:nth-child(3) { animation-delay: .30s; }
        @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
        #input-area {
          display: flex; gap: 8px; padding: 12px 14px;
          border-top: 1px solid #ebebeb; background: #fff; flex-shrink: 0;
        }
        #input-field {
          flex: 1; border: 1.5px solid #e0e0e0; border-radius: 10px;
          padding: 9px 13px; font-size: 14px; outline: none;
          transition: border-color .18s; resize: none; font-family: inherit;
          line-height: 1.4; max-height: 96px; overflow-y: auto;
        }
        #input-field:focus { border-color: \${primary}; }
        #send-btn {
          width: 38px; height: 38px; border-radius: 10px;
          background: \${primary}; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; align-self: flex-end; transition: opacity .15s;
        }
        #send-btn:disabled { opacity: .45; cursor: default; }
        #send-btn svg { width: 18px; height: 18px; fill: #fff; }
      </style>

      <div id="chat-window">
        <div id="header">
          \${config.logoUrl
            ? '<img src="' + escapeHtml(config.logoUrl) + '" alt="logo" />'
            : '<div id="header-avatar"><svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>'
          }
          <span id="header-name">\${escapeHtml(config.displayName)}</span>
          <button id="close-btn" aria-label="Cerrar">&#x2715;</button>
        </div>
        <div id="messages"></div>
        <div id="input-area">
          <textarea id="input-field" placeholder="Escribe un mensaje..." rows="1"></textarea>
          <button id="send-btn" aria-label="Enviar">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>

      <button id="toggle-btn" aria-label="Abrir chat">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      </button>
    \`;

    messagesEl = shadow.getElementById('messages');
    inputEl    = shadow.getElementById('input-field');

    const toggleBtn  = shadow.getElementById('toggle-btn');
    const closeBtn   = shadow.getElementById('close-btn');
    const chatWindow = shadow.getElementById('chat-window');

    function toggleOpen() {
      state.open = !state.open;
      chatWindow.classList.toggle('open', state.open);
      if (state.open) {
        inputEl.focus();
        if (state.messages.length === 0) sendMessage('');
      }
    }

    toggleBtn.addEventListener('click', toggleOpen);
    closeBtn.addEventListener('click',  toggleOpen);

    shadow.getElementById('send-btn').addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    inputEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 96) + 'px';
    });
  }

  function handleSend() {
    if (state.loading) return;
    const text = inputEl.value.trim();
    if (!text) return;
    state.messages.push({ role: 'user', text: text });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    renderMessages();
    scrollToBottom();
    sendMessage(text);
  }

  function renderMessages() {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    for (const msg of state.messages) {
      const div = document.createElement('div');
      div.className   = 'msg ' + msg.role;
      div.textContent = msg.text;
      messagesEl.appendChild(div);
    }
    if (state.loading) {
      const t = document.createElement('div');
      t.className = 'msg bot typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      messagesEl.appendChild(t);
    }
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  async function init() {
    const config = await loadConfig();
    if (!config) return;
    buildWidget(config);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
`;