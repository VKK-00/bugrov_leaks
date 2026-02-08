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

        // Load Profiles
        try {
            const pRes = await fetch('profiles.json');
            if (pRes.ok) {
                const pData = await pRes.json();
                this.state.profiles = pData.profiles || {};
            }
        } catch (e) {
            console.error("Profiles load error:", e);
            this.state.profiles = {};
        }

        // Check Consent - ALWAYS SHOW
        document.getElementById('disclaimer-modal').style.display = 'flex';

        await this.loadManifest();
        this.renderSidebar();

        window.addEventListener('hashchange', () => this.handleHashChange());
        this.handleHashChange();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('SW register success', reg))
                .catch(err => console.log('SW register fail', err));
        }

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

    acceptDisclaimer: function () {
        localStorage.setItem('bugrov_consent', 'true');
        document.getElementById('disclaimer-modal').style.display = 'none';
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

        // Check Global Search Mode
        const isGlobal = document.getElementById('global-search-toggle')?.checked;

        if (isGlobal && filterText.trim().length > 0) {
            // Global search is async and handled by performGlobalSearch
            // Here we just show a placeholder if search hasn't started or is clearing
            if (!this.state.isSearching) {
                this.performGlobalSearch(filterText);
            }
            return;
        }

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

    // Debounce timer
    searchTimer: null,

    toggleGlobalSearch: function () {
        const input = document.getElementById('chat-search');
        this.renderSidebar(input.value);
    },

    toggleSidebar: function () {
        const sidebar = document.querySelector('.sidebar');
        sidebar.classList.toggle('collapsed');
    },

    performGlobalSearch: async function (text) {
        if (this.searchTimer) clearTimeout(this.searchTimer);

        this.searchTimer = setTimeout(async () => {
            this.state.isSearching = true;
            const list = document.getElementById('chat-list');
            const status = document.getElementById('global-search-status');

            list.innerHTML = '<div class="empty-state" style="margin:0; padding:20px; background:none;">Searching...</div>';
            status.textContent = "Scanning...";

            let totalFound = 0;
            const results = [];

            // Iterate all chats
            // To avoid freezing UI, we might need to batch, but let's try simple loop first
            for (const chat of this.state.chats) {
                try {
                    const response = await fetch(`data/${chat.chat_id}/search.json`);
                    if (response.ok) {
                        const searchData = await response.json();
                        const matches = searchData.filter(m => m.text && m.text.toLowerCase().includes(text.toLowerCase()));
                        if (matches.length > 0) {
                            results.push({ chat, matches });
                            totalFound += matches.length;
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to search in ${chat.chat_id}`);
                }
            }

            status.textContent = `Found ${totalFound} messages`;
            list.innerHTML = '';

            if (results.length === 0) {
                list.innerHTML = '<div class="empty-state" style="margin:0; padding:20px; background:none;">No matches found</div>';
            } else {
                results.forEach(item => {
                    // Render Chat Header in results
                    const header = document.createElement('div');
                    header.style.padding = '8px 12px';
                    header.style.backgroundColor = 'var(--header-bg)';
                    header.style.fontSize = '12px';
                    header.style.fontWeight = 'bold';
                    header.style.opacity = '0.7';
                    header.textContent = item.chat.title;
                    list.appendChild(header);

                    item.matches.forEach(match => {
                        const rDiv = document.createElement('div');
                        rDiv.className = 'chat-item'; // Reuse class for hover effect
                        rDiv.style.flexDirection = 'column';
                        rDiv.style.alignItems = 'flex-start';
                        rDiv.style.borderBottom = '1px solid rgba(0,0,0,0.1)';

                        rDiv.onclick = () => {
                            // Load chat and scroll
                            window.location.hash = item.chat.chat_id;
                            // We need to wait for chat load then scroll. 
                            // We can use a global 'pendingScrollId' in state
                            this.state.pendingScrollId = match.id;
                        };

                        const snippet = match.text.substring(0, 60) + (match.text.length > 60 ? '...' : '');

                        rDiv.innerHTML = `
                            <div style="font-size: 13px; font-weight: 500; color: var(--link-color); margin-bottom: 2px;">${this.escapeHtml(match.from || 'User')} <span style="font-weight:normal; color: var(--text-secondary); float:right;">${match.dt || ''}</span></div>
                            <div style="font-size: 13px; color: var(--text-primary);">${this.escapeHtml(snippet)}</div>
                         `;
                        list.appendChild(rDiv);
                    });
                });
            }

            this.state.isSearching = false;
        }, 500); // 500ms delay
    },

    loadChat: async function (chatId) {
        if (this.state.currentChatId === chatId && this.state.currentChatMessages.length > 0) {
            // Check pending scroll even if already loaded
            if (this.state.pendingScrollId) {
                setTimeout(() => {
                    this.scrollToMessage(this.state.pendingScrollId);
                    this.state.pendingScrollId = null;
                }, 500);
            }
            return;
        }

        this.state.currentChatId = chatId;
        this.state.chunksLoaded.clear();
        this.state.currentChatMessages = [];
        this.state.messageMap.clear();
        this.state.lastRenderedDate = null;

        // Reset Search UI in main chat if we switch chats
        if (document.getElementById('search-bar-chat')) document.getElementById('search-bar-chat').style.display = 'none';

        // Perform standard sidebar render (unless global search is active? 
        // If global search is active, we might want to keep results or switch back to chat list.
        // For now, let's keep Global Search active if it is checked.)
        if (!document.getElementById('global-search-toggle')?.checked) {
            this.renderSidebar();
        }

        document.getElementById('fab-container').style.display = 'flex';

        const chat = this.state.chats.find(c => c.chat_id === chatId);
        const header = document.getElementById('chat-header');
        header.style.display = 'flex';
        const titleEl = header.querySelector('.chat-title');
        titleEl.textContent = chat ? chat.title : 'Unknown Chat';
        titleEl.style.cursor = 'pointer';
        titleEl.onclick = () => this.openMediaGallery();
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

            // Scroll Logic
            setTimeout(() => {
                if (this.state.pendingScrollId) {
                    this.scrollToMessage(this.state.pendingScrollId);
                    this.state.pendingScrollId = null;
                } else {
                    container.scrollTop = container.scrollHeight;
                }
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

        // Reset lastSender for this batch if it's a new render (not append). 
        // But renderMessages is called by loadChunk which appends. 
        // We should track the last message rendered in the container to be sure.
        // However, we can just rely on local logic for the chunk, assuming chunks are large enough that boundary issues are minor.
        // Better: check the last element in container.

        // Local state for this batch
        let lastSenderName = null; messages.forEach((msg, index) => {
            // Date Header
            if (msg.dt_iso) {
                const dateKey = msg.dt_iso.split('T')[0];
                if (dateKey !== this.state.lastRenderedDate) {
                    const dateDiv = document.createElement('div');
                    dateDiv.className = 'date-header';
                    dateDiv.textContent = this.formatDateHeader(msg.dt_iso);
                    container.appendChild(dateDiv);
                    this.state.lastRenderedDate = dateKey;

                    // Reset sender grouping on new day
                    lastSenderName = null;
                }
            }

            const msgDiv = document.createElement('div');
            if (msg.dt_iso) msgDiv.dataset.date = msg.dt_iso.split('T')[0];
            if (msg.message_id) msgDiv.id = msg.message_id;

            if (msg.is_service) {
                msgDiv.className = 'service-message';
                msgDiv.dataset.isServiceMsg = "true";
                msgDiv.textContent = msg.plain_text;
                lastSenderName = null; // Reset grouping on service msg
            } else {
                // Sender Logic
                const isBugrov = msg.from_name &&
                    (msg.from_name.includes('Volodymyr Bugrov') || msg.from_name.includes('Bugrov'));

                let msgClass = 'message incoming';
                if (isBugrov) {
                    msgClass = 'message bugrov-message';
                }

                msgDiv.className = msgClass;

                let content = '';

                // Name Logic (Grouping) - SHOW FIRST
                const currentName = msg.from_name || 'Unknown';
                const showName = (currentName !== lastSenderName);

                // Profile Lookup
                const profile = this.state.profiles && this.state.profiles[currentName];
                const profileLink = profile ? profile.link : null;

                if (showName && msg.from_name) {
                    let nameHtml = '';
                    if (isBugrov) {
                        // For Bugrov, checking if we want to hide name or show it specially.
                        // User request: "ім'я профілю ... потім текст"
                        // TDesktop shows name for everyone in groups. In PM, it might hide.
                        // Let's show it to be safe as per "має бути: імя..."
                        nameHtml = `<span class="message-sender">${this.escapeHtml(msg.from_name)}</span>`;
                    } else {
                        let hash = 0;
                        for (let i = 0; i < msg.from_name.length; i++) {
                            hash = msg.from_name.charCodeAt(i) + ((hash << 5) - hash);
                        }
                        const colorIndex = (Math.abs(hash) % 8) + 1;
                        nameHtml = `<span class="message-sender color${colorIndex}">${this.escapeHtml(msg.from_name)}</span>`;
                    }

                    if (profileLink) {
                        content += `<a href="${profileLink}" target="_blank" style="text-decoration:none;">${nameHtml}</a>`;
                    } else {
                        content += nameHtml;
                    }
                }

                lastSenderName = currentName;

                // Reply Logic - SHOW SECOND
                if (msg.reply_to) {
                    const replyMsg = this.state.messageMap.get(msg.reply_to);
                    const replyName = replyMsg ? (replyMsg.from_name || 'Someone') : 'Message';
                    const replyText = replyMsg ? (replyMsg.plain_text || 'Media') : '...';

                    content += `
                        <div class="reply-preview" onclick="app.scrollToMessage('${msg.reply_to}')">
                            <div class="reply-name">${this.escapeHtml(replyName)}</div>
                            <div class="reply-text">${this.escapeHtml(replyText)}</div>
                        </div>`;
                }

                const hasAttachments = msg.attachments && msg.attachments.length > 0;

                // Media
                if (hasAttachments) {
                    msg.attachments.forEach(att => {
                        content += this.renderAttachment(att);
                    });
                }

                // Text Logic
                let textToShow = null;
                if (hasAttachments) {
                    if (msg.plain_text && msg.plain_text.trim().length > 0) {
                        textToShow = this.escapeHtml(msg.plain_text);
                    }
                } else {
                    if (msg.html_text) {
                        textToShow = msg.html_text;
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
        if (att.kind === 'photo' || att.kind === 'sticker') {
            const isSticker = att.kind === 'sticker';
            const cls = isSticker ? 'media-sticker' : 'media-photo';
            const onclick = isSticker ? '' : `onclick="app.openLightbox('${att.href}')"`;

            // Thumbnail Logic: Try to use _thumb.jpg if available
            // We blindly assume a thumb might exist or fallback to full image.
            // Since we can't check existence easily without 404s, we will use the full image as src,
            // BUT for the lightbox we definitely use the full image.
            // OPTIMIZATION: If the file is huge, this is slow. 
            // Telegram export usually names photos like "photo_123.jpg". 
            // Thumbs are usually embedded or separate. 
            // Users request implies "thumbnails" exist.
            // Let's try to construct a thumb path if it's a standard format.
            // Standard export: "photo_1@01-01-2021_12-00-00.jpg" -> "photo_1@01-01-2021_12-00-00_thumb.jpg" ??
            // Actually standard export:
            // photos/photo_1.jpg
            // photos/photo_1_thumb.jpg (sometimes)
            // Let's try to infer thumb path.

            let src = att.href;
            // Hacky attempt: if path ends in .jpg, try inserting _thumb
            // We will stick to using the main image for now unless we are sure.
            // User said: "картинки есть с подписью thumb и без неё".
            // So if `att.href` is `photo_123.jpg`, there is `photo_123_thumb.jpg`.

            if (!isSticker && src.toLowerCase().endsWith('.jpg')) {
                // Try to use thumb for display
                const thumbSrc = src.replace('.jpg', '_thumb.jpg');
                // We render the thumb, but keep full href for lightbox
                // Note: If _thumb doesn't exist, this will show broken image.
                // We can add onerror to fallback.
                return `<div class="media-container"><img src="${thumbSrc}" onerror="this.onerror=null;this.src='${src}'" class="${cls}" loading="lazy" ${onclick}></div>`;
            }

            return `<div class="media-container"><img src="${src}" class="${cls}" loading="lazy" ${onclick}></div>`;
        } else if (att.kind === 'video') {
            return `<div class="media-container"><video src="${att.href}" controls class="media-video"></video></div>`;
        } else if (att.kind === 'round_video') {
            // Strict round container
            return `<div class="media-container round-container"><video src="${att.href}" autoplay loop muted class="media-round-video"></video></div>`;
        } else if (att.kind === 'voice') {
            return `<div class="media-container"><audio src="${att.href}" controls></audio></div>`;
        } else {
            return `<div class="media-container"><a href="${att.href}" target="_blank" style="color: var(--link-color)">📄 ${att.kind}</a></div>`;
        }
    },

    openLightbox: function (src) {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        img.src = src;
        lb.style.display = 'flex';
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

        if (bar.style.display === 'block') {
            document.getElementById('msg-search-input').focus();
            // Reset search state
            this.state.searchMatches = [];
            this.state.currentMatchIndex = -1;
            this.updateSearchCount();
        } else {
            // Clear search
            this.filterMessages('');
        }
    },

    // Search functionality state
    state: {
        chats: [],
        currentChatId: null,
        currentChatMessages: [],
        chunksLoaded: new Set(),
        messageMap: new Map(),
        lastRenderedDate: null,
        searchMatches: [],
        currentMatchIndex: -1
    },

    filterMessages: function (text) {
        const container = document.getElementById('messages-container');
        const msgs = container.querySelectorAll('.message');

        // Reset highlights
        msgs.forEach(m => m.classList.remove('match', 'current-match'));
        this.state.searchMatches = [];
        this.state.currentMatchIndex = -1;

        if (!text) {
            container.classList.remove('searching');
            this.updateSearchCount();
            return;
        }

        container.classList.add('searching');
        const matches = [];
        msgs.forEach(m => {
            // Check plain text content
            if (m.textContent.toLowerCase().includes(text.toLowerCase())) {
                m.classList.add('match');
                matches.push(m);
            }
        });

        this.state.searchMatches = matches;
        this.state.currentMatchIndex = matches.length > 0 ? 0 : -1;

        if (this.state.currentMatchIndex >= 0) {
            this.highlightCurrentMatch();
        }
        this.updateSearchCount();
    },

    navigateSearch: function (direction) {
        if (this.state.searchMatches.length === 0) return;

        if (direction === 'next') {
            this.state.currentMatchIndex++;
            if (this.state.currentMatchIndex >= this.state.searchMatches.length) {
                this.state.currentMatchIndex = 0;
            }
        } else {
            this.state.currentMatchIndex--;
            if (this.state.currentMatchIndex < 0) {
                this.state.currentMatchIndex = this.state.searchMatches.length - 1;
            }
        }
        this.highlightCurrentMatch();
        this.updateSearchCount();
    },

    highlightCurrentMatch: function () {
        // Remove previous current-match
        document.querySelectorAll('.current-match').forEach(el => el.classList.remove('current-match'));

        const currentEl = this.state.searchMatches[this.state.currentMatchIndex];
        if (currentEl) {
            currentEl.classList.add('current-match');
            currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    updateSearchCount: function () {
        const countSpan = document.getElementById('search-count');
        if (!countSpan) return;

        if (this.state.searchMatches.length === 0) {
            countSpan.textContent = '';
        } else {
            countSpan.textContent = `${this.state.currentMatchIndex + 1}/${this.state.searchMatches.length}`;
        }
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

    openMediaGallery: function () {
        if (!this.state.currentChatMessages || this.state.currentChatMessages.length === 0) return;

        document.getElementById('media-gallery-modal').style.display = 'flex';
        // Default to photo
        const photoTab = document.querySelector('.media-tab');
        this.filterGallery('photo', photoTab);
    },

    filterGallery: function (type, tabElement) {
        // Update tabs
        document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
        if (tabElement) tabElement.classList.add('active');

        const grid = document.getElementById('media-grid');
        grid.innerHTML = '';

        // Filter messages with attachments of 'type'
        // types: photo, video (includes round), voice

        let targetType = type;
        if (type === 'video') targetType = 'video';

        const mediaItems = [];

        this.state.currentChatMessages.forEach(msg => {
            if (msg.attachments && msg.attachments.length > 0) {
                msg.attachments.forEach(att => {
                    const k = att.kind || '';
                    // IF filter is 'video', include both 'video' and 'round_video'
                    if (type === 'video') {
                        if (k === 'video' || k === 'round_video') {
                            mediaItems.push({ ...att, msgId: msg.message_id, dt: msg.dt_iso });
                        }
                    } else {
                        if (k === type) {
                            mediaItems.push({ ...att, msgId: msg.message_id, dt: msg.dt_iso });
                        }
                    }
                });
            }
        });

        if (mediaItems.length === 0) {
            grid.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px; width:100%;">No media found</div>';
            return;
        }

        mediaItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'media-grid-item';
            div.onclick = () => {
                // Determine action
                if (type === 'photo' || type === 'video') {
                    // For videos, openLightbox might need tweaking if it only supports images?
                    // app.openLightbox currently sets img.src. 
                    // Let's modify openLightbox to support video or just open image.
                    if (type === 'photo') this.openLightbox(item.href);
                    else window.open(item.href, '_blank');
                } else {
                    document.getElementById('media-gallery-modal').style.display = 'none';
                    this.scrollToMessage(item.msgId);
                }
            };

            let inner = '';
            if (type === 'photo') {
                // Try thumb
                let src = item.href;
                if (src.toLowerCase().endsWith('.jpg')) src = src.replace('.jpg', '_thumb.jpg');
                inner = `<img src="${src}" onerror="this.onerror=null;this.src='${item.href}'" loading="lazy">`;
            } else if (type === 'video' || type === 'round') {
                inner = `<video src="${item.href}" muted preload="metadata"></video><div class="type-icon">▶</div>`;
            } else if (type === 'voice') {
                inner = `<div style="color:white; font-size:24px;">🎤</div><div class="type-icon">${item.duration || ''}</div>`;
            }

            div.innerHTML = inner;
            grid.appendChild(div);
        });
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
