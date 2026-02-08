/**
 * Telegram Web K Clone
 * Logic for rendering messages and chat lists
 */

const state = {
    manifest: null,
    currentChat: null,
    currentChatManifest: null,
    loadedChunks: new Map(),
    allMessages: [],
    searchIndex: [],
    minLoadedChunk: null,
    maxLoadedChunk: null
};

const elements = {
    sidebar: document.getElementById('sidebar'),
    chatList: document.getElementById('chat-list'),
    chatSearch: document.getElementById('chat-search'),

    mainContainer: document.getElementById('main-container'),
    welcomePlaceholder: document.getElementById('welcome-placeholder'),
    chatHeader: document.getElementById('chat-header'),
    chatTitle: document.getElementById('chat-title'),
    chatStatus: document.getElementById('chat-status'),
    headerBackBtn: document.getElementById('header-back-btn'),

    messagesWrapper: document.getElementById('messages-wrapper'),
    messagesList: document.getElementById('messages-list'),

    loadOlder: document.getElementById('load-older'),
    loadNewer: document.getElementById('load-newer'),

    lightbox: document.getElementById('lightbox'),
    lightboxContent: document.getElementById('lightbox-content')
};

// ===================================
// Initialization
// ===================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        const response = await fetch('data/manifest.json');
        if (!response.ok) throw new Error('Failed to load manifest');

        state.manifest = await response.json();
        renderChatList(state.manifest.chats);

        setupEventListeners();
        handleHashChange();

    } catch (err) {
        console.error(err);
        elements.chatList.innerHTML = `<div class="error">Error loading chats: ${err.message}</div>`;
    }
}

function setupEventListeners() {
    // Chat search filter
    elements.chatSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.chat-item').forEach(item => {
            const title = item.querySelector('.chat-name').textContent.toLowerCase();
            item.style.display = title.includes(query) ? 'flex' : 'none';
        });
    });

    // Mobile back button
    elements.headerBackBtn.addEventListener('click', () => {
        document.body.classList.remove('view-chat');
        window.history.pushState(null, null, '#');
    });

    // Lightbox
    elements.lightbox.addEventListener('click', (e) => {
        if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') {
            elements.lightbox.classList.add('hidden');
            elements.lightboxContent.innerHTML = '';
        }
    });

    // Hash change
    window.addEventListener('hashchange', handleHashChange);
}

function handleHashChange() {
    const hash = window.location.hash.slice(1);
    if (hash && state.manifest) {
        loadChat(hash);
    } else {
        document.body.classList.remove('view-chat');
    }
}

// ===================================
// Rendering
// ===================================

function renderChatList(chats) {
    elements.chatList.innerHTML = chats.map(chat => {
        // Generate a stable color based on chat title
        const colors = [
            'linear-gradient(135deg, #FF516A 0%, #F23B55 100%)', // Red
            'linear-gradient(135deg, #FF885E 0%, #FF516A 100%)', // Orange
            'linear-gradient(135deg, #54CB68 0%, #A0DE7E 100%)', // Green
            'linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)', // Blue
            'linear-gradient(135deg, #665FFF 0%, #82B1FF 100%)', // Purple
            'linear-gradient(135deg, #46D2F4 0%, #5AC8FB 100%)', // Cyan
        ];
        const colorIndex = Math.abs(hashCode(chat.title)) % colors.length;
        const bgStyle = `background: ${colors[colorIndex]}`;
        const initials = getInitials(chat.title);

        return `
            <div class="chat-item" data-id="${chat.chat_id}" onclick="loadChat('${chat.chat_id}')">
                <div class="chat-avatar-container">
                    <div class="chat-avatar" style="${bgStyle}">${initials}</div>
                </div>
                <div class="chat-content">
                    <div class="chat-header-row">
                        <span class="chat-name">${escapeHtml(chat.title)}</span>
                        <span class="chat-time">${formatDateShort(chat.end_date)}</span>
                    </div>
                    <div class="chat-meta-row">
                        <span class="chat-preview">${chat.message_count} messages</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadChat(chatId) {
    if (state.currentChat === chatId) return;

    // Update UI for loading state
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === chatId);
    });

    elements.welcomePlaceholder.style.display = 'none';
    elements.chatHeader.classList.remove('hidden');
    elements.messagesWrapper.classList.remove('hidden');
    document.body.classList.add('view-chat');

    state.currentChat = chatId;
    state.loadedChunks.clear();
    state.allMessages = [];
    state.minLoadedChunk = null;
    state.maxLoadedChunk = null;

    elements.messagesList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--tg-text-secondary);">Loading...</div>';

    try {
        // Fetch manifest
        const req = await fetch(`data/${chatId}/manifest.json`);
        state.currentChatManifest = await req.json();

        // Update Header
        elements.chatTitle.textContent = state.currentChatManifest.title;
        elements.chatStatus.textContent = `${formatNumber(state.currentChatManifest.message_count)} messages`;

        // Load last chunk
        const lastChunk = state.currentChatManifest.chunk_count;
        await loadChunk(lastChunk);

        // Scroll to bottom
        requestAnimationFrame(() => {
            elements.messagesWrapper.scrollTop = elements.messagesWrapper.scrollHeight;
        });

        window.location.hash = chatId;

        // Load search index in bg
        fetch(`data/${chatId}/search.json`).then(r => r.json()).then(idx => state.searchIndex = idx).catch(() => { });

    } catch (err) {
        console.error(err);
        elements.messagesList.innerHTML = `<div class="error">Failed to load chat: ${err.message}</div>`;
    }
}

async function loadChunk(chunkNum) {
    if (chunkNum < 1 || chunkNum > state.currentChatManifest.chunk_count) return;
    if (state.loadedChunks.has(chunkNum)) return;

    const chunkInfo = state.currentChatManifest.chunks[chunkNum - 1];
    const res = await fetch(`data/${state.currentChat}/chunks/${chunkInfo.filename}`);
    const msgs = await res.json();

    state.loadedChunks.set(chunkNum, msgs);

    if (state.minLoadedChunk === null || chunkNum < state.minLoadedChunk) state.minLoadedChunk = chunkNum;
    if (state.maxLoadedChunk === null || chunkNum > state.maxLoadedChunk) state.maxLoadedChunk = chunkNum;

    rebuildMessages();
}

function rebuildMessages() {
    // Sort chunks and flatten
    const sortedKeys = Array.from(state.loadedChunks.keys()).sort((a, b) => a - b);
    state.allMessages = [];
    sortedKeys.forEach(k => {
        state.allMessages.push(...state.loadedChunks.get(k));
    });

    renderMessages(state.allMessages);
}

function renderMessages(messages) {
    let html = '';
    let lastDate = null;
    let lastSender = null;
    let lastTime = 0;

    messages.forEach((msg, index) => {
        const msgDate = msg.dt_iso ? msg.dt_iso.split('T')[0] : null;
        const msgTime = msg.dt_iso ? new Date(msg.dt_iso).getTime() : 0;

        // Sticky Date Header
        if (msgDate && msgDate !== lastDate) {
            html += `<div class="date-sticky"><span class="date-badge">${formatDateFull(msg.dt_iso)}</span></div>`;
            lastDate = msgDate;
            lastSender = null; // Reset grouping on new day
        }

        if (msg.is_service) {
            html += `<div class="date-sticky"><span class="date-badge">${escapeHtml(msg.plain_text)}</span></div>`;
            return;
        }

        // Grouping Logic
        const isOutgoing = (msg.from_name === 'Volodymyr Bugrov' || msg.from_name === 'VB');
        const sameSender = (msg.from_name === lastSender);
        const timeDiff = (msgTime - lastTime) / 1000 / 60; // minutes
        const isGroup = sameSender && timeDiff < 10;

        let rowClass = isOutgoing ? 'outgoing' : 'incoming';
        if (isGroup) {
            rowClass += ' group-middle';
        } else {
            rowClass += ' group-first';
        }

        // Look ahead for next message to see if this is "last" in group
        const nextMsg = messages[index + 1];
        let isLastInGroup = true;
        if (nextMsg && !nextMsg.is_service) {
            const nextIsOutgoing = (nextMsg.from_name === 'Volodymyr Bugrov' || nextMsg.from_name === 'VB');
            const nextSender = nextMsg.from_name;
            const nextTime = nextMsg.dt_iso ? new Date(nextMsg.dt_iso).getTime() : 0;
            const nextDiff = (nextTime - msgTime) / 1000 / 60;

            if (nextIsOutgoing === isOutgoing && nextSender === msg.from_name && nextDiff < 10 && (nextMsg.dt_iso?.split('T')[0] === msgDate)) {
                isLastInGroup = false;
            }
        }

        if (isLastInGroup) rowClass += ' group-last';

        lastSender = msg.from_name;
        lastTime = msgTime;

        // Render content
        html += `
            <div class="message-row ${rowClass}" id="${msg.message_id}">
                <div class="bubble">
                    ${isLastInGroup ? '<svg class="bubble-tail" viewBox="0 0 11 20"><path d="M1 20c-.1-5 2.5-9.3 5-11 3.5-1.5 5 0 5 0V6a7 7 0 0 0-7 7v7z"/></svg>' : ''}
                    
                    ${(!isOutgoing && !isGroup && msg.from_name) ? `<div class="sender-name">${escapeHtml(msg.from_name)}</div>` : ''}
                    
                    ${msg.reply_to ? `<div class="reply-preview" onclick="scrollToMsg('${msg.reply_to}')">
                        <div class="reply-name">Reply</div>
                        <div class="reply-text">Click to view</div>
                    </div>` : ''}
                    
                    ${renderAttachments(msg.attachments)}
                    
                    ${msg.html_text ? `<div class="message-text">${formatMessageText(msg.html_text)}
                        <span class="message-meta">
                            ${formatTime(msg.dt_iso)}
                            ${isOutgoing ? '<svg class="icon icon-xs" style="fill:#59b1f7;"><use href="#icon-double-check"></use></svg>' : ''}
                        </span>
                    </div>` :
                // If no text, meta goes separate
                `<div class="message-meta" style="float:right;">
                        ${formatTime(msg.dt_iso)}
                        ${isOutgoing ? '<svg class="icon icon-xs" style="fill:#59b1f7;"><use href="#icon-double-check"></use></svg>' : ''}
                    </div>`
            }
                </div>
            </div>
        `;
    });

    elements.messagesList.innerHTML = html;
}


function renderAttachments(atts) {
    if (!atts || !atts.length) return '';

    return `<div class="media-grid">` + atts.map(att => {
        if (att.kind === 'photo' || att.kind === 'sticker') {
            return `<img src="${att.href}" class="media-photo" onclick="openLightbox('${att.href}')" loading="lazy">`;
        } else if (att.kind === 'video' || att.kind === 'round_video') {
            return `<video src="${att.href}" class="media-photo" controls></video>`;
        } else {
            return `<a href="${att.href}" class="media-file" download>
                <div class="file-icon">${att.href.split('.').pop().toUpperCase()}</div>
                <div class="file-info">${escapeHtml(att.title || 'File')}</div>
             </a>`;
        }
    }).join('') + `</div>`;
}

// ===================================
// Utils
// ===================================

function scrollToMsg(id) {
    const el = document.getElementById(id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.querySelector('.bubble').style.animation = 'highlight 1s';
    }
}

function openLightbox(src) {
    elements.lightboxContent.innerHTML = `<img src="${src}" style="max-width:100%; max-height:90vh;">`;
    elements.lightbox.classList.remove('hidden');
}

function escapeHtml(str) {
    return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : '';
}

function formatMessageText(html) {
    // Basic sanitization and line break handling
    // Telegram export usually has clean HTML, but links need checking
    const div = document.createElement('div');
    div.innerHTML = html;

    // Safety: remove scripts
    div.querySelectorAll('script').forEach(s => s.remove());

    // Add target=_blank to links
    div.querySelectorAll('a').forEach(a => a.setAttribute('target', '_blank'));

    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

function getInitials(name) {
    return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function formatDateShort(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function formatDateFull(iso) {
    if (!iso) return 'Unknown Date';
    return new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
