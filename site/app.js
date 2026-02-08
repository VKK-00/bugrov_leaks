/**
 * Telegram Archive Viewer
 * Interactive viewer for Telegram chat export
 */

// ===================================
// State Management
// ===================================

const state = {
    manifest: null,
    currentChat: null,
    currentChatManifest: null,
    loadedChunks: new Map(), // chunkNum -> messages array
    allMessages: [],
    searchIndex: null,
    searchResults: [],

    // Visible chunk range
    minLoadedChunk: null,
    maxLoadedChunk: null
};

// ===================================
// DOM Elements
// ===================================

const elements = {
    chatList: document.getElementById('chat-list'),
    chatSearch: document.getElementById('chat-search'),
    stats: document.getElementById('stats'),

    welcomeScreen: document.getElementById('welcome-screen'),
    chatView: document.getElementById('chat-view'),
    chatTitle: document.getElementById('chat-title'),
    chatMeta: document.getElementById('chat-meta'),

    searchToggle: document.getElementById('search-toggle'),
    searchPanel: document.getElementById('search-panel'),
    messageSearch: document.getElementById('message-search'),
    searchResults: document.getElementById('search-results'),

    datePickerToggle: document.getElementById('date-picker-toggle'),
    datePanel: document.getElementById('date-panel'),
    dateInput: document.getElementById('date-input'),
    goToDate: document.getElementById('go-to-date'),

    messagesContainer: document.getElementById('messages-container'),
    messages: document.getElementById('messages'),
    loadOlder: document.getElementById('load-older'),
    loadNewer: document.getElementById('load-newer'),
    loadOlderBtn: document.getElementById('load-older-btn'),
    loadNewerBtn: document.getElementById('load-newer-btn'),

    sidebar: document.getElementById('sidebar'),
    backBtn: document.getElementById('back-btn'),

    lightbox: document.getElementById('lightbox'),
    lightboxContent: document.getElementById('lightbox-content'),
    lightboxClose: document.getElementById('lightbox-close')
};

// ===================================
// Initialization
// ===================================

async function init() {
    try {
        // Load global manifest
        const response = await fetch('./data/manifest.json');
        if (!response.ok) throw new Error('Failed to load manifest');
        state.manifest = await response.json();

        // Render chat list
        renderChatList(state.manifest.chats);

        // Update stats
        elements.stats.textContent = `${state.manifest.total_chats} чатів • ${formatNumber(state.manifest.total_messages)} повідомлень`;

        // Setup event listeners
        setupEventListeners();

        // Check for hash in URL (deep link)
        handleHashChange();

    } catch (error) {
        console.error('Initialization error:', error);
        elements.chatList.innerHTML = `<div class="loading" style="color: #ff5555;">Помилка завантаження: ${error.message}</div>`;
    }
}

function setupEventListeners() {
    // Chat search
    elements.chatSearch.addEventListener('input', (e) => {
        filterChatList(e.target.value);
    });

    // Search toggle
    elements.searchToggle.addEventListener('click', () => {
        elements.searchPanel.classList.toggle('hidden');
        elements.datePanel.classList.add('hidden');
        if (!elements.searchPanel.classList.contains('hidden')) {
            elements.messageSearch.focus();
        }
    });

    // Message search
    let searchTimeout;
    elements.messageSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchMessages(e.target.value), 300);
    });

    // Date picker toggle
    elements.datePickerToggle.addEventListener('click', () => {
        elements.datePanel.classList.toggle('hidden');
        elements.searchPanel.classList.add('hidden');
    });

    // Go to date
    elements.goToDate.addEventListener('click', () => {
        goToDate(elements.dateInput.value);
    });

    // Load more buttons
    elements.loadOlderBtn.addEventListener('click', loadOlderMessages);
    elements.loadNewerBtn.addEventListener('click', loadNewerMessages);

    // Back button (mobile)
    elements.backBtn.addEventListener('click', () => {
        elements.sidebar.classList.remove('hidden-mobile');
    });

    // Lightbox
    elements.lightboxClose.addEventListener('click', closeLightbox);
    elements.lightbox.addEventListener('click', (e) => {
        if (e.target === elements.lightbox) closeLightbox();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
            elements.searchPanel.classList.add('hidden');
            elements.datePanel.classList.add('hidden');
        }
    });

    // Hash change for deep links
    window.addEventListener('hashchange', handleHashChange);
}

// ===================================
// Chat List
// ===================================

function renderChatList(chats) {
    elements.chatList.innerHTML = chats.map(chat => `
        <div class="chat-item" data-chat-id="${chat.chat_id}">
            <div class="chat-avatar">${getInitials(chat.title)}</div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(chat.title)}</div>
                <div class="chat-preview">${formatNumber(chat.message_count)} повідомлень</div>
            </div>
            <div class="chat-meta">
                <div class="chat-date">${formatDateShort(chat.end_date)}</div>
            </div>
        </div>
    `).join('');

    // Add click handlers
    elements.chatList.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', () => {
            loadChat(item.dataset.chatId);
        });
    });
}

function filterChatList(query) {
    const q = query.toLowerCase();
    elements.chatList.querySelectorAll('.chat-item').forEach(item => {
        const name = item.querySelector('.chat-name').textContent.toLowerCase();
        item.style.display = name.includes(q) ? '' : 'none';
    });
}

// ===================================
// Chat Loading
// ===================================

async function loadChat(chatId) {
    try {
        // Update UI state
        elements.chatList.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === chatId);
        });

        // Show chat view
        elements.welcomeScreen.classList.add('hidden');
        elements.chatView.classList.remove('hidden');
        elements.sidebar.classList.add('hidden-mobile');

        // Clear previous state
        state.currentChat = chatId;
        state.loadedChunks.clear();
        state.allMessages = [];
        state.searchIndex = null;
        state.minLoadedChunk = null;
        state.maxLoadedChunk = null;
        elements.messages.innerHTML = '<div class="loading">Завантаження...</div>';

        // Load chat manifest
        const manifestResponse = await fetch(`./data/${chatId}/manifest.json`);
        if (!manifestResponse.ok) throw new Error('Failed to load chat manifest');
        state.currentChatManifest = await manifestResponse.json();

        // Update header
        elements.chatTitle.textContent = state.currentChatManifest.title;
        elements.chatMeta.textContent = `${formatNumber(state.currentChatManifest.message_count)} повідомлень • ${formatDateRange(state.currentChatManifest.start_date, state.currentChatManifest.end_date)}`;

        // Set date input bounds
        if (state.currentChatManifest.start_date) {
            elements.dateInput.min = state.currentChatManifest.start_date.split('T')[0];
        }
        if (state.currentChatManifest.end_date) {
            elements.dateInput.max = state.currentChatManifest.end_date.split('T')[0];
        }

        // Load last chunk (most recent messages)
        const lastChunkNum = state.currentChatManifest.chunk_count;
        await loadChunk(lastChunkNum);

        // Scroll to bottom
        setTimeout(() => {
            elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
        }, 100);

        // Update URL hash
        window.location.hash = chatId;

        // Load search index in background
        loadSearchIndex(chatId);

    } catch (error) {
        console.error('Error loading chat:', error);
        elements.messages.innerHTML = `<div class="loading" style="color: #ff5555;">Помилка: ${error.message}</div>`;
    }
}

async function loadChunk(chunkNum) {
    if (chunkNum < 1 || chunkNum > state.currentChatManifest.chunk_count) {
        return false;
    }

    if (state.loadedChunks.has(chunkNum)) {
        return true;
    }

    const chunkInfo = state.currentChatManifest.chunks[chunkNum - 1];
    const response = await fetch(`./data/${state.currentChat}/chunks/${chunkInfo.filename}`);
    if (!response.ok) throw new Error(`Failed to load chunk ${chunkNum}`);

    const messages = await response.json();
    state.loadedChunks.set(chunkNum, messages);

    // Update range
    if (state.minLoadedChunk === null || chunkNum < state.minLoadedChunk) {
        state.minLoadedChunk = chunkNum;
    }
    if (state.maxLoadedChunk === null || chunkNum > state.maxLoadedChunk) {
        state.maxLoadedChunk = chunkNum;
    }

    // Rebuild all messages array
    rebuildMessagesArray();

    // Render
    renderMessages();

    // Update load more buttons
    updateLoadMoreButtons();

    return true;
}

function rebuildMessagesArray() {
    state.allMessages = [];
    const sortedChunks = Array.from(state.loadedChunks.keys()).sort((a, b) => a - b);
    for (const chunkNum of sortedChunks) {
        state.allMessages.push(...state.loadedChunks.get(chunkNum));
    }
}

async function loadOlderMessages() {
    if (state.minLoadedChunk > 1) {
        const scrollHeight = elements.messagesContainer.scrollHeight;
        await loadChunk(state.minLoadedChunk - 1);
        // Maintain scroll position
        const newScrollHeight = elements.messagesContainer.scrollHeight;
        elements.messagesContainer.scrollTop = newScrollHeight - scrollHeight;
    }
}

async function loadNewerMessages() {
    if (state.maxLoadedChunk < state.currentChatManifest.chunk_count) {
        await loadChunk(state.maxLoadedChunk + 1);
    }
}

function updateLoadMoreButtons() {
    elements.loadOlder.classList.toggle('hidden', state.minLoadedChunk <= 1);
    elements.loadNewer.classList.toggle('hidden', state.maxLoadedChunk >= state.currentChatManifest.chunk_count);
}

// ===================================
// Message Rendering
// ===================================

function renderMessages() {
    let html = '';
    let lastDate = null;
    let lastSender = null;

    for (const msg of state.allMessages) {
        // Date separator
        const msgDate = msg.dt_iso ? msg.dt_iso.split('T')[0] : null;
        if (msgDate && msgDate !== lastDate) {
            html += `<div class="date-separator"><span>${formatDateFull(msg.dt_iso)}</span></div>`;
            lastDate = msgDate;
            lastSender = null;
        }

        // Service message
        if (msg.is_service) {
            html += `
                <div class="message service" id="${msg.message_id}">
                    <div class="message-bubble">${escapeHtml(msg.plain_text)}</div>
                </div>
            `;
            lastSender = null;
            continue;
        }

        // Regular message
        const isOutgoing = msg.from_name === 'Volodymyr Bugrov' || msg.from_name === 'VB';
        const showSender = msg.from_name !== lastSender;
        lastSender = msg.from_name;

        html += `
            <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}" id="${msg.message_id}">
                <div class="message-bubble">
                    ${showSender && msg.from_name ? `<div class="message-sender">${escapeHtml(msg.from_name)}</div>` : ''}
                    ${msg.reply_to ? `<div class="message-reply" data-reply-to="${msg.reply_to}">↩️ Відповідь на повідомлення</div>` : ''}
                    ${msg.forwarded_from ? `<div class="message-forward">↪️ Переслано від ${escapeHtml(msg.forwarded_from)}</div>` : ''}
                    ${msg.html_text ? `<div class="message-text">${sanitizeHtml(msg.html_text)}</div>` : ''}
                    ${renderAttachments(msg.attachments)}
                    <div class="message-meta">
                        <span class="message-time">${formatTime(msg.dt_iso)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    elements.messages.innerHTML = html;

    // Add reply click handlers
    elements.messages.querySelectorAll('.message-reply').forEach(el => {
        el.addEventListener('click', () => {
            goToMessage(el.dataset.replyTo);
        });
    });

    // Add image click handlers for lightbox
    elements.messages.querySelectorAll('.attachment-photo').forEach(img => {
        img.addEventListener('click', () => openLightbox(img.src));
    });
}

function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';

    return `<div class="message-attachments">${attachments.map(att => {
        switch (att.kind) {
            case 'photo':
                return `
                    <div class="attachment">
                        <img src="${att.href}" alt="Photo" class="attachment-photo" loading="lazy">
                    </div>
                `;
            case 'sticker':
                // Check if it's an animated sticker
                if (att.href.endsWith('.tgs')) {
                    return `
                        <div class="attachment">
                            <div class="attachment-file">
                                <span class="attachment-file-icon">🎭</span>
                                <span class="attachment-file-name">Animated Sticker</span>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="attachment">
                        <img src="${att.href}" alt="Sticker" class="attachment-sticker" loading="lazy">
                    </div>
                `;
            case 'video':
            case 'round_video':
                return `
                    <div class="attachment">
                        <video src="${att.href}" controls class="attachment-video" preload="metadata">
                            ${att.duration ? `<span>${att.duration}</span>` : ''}
                        </video>
                    </div>
                `;
            case 'voice':
                return `
                    <div class="attachment">
                        <audio src="${att.href}" controls class="attachment-audio" preload="metadata"></audio>
                    </div>
                `;
            case 'file':
            default:
                return `
                    <div class="attachment">
                        <a href="${att.href}" class="attachment-file" download>
                            <span class="attachment-file-icon">📎</span>
                            <span class="attachment-file-name">${escapeHtml(att.title || 'File')}</span>
                        </a>
                    </div>
                `;
        }
    }).join('')}</div>`;
}

// ===================================
// Search
// ===================================

async function loadSearchIndex(chatId) {
    try {
        const response = await fetch(`./data/${chatId}/search.json`);
        if (response.ok) {
            state.searchIndex = await response.json();
        }
    } catch (error) {
        console.warn('Failed to load search index:', error);
    }
}

function searchMessages(query) {
    if (!query || query.length < 2 || !state.searchIndex) {
        elements.searchResults.innerHTML = '';
        return;
    }

    const q = query.toLowerCase();
    const results = state.searchIndex
        .filter(item => item.text.toLowerCase().includes(q))
        .slice(0, 50); // Limit results

    if (results.length === 0) {
        elements.searchResults.innerHTML = '<div class="loading">Нічого не знайдено</div>';
        return;
    }

    elements.searchResults.innerHTML = results.map(item => `
        <div class="search-result" data-message-id="${item.id}">
            <span class="search-result-from">${escapeHtml(item.from || 'Unknown')}</span>
            <span class="search-result-date">${item.dt || ''}</span>
            <div class="search-result-text">${highlightText(item.text, query)}</div>
        </div>
    `).join('');

    // Add click handlers
    elements.searchResults.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
            goToMessage(el.dataset.messageId);
            elements.searchPanel.classList.add('hidden');
        });
    });
}

function highlightText(text, query) {
    const escaped = escapeHtml(text);
    const pattern = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escaped.replace(pattern, '<mark>$1</mark>');
}

// ===================================
// Navigation
// ===================================

async function goToMessage(messageId) {
    // First check if message is already loaded
    let messageEl = document.getElementById(messageId);

    if (!messageEl) {
        // Find which chunk contains this message
        const chunkIndex = state.currentChatManifest.chunks.findIndex(chunk => {
            const startNum = parseInt(chunk.start_id?.replace('message', '') || '0');
            const endNum = parseInt(chunk.end_id?.replace('message', '') || '0');
            const targetNum = parseInt(messageId.replace('message', '') || '0');
            return targetNum >= startNum && targetNum <= endNum;
        });

        if (chunkIndex !== -1) {
            await loadChunk(chunkIndex + 1);
            messageEl = document.getElementById(messageId);
        }
    }

    if (messageEl) {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageEl.classList.add('highlighted');
        setTimeout(() => messageEl.classList.remove('highlighted'), 3000);
    }
}

async function goToDate(dateStr) {
    if (!dateStr || !state.searchIndex) return;

    // Find first message on or after this date
    const targetDate = new Date(dateStr);

    for (const item of state.searchIndex) {
        if (item.dt) {
            const itemDate = new Date(item.dt);
            if (itemDate >= targetDate) {
                await goToMessage(item.id);
                elements.datePanel.classList.add('hidden');
                return;
            }
        }
    }
}

function handleHashChange() {
    const hash = window.location.hash.slice(1);
    if (hash && state.manifest) {
        const chat = state.manifest.chats.find(c => c.chat_id === hash);
        if (chat) {
            loadChat(hash);
        }
    }
}

// ===================================
// Lightbox
// ===================================

function openLightbox(src) {
    elements.lightboxContent.innerHTML = `<img src="${src}" alt="Full size image">`;
    elements.lightbox.classList.remove('hidden');
}

function closeLightbox() {
    elements.lightbox.classList.add('hidden');
    elements.lightboxContent.innerHTML = '';
}

// ===================================
// Utility Functions
// ===================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function sanitizeHtml(html) {
    // Basic sanitization - allow only safe tags
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, '');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString('uk-UA');
}

function formatTime(isoDate) {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(isoDate) {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    const now = new Date();
    const diff = now - date;

    if (diff < 86400000 && date.getDate() === now.getDate()) {
        return formatTime(isoDate);
    }

    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
    }

    return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatDateFull(isoDate) {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return date.toLocaleDateString('uk-UA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function formatDateRange(start, end) {
    if (!start || !end) return '';
    const startDate = new Date(start);
    const endDate = new Date(end);

    const startStr = startDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
    const endStr = endDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });

    return `${startStr} — ${endStr}`;
}

function getInitials(name) {
    if (!name) return '?';
    const words = name.split(/\s+/);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

// ===================================
// Start Application
// ===================================

document.addEventListener('DOMContentLoaded', init);
