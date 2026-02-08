const app = {
    state: {
        chats: [],
        currentChatId: null,
        currentChatMessages: [],
        chunksLoaded: new Set(),
        messageMap: new Map(),
        lastRenderedDate: null
    },

    init: async function () {
        console.log("App initializing...");
        await this.loadManifest();
        this.renderSidebar();

        window.addEventListener('hashchange', () => this.handleHashChange());
        this.handleHashChange();

        const searchInput = document.getElementById('chat-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.renderSidebar(e.target.value);
            });
        }

        const msgSearchInput = document.getElementById('msg-search-input');
        if (msgSearchInput) {
            msgSearchInput.addEventListener('input', (e) => {
                this.filterMessages(e.target.value);
            });
        }
    },

    loadManifest: async function () {
        try {
            const response = await fetch('data/manifest.json');
            if (!response.ok) throw new Error('Manifest not found');
            const data = await response.json();
            this.state.chats = data.chats || [];
        } catch (error) {
            console.error('Failed to load manifest:', error);
            document.getElementById('chat-list').innerHTML = '<div style="padding: 10px; color: #f00;">Error loading chats. Make sure build.py was run.</div>';
        }
    },

    handleHashChange: function () {
        const hash = window.location.hash.substring(1);
        if (hash) {
            this.loadChat(hash);
        } else {
            this.state.currentChatId = null;
            document.getElementById('messages-container').innerHTML =
                '<div class="empty-state"><p>Select a chat from the sidebar</p></div>';
            document.getElementById('chat-header').style.display = 'none';
            document.getElementById('fab-container').style.display = 'none';
        }
    },

    renderSidebar: function (filterText = '') {
        const list = document.getElementById('chat-list');
        list.innerHTML = '';
        const chats = this.state.chats.filter(c =>
            (c.title || 'Unknown').toLowerCase().includes(filterText.toLowerCase())
        );

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = `chat-item ${this.state.currentChatId === chat.chat_id ? 'active' : ''}`;
            item.onclick = () => window.location.hash = chat.chat_id;

            const initials = this.getInitials(chat.title);
            const colorIndex = (parseInt(chat.chat_id.replace(/\D/g, '') || '0') % 8) + 1;

            item.innerHTML = `
                <div class="avatar userpic${colorIndex}">${initials}</div>
                <div class="chat-preview">
                    <div class="chat-name">${this.escapeHtml(chat.title || 'Unknown Header')}</div>
                    <div class="last-message">${chat.message_count} messages</div>
                </div>
            `;
            list.appendChild(item);
        });
    },

    loadChat: async function (chatId) {
        if (this.state.currentChatId === chatId && this.state.currentChatMessages.length > 0) return;

        this.state.currentChatId = chatId;
        this.state.chunksLoaded.clear();
        this.state.currentChatMessages = [];
        this.state.messageMap.clear();
        this.state.lastRenderedDate = null;

        this.renderSidebar();
        document.getElementById('fab-container').style.display = 'flex';
        document.getElementById('search-bar-chat').style.display = 'none';

        const chat = this.state.chats.find(c => c.chat_id === chatId);
        const header = document.getElementById('chat-header');
        header.style.display = 'flex';
        header.querySelector('.chat-title').textContent = chat ? chat.title : 'Unknown Chat';
        header.querySelector('.chat-status').textContent = chat ? `${chat.message_count} messages` : '';

        const container = document.getElementById('messages-container');
        container.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            const response = await fetch(`data/${chatId}/manifest.json`);
            if (!response.ok) throw new Error('Chat manifest not found');
            const manifest = await response.json();

            container.innerHTML = '';

            for (const chunk of manifest.chunks) {
                await this.loadChunk(chatId, chunk.filename);
            }

            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 100);

        } catch (e) {
            console.error('Error loading chat:', e);
            container.innerHTML = '<div class="empty-state">Error loading chat data</div>';
        }
    },

    loadChunk: async function (chatId, filename) {
        if (this.state.chunksLoaded.has(filename)) return;

        try {
            const response = await fetch(`data/${chatId}/chunks/${filename}`);
            if (!response.ok) return;
            const messages = await response.json();

            this.state.chunksLoaded.add(filename);

            messages.forEach(m => {
                this.state.currentChatMessages.push(m);
                if (m.message_id) this.state.messageMap.set(m.message_id, m);
            });

            this.renderMessages(messages);
        } catch (e) {
            console.error('Error loading chunk:', e);
        }
    },

    formatDateHeader: function (isoString) {
        const date = new Date(isoString);
        // Format: "27 March 2021"
        const day = date.getDate();
        const month = date.toLocaleString('default', { month: 'long' });
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    },

    renderMessages: function (messages) {
        const container = document.getElementById('messages-container');

        messages.forEach(msg => {
            // Date Header
            if (msg.dt_iso) {
                const dateKey = msg.dt_iso.split('T')[0];
                if (dateKey !== this.state.lastRenderedDate) {
                    const dateDiv = document.createElement('div');
                    dateDiv.className = 'date-header';
                    dateDiv.textContent = this.formatDateHeader(msg.dt_iso);
                    container.appendChild(dateDiv);
                    this.state.lastRenderedDate = dateKey;
                }
            }

            const msgDiv = document.createElement('div');
            if (msg.dt_iso) msgDiv.dataset.date = msg.dt_iso.split('T')[0];
            if (msg.message_id) msgDiv.id = msg.message_id;

            if (msg.is_service) {
                msgDiv.className = 'service-message';
                msgDiv.dataset.isServiceMsg = "true";
                msgDiv.textContent = msg.plain_text;
            } else {
                // Sender Logic
                // If name contains "Volodymyr Bugrov", treat as outgoing (right side)
                const isBugrov = msg.from_name &&
                    (msg.from_name.includes('Volodymyr Bugrov') || msg.from_name.includes('Bugrov'));

                msgDiv.className = `message ${isBugrov ? 'outgoing' : 'incoming'}`;

                let content = '';

                // Reply Logic
                if (msg.reply_to) {
                    const replyMsg = this.state.messageMap.get(msg.reply_to);
                    const replyName = replyMsg ? (replyMsg.from_name || 'Someone') : 'Message';
                    const replyText = replyMsg ? (replyMsg.plain_text || 'Media') : '...';

                    content += `
                        <div class="reply-preview" onclick="app.scrollToMessage('${msg.reply_to}')">
                            <div style="color: var(--link-color); font-size: 12px; font-weight: 500;">${this.escapeHtml(replyName)}</div>
                            <div style="font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${this.escapeHtml(replyText)}</div>
                        </div>`;
                }

                // Name (only for incoming messages usually, but in group chats we show names)
                if (!isBugrov && msg.from_name) {
                    content += `<span class="message-sender">${this.escapeHtml(msg.from_name)}</span>`;
                }

                const hasAttachments = msg.attachments && msg.attachments.length > 0;

                // Media
                if (hasAttachments) {
                    msg.attachments.forEach(att => {
                        content += this.renderAttachment(att);
                    });
                }

                // Text Logic: Avoid duplication
                let textToShow = null;
                if (hasAttachments) {
                    // Use plain_text as caption
                    if (msg.plain_text && msg.plain_text.trim().length > 0) {
                        textToShow = this.escapeHtml(msg.plain_text);
                    }
                } else {
                    // No attachments, use html_text if available (preserves links), otherwise plain
                    if (msg.html_text) {
                        textToShow = msg.html_text; // Already trusted from source
                    } else if (msg.plain_text) {
                        textToShow = this.escapeHtml(msg.plain_text);
                    }
                }

                if (textToShow) {
                    content += `<div class="message-content">${textToShow}</div>`;
                }

                // Timestamp
                if (msg.dt_iso) {
                    const time = msg.dt_iso.split('T')[1].substring(0, 5);
                    content += `<div class="message-meta">${time}</div>`;
                }

                msgDiv.innerHTML = content;
            }
            container.appendChild(msgDiv);
        });
    },

    renderAttachment: function (att) {
        if (att.kind === 'photo') {
            return `<div class="media-container"><img src="${att.href}" class="media-photo" loading="lazy"></div>`;
        } else if (att.kind === 'video' || att.kind === 'round_video') {
            return `<div class="media-container"><video src="${att.href}" controls class="media-video"></video></div>`;
        } else if (att.kind === 'voice') {
            return `<div class="media-container"><audio src="${att.href}" controls></audio></div>`;
        } else {
            return `<div class="media-container"><a href="${att.href}" target="_blank" style="color: var(--link-color)">📄 ${att.kind}</a></div>`;
        }
    },

    scrollToMessage: function (msgId) {
        const el = document.getElementById(msgId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2000);
        }
    },

    toggleSearch: function () {
        const bar = document.getElementById('search-bar-chat');
        bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
        if (bar.style.display === 'block') document.getElementById('msg-search-input').focus();
    },

    filterMessages: function (text) {
        const container = document.getElementById('messages-container');
        const msgs = container.querySelectorAll('.message');
        if (!text) {
            container.classList.remove('searching');
            msgs.forEach(m => m.classList.remove('match'));
            return;
        }

        container.classList.add('searching');
        msgs.forEach(m => {
            if (m.textContent.toLowerCase().includes(text.toLowerCase())) {
                m.classList.add('match');
            } else {
                m.classList.remove('match');
            }
        });
    },

    showCalendar: function () {
        document.getElementById('calendar-modal').style.display = 'flex';
        const input = document.getElementById('calendar-input');

        // Hightlight logic would go here if specialized calendar used.
        // For native input, we can't easily highlight, but we can restrict min/max
        const first = this.state.currentChatMessages[0];
        const last = this.state.currentChatMessages[this.state.currentChatMessages.length - 1];

        if (first && first.dt_iso) input.min = first.dt_iso.split('T')[0];
        if (last && last.dt_iso) input.max = last.dt_iso.split('T')[0];

        // Warning: This simple native picker doesn't "show only dates with messages". 
        // Just limits range.
    },

    jumpToDate: function () {
        const dateVal = document.getElementById('calendar-input').value;
        if (!dateVal) return;

        document.getElementById('calendar-modal').style.display = 'none';

        const targetMsg = this.state.currentChatMessages.find(m => {
            return m.dt_iso && m.dt_iso.startsWith(dateVal);
        });

        if (targetMsg && targetMsg.message_id) {
            this.scrollToMessage(targetMsg.message_id);
        } else {
            const nextMsg = this.state.currentChatMessages.find(m => m.dt_iso && m.dt_iso >= dateVal);
            if (nextMsg && nextMsg.message_id) {
                this.scrollToMessage(nextMsg.message_id);
            } else {
                alert("No messages found on or after this date.");
            }
        }
    },

    scrollToTop: function () {
        document.getElementById('messages-container').scrollTo({ top: 0, behavior: 'smooth' });
    },

    getInitials: function (name) {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    },

    escapeHtml: function (text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
