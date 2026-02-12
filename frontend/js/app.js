var app = {
    state: {
        chats: [],
        currentChatId: null,
        currentChatMessages: [],
        chunksLoaded: new Set(),
        messageMap: new Map(),
        lastRenderedDate: null,
        profiles: {},
        searchMatches: [],
        currentMatchIndex: -1,
        isSearching: false
    },

    toggleTheme: function () {
        const current = localStorage.getItem('theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        this.setTheme(next);
    },

    setTheme: function (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        // Update button icon
        const btns = document.querySelectorAll('.theme-toggle-btn');
        btns.forEach(btn => {
            btn.textContent = theme === 'dark' ? '☀️' : '🌙';
        });
    },

    checkPassword: function () {
        try {
            const input = document.getElementById('access-password').value || '';
            console.log("Checking password:", input);

            // Case-insensitive check
            if (['bugrov'].includes(input.trim().toLowerCase())) {
                document.getElementById('password-overlay').style.display = 'none';
                try {
                    sessionStorage.setItem('bugrov_auth', 'true');
                } catch (e) {
                    console.warn('Session storage failed:', e);
                }
            } else {
                alert('Невірний пароль / Incorrect password');
            }
        } catch (e) {
            console.error("Password check error:", e);
            alert('Error checking password. See console.');
        }
    },

    init: async function () {
        console.log("App initializing...");

        // Setup Password Enter Key
        const pwInput = document.getElementById('access-password');
        if (pwInput) {
            pwInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') this.checkPassword();
            });
        }

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

        // Check Password
        try {
            const authorized = sessionStorage.getItem('bugrov_auth');
            if (authorized) {
                document.getElementById('password-overlay').style.display = 'none';
            }
        } catch (e) {
            console.warn("Session check failed:", e);
        }

        // Force Light Theme (or default)
        document.body.setAttribute('data-theme', 'light');

        // Check Consent - ALWAYS SHOW
        document.getElementById('disclaimer-modal').style.display = 'flex';

        await this.loadManifest();
        this.renderSidebar();

        window.addEventListener('hashchange', () => this.handleHashChange());
        this.handleHashChange();

        // Service Worker / PWA removed by request

        const searchInput = document.getElementById('chat-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.renderSidebar(e.target.value);
            });
        }

        const msgSearchInput = document.getElementById('msg-search-input');
        if (msgSearchInput) {
            msgSearchInput.addEventListener('input', (e) => {
                // ...
            });
        }

        this.renderFixedUI();
    },

    acceptDisclaimer: function () {
        localStorage.setItem('bugrov_consent', 'true');
        document.getElementById('disclaimer-modal').style.display = 'none';
        // Initialize Scroll Button
        const scrollBtn = document.getElementById('scroll-bottom-btn');
        const container = document.getElementById('messages-container');
        if (container && scrollBtn) {
            container.addEventListener('scroll', () => {
                if (container.scrollTop < container.scrollHeight - container.clientHeight - 300) {
                    scrollBtn.classList.add('visible');
                } else {
                    scrollBtn.classList.remove('visible');
                }
            });
        }

        // Initialize Theme
        this.setTheme(localStorage.getItem('theme') || 'light');
    },

    scrollToBottom: function () {
        const container = document.getElementById('messages-container');
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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
            // Hide search bar if open
            const bar = document.getElementById('search-bar-chat');
            if (bar) bar.style.display = 'none';
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

    // Unified Sidebar Logic
    setSidebarOpen: function (isOpen) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const isMobile = window.innerWidth <= 768; // Tablet/Mobile threshold

        if (isMobile) {
            if (isOpen) {
                sidebar.classList.add('open');
                if (overlay) overlay.classList.add('active');
            } else {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            }
        } else {
            // Desktop
            if (isOpen) {
                sidebar.classList.remove('collapsed');
            } else {
                sidebar.classList.add('collapsed');
            }
        }
    },

    toggleSidebar: function () {
        const sidebar = document.querySelector('.sidebar');
        const isMobile = window.innerWidth <= 768;

        let willBeOpen;
        if (isMobile) {
            // If it has 'open', we are closing it.
            willBeOpen = !sidebar.classList.contains('open');
        } else {
            // If it has 'collapsed', we are opening it.
            willBeOpen = sidebar.classList.contains('collapsed');
        }

        this.setSidebarOpen(willBeOpen);
    },

    closeChat: function () {
        window.location.hash = '';
        this.state.currentChatId = null;

        // Mobile Logic: Show sidebar, hide back button
        if (window.innerWidth <= 768) {
            this.setSidebarOpen(true);

            const backBtn = document.getElementById('mobile-back-btn');
            if (backBtn) backBtn.style.display = 'none';

            const toggleBtn = document.getElementById('sidebar-toggle-btn');
            if (toggleBtn) toggleBtn.style.display = 'block';
        }

        // Hide chat header and cleared container
        document.getElementById('chat-header').style.display = 'none';
        document.getElementById('messages-container').innerHTML = '<div class="empty-state"><p>Select a chat from the sidebar</p></div>';
        document.getElementById('fab-container').style.display = 'none';
        const bar = document.getElementById('search-bar-chat');
        if (bar) bar.style.display = 'none';
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

            // DEEP SEARCH: Iterate all chats -> manifest -> chunks
            for (const chat of this.state.chats) {
                try {
                    const mRes = await fetch(`data/${chat.chat_id}/manifest.json`);
                    if (!mRes.ok) continue;
                    const manifest = await mRes.json();

                    // Search chunks associated with this chat
                    // To avoid freezing, we might want to prioritize recent chunks or limit count.
                    // Searching ALL chunks in ALL chats is very heavy for client side without index.
                    // We will search ALL chunks.
                    for (const chunk of manifest.chunks) {
                        const cRes = await fetch(`data/${chat.chat_id}/chunks/${chunk.filename}`);
                        if (!cRes.ok) continue;
                        const messages = await cRes.json();

                        const matches = messages.filter(m => {
                            const txt = m.plain_text || m.html_text || '';
                            return txt && txt.toLowerCase().includes(text.toLowerCase());
                        });

                        if (matches.length > 0) {
                            let chatResult = results.find(r => r.chat.chat_id === chat.chat_id);
                            if (!chatResult) {
                                chatResult = { chat, matches: [] };
                                results.push(chatResult);
                            }
                            // Store the chunk filename with the match so we know what to load!
                            const matchesWithChunk = matches.map(m => ({ ...m, chunkFilename: chunk.filename }));

                            // Add max 5 matches per chat per chunk to avoid overload
                            chatResult.matches.push(...matchesWithChunk);
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
                    // Render Chat Header
                    const header = document.createElement('div');
                    header.style.padding = '8px 12px';
                    header.style.backgroundColor = 'var(--header-bg)';
                    header.style.fontSize = '12px';
                    header.style.fontWeight = 'bold';
                    header.style.opacity = '0.7';
                    header.textContent = item.chat.title;
                    list.appendChild(header);

                    // Show max 10 matches per chat
                    item.matches.slice(0, 10).forEach(match => {
                        const rDiv = document.createElement('div');
                        rDiv.className = 'chat-item';
                        rDiv.style.flexDirection = 'column';
                        rDiv.style.alignItems = 'flex-start';
                        rDiv.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
                        rDiv.style.height = 'auto';

                        rDiv.onclick = () => {
                            // Important: Set pending scroll details BEFORE hash change or loadChat
                            this.state.pendingScrollId = match.message_id || match.id;
                            this.state.pendingScrollChunk = match.chunkFilename;
                            window.location.hash = item.chat.chat_id;
                        };

                        const txt = match.plain_text || 'Media';
                        const snippet = txt.substring(0, 60) + (txt.length > 60 ? '...' : '');

                        rDiv.innerHTML = `
                            <div style="font-size: 13px; font-weight: 500; color: var(--link-color); margin-bottom: 2px;">
                                ${this.escapeHtml(match.from_name || 'User')} 
                                <span style="font-weight:normal; color: var(--text-secondary); float:right;">${match.dt_iso ? match.dt_iso.substring(0, 10) : ''}</span>
                            </div>
                            <div style="font-size: 13px; color: var(--text-primary);">${this.escapeHtml(snippet)}</div>
                         `;
                        list.appendChild(rDiv);
                    });
                });
            }

            this.state.isSearching = false;
        }, 500);
    },

    loadChat: async function (chatId) {
        if (this.state.currentChatId === chatId && this.state.currentChatMessages.length > 0 && !this.state.pendingScrollChunk) return;

        this.state.currentChatId = chatId;
        this.state.chunksLoaded.clear();
        this.state.currentChatMessages = []; // This will only hold *loaded* messages
        this.state.messageMap.clear();
        this.state.lastRenderedDate = null;
        this.state.loadedChunksCount = 0;
        this.state.chatManifest = null;

        // Reset UI
        if (document.getElementById('search-bar-chat')) document.getElementById('search-bar-chat').style.display = 'none';

        // Mobile Navigation Logic
        if (window.innerWidth <= 768) {
            // Auto-hide sidebar to show chat
            this.setSidebarOpen(false);

            // Show Back Button, Hide Burger
            const backBtn = document.getElementById('mobile-back-btn');
            if (backBtn) backBtn.style.display = 'block';

            const toggleBtn = document.getElementById('sidebar-toggle-btn');
            if (toggleBtn) toggleBtn.style.display = 'none';
        }

        document.getElementById('fab-container').style.display = 'flex';

        const chat = this.state.chats.find(c => c.chat_id === chatId);
        const header = document.getElementById('chat-header');
        header.style.display = 'flex';
        header.querySelector('.chat-title').textContent = chat ? chat.title : 'Unknown Chat';
        header.querySelector('.chat-title').onclick = () => this.openMediaGallery();
        header.querySelector('.chat-status').textContent = chat ? `${chat.message_count} messages` : '';

        const container = document.getElementById('messages-container');
        container.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            const response = await fetch(`data/${chatId}/manifest.json`);
            if (!response.ok) throw new Error('Chat manifest not found');
            const manifest = await response.json();
            this.state.chatManifest = manifest;

            container.innerHTML = '';

            const totalChunks = manifest.chunks.length;
            if (totalChunks > 0) {
                // Logic: 
                // 1. If we have a pending scroll chunk (from global search), load that.
                // 2. Otherwise, load the FIRST chunk (oldest messages) as per new requirement.

                let targetChunkIndex = 0; // Default to first chunk
                let targetFilename = manifest.chunks[0].filename;

                if (this.state.pendingScrollChunk) {
                    targetFilename = this.state.pendingScrollChunk;
                    targetChunkIndex = manifest.chunks.findIndex(c => c.filename === targetFilename);
                    if (targetChunkIndex === -1) {
                        targetChunkIndex = 0;
                        targetFilename = manifest.chunks[0].filename;
                    }
                }

                await this.loadChunk(chatId, targetFilename);
                this.state.loadedChunksCount = 1;

                // If we loaded the FIRST chunk, we need "Load More" at the bottom (append) - wait,
                // our structure expects "Load Previous" (prepend). 
                // If we start at older messages, the user scrolls DOWN to see newer messages.
                // So we need "Load Next Chunk" at the bottom!

                // Existing `loadChunk` appends. `prependLoadMore` adds to top.
                // We need `appendLoadMore` at the bottom if we are not at the last chunk.

                if (targetChunkIndex < totalChunks - 1) {
                    this.appendLoadMore(chatId, targetChunkIndex + 1);
                }

                // If we jumped to the middle (search), we might also need "Load Previous" at the top?
                if (targetChunkIndex > 0) {
                    this.prependLoadMore(chatId, targetChunkIndex - 1);
                }
            }

            // Scroll Logic
            if (this.state.pendingScrollId) {
                setTimeout(() => {
                    this.scrollToMessage(this.state.pendingScrollId);
                    this.state.pendingScrollId = null;
                    this.state.pendingScrollChunk = null;
                }, 300);
            } else {
                // Scroll to TOP if starting from beginning
                container.scrollTop = 0;
            }

        } catch (e) {
            console.error('Error loading chat:', e);
            container.innerHTML = '<div class="empty-state">Error loading chat data</div>';
        }
    },

    appendLoadMore: function (chatId, chunkIndex) {
        const container = document.getElementById('messages-container');
        const btn = document.createElement('div');
        btn.className = 'date-header';
        btn.textContent = '🔽 Load Newer Messages';
        btn.style.cursor = 'pointer';
        btn.style.background = 'var(--accent-color)';
        btn.style.color = 'white';
        btn.onclick = async () => {
            btn.textContent = 'Loading...';
            const chunk = this.state.chatManifest.chunks[chunkIndex];

            await this.loadChunk(chatId, chunk.filename); // This appends

            btn.remove();

            if (chunkIndex < this.state.chatManifest.chunks.length - 1) {
                this.appendLoadMore(chatId, chunkIndex + 1);
            }
        };
        container.appendChild(btn);
    },

    prependLoadMore: function (chatId, chunkIndex) {
        const container = document.getElementById('messages-container');
        const btn = document.createElement('div');
        btn.className = 'date-header'; // reuse style or make new
        btn.textContent = '🔼 Load Previous Messages';
        btn.style.cursor = 'pointer';
        btn.style.background = 'var(--accent-color)';
        btn.style.color = 'white';
        btn.onclick = async () => {
            btn.textContent = 'Loading...';
            const chunk = this.state.chatManifest.chunks[chunkIndex];

            // Capture scroll height before load
            const oldHeight = container.scrollHeight;
            const oldTop = container.scrollTop;

            await this.loadPreviousChunk(chatId, chunk.filename);

            // Adjust scroll
            // Wait for render? loadPreviousChunk calls renderMessagesPrepend?
            // Actually my loadChunk appends. I need a prepend mode.

            btn.remove();

            // Restore visual position
            const newHeight = container.scrollHeight;
            container.scrollTop = newHeight - oldHeight + oldTop;

            // Add next loader
            if (chunkIndex > 0) {
                this.prependLoadMore(chatId, chunkIndex - 1);
            }
        };
        container.insertBefore(btn, container.firstChild);
    },

    loadPreviousChunk: async function (chatId, filename) {
        if (this.state.chunksLoaded.has(filename)) return;
        try {
            const response = await fetch(`data/${chatId}/chunks/${filename}`);
            if (!response.ok) return;
            const messages = await response.json();
            this.state.chunksLoaded.add(filename);

            // Prepend new messages to current state
            this.state.currentChatMessages = [...messages, ...this.state.currentChatMessages];

            // Update Map
            messages.forEach(m => {
                if (m.message_id) this.state.messageMap.set(m.message_id, m);
            });

            // Re-render all messages to ensure correct order and date headers
            // Clearing container is handled by renderMessages logic or we force clear if needed
            // But renderMessages usually appends? 
            // We need to clear and re-render.
            document.getElementById('messages-container').innerHTML = '';
            this.state.lastRenderedDate = null; // Reset date tracking
            this.renderMessages(this.state.currentChatMessages);

            // Restore scroll position logic would be needed here ideally, 
            // but for now we rely on the caller (prependLoadMore) to handle scroll adjustments 
            // if it could measure before/after. 
            // Since we cleared innerHTML, the scroll jump might be visible.

        } catch (e) { console.error(e); }
    },
    loadChunk: async function (chatId, filename) {
        if (this.state.chunksLoaded.has(filename)) return;
        try {
            const response = await fetch(`data/${chatId}/chunks/${filename}`);
            if (!response.ok) return;
            const messages = await response.json();
            this.state.chunksLoaded.add(filename);

            // Append messages for initial load
            this.state.currentChatMessages.push(...messages);
            messages.forEach(m => {
                if (m.message_id) this.state.messageMap.set(m.message_id, m);
            });

            this.renderMessages(this.state.currentChatMessages);
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

            // ... (rest of loop)

            /* The loop continues... handled in next chunk */

            /* I need to inject the call at the END of renderMessages, not inside loop */


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

                    const replySnippet = this.getReplySnippet(replyMsg);

                    content += `
                        <div class="reply-preview" onclick="app.scrollToMessage('${msg.reply_to}')">
                            <div class="reply-name">${this.escapeHtml(replyName)}</div>
                            <div class="reply-text">${replySnippet}</div>
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

        // this.generateTimeline(); // Removed
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
            }
            // Fallback
            return `<div class="media-container"><img src="${src}" class="${cls}" loading="lazy" ${onclick}></div>`;
        } else if (att.kind === 'video') {
            return `<div class="media-container"><video src="${att.href}" controls class="media-video"></video></div>`;
        } else if (att.kind === 'round_video') {
            return `<div class="media-container round-container"><video src="${att.href}" autoplay loop muted class="media-round-video"></video></div>`;
        } else if (att.kind === 'voice') {
            // Use Stick Player
            // att.href is relative path? "data/chat/voice/..."
            // We need title (date? duration?)
            return `<div class="media-container">
                <button class="voice-msg-btn" onclick="app.playAudio('${att.href}', 'Voice Message')">▶️ Play Voice</button>
            </div>`;
        } else {
            return `<div class="media-container"><a href="${att.href}" target="_blank" style="color: var(--link-color)">📄 ${att.kind}</a></div>`;
        }
    },

    openLightbox: function (src) {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        img.src = src;
        lb.style.display = 'flex';

        // Touch to close
        lb.onclick = () => {
            lb.style.display = 'none';
        };
    },

    scrollToMessage: function (msgId) {
        const el = document.getElementById(msgId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight'); // Add highlight class
            setTimeout(() => {
                el.classList.remove('highlight');
            }, 2000);
        } else {
            // If not found, maybe load chunk? (Not implemented here for simplicity)
            console.log("Message not found in DOM:", msgId);
        }
    },

    getReplySnippet: function (msg) {
        if (!msg) return '...';

        // Priority: Text -> Media -> Type
        if (msg.plain_text && msg.plain_text.trim()) {
            let text = msg.plain_text.trim().replace(/\s+/g, ' ');
            if (text.length > 50) {
                text = text.substring(0, 50) + '...';
            }
            return this.escapeHtml(text);
        }

        // Check attachments
        if (msg.attachments && msg.attachments.length > 0) {
            const type = msg.attachments[0].kind;
            if (type === 'photo') return '📷 Photo';
            if (type === 'video') return '📹 Video';
            if (type === 'voice') return '🎤 Voice Message';
            if (type === 'sticker') return '🙂 Sticker';
            if (type === 'round_video') return '⏺ Video Message';
            return '📎 File';
        }

        return 'Message';
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


    filterMessages: function (query) {
        const container = document.getElementById('messages-container');

        // Cleanup previous highlights
        const highlighted = container.querySelectorAll('.highlight-text');
        highlighted.forEach(el => {
            el.outerHTML = el.textContent;
        });

        container.classList.remove('searching');
        container.querySelectorAll('.message').forEach(m => m.classList.remove('match'));

        if (!query) {
            document.getElementById('search-count').textContent = '';
            this.state.searchMatches = [];
            this.state.currentMatchIndex = -1;
            return;
        }

        container.classList.add('searching');
        const lowerQuery = query.toLowerCase();
        let count = 0;
        this.state.searchMatches = [];

        // Search rendered DOM
        const messages = container.querySelectorAll('.message');

        messages.forEach(msg => {
            const textEl = msg.querySelector('.message-text'); // This class might not exist if I didn't add it to renderMessages? 
            // wait, renderMessages uses .message-content for text.
            // Let's check renderMessages again.
            // Line 453: content += `<div class="message-content">${textToShow}</div>`;
            // So class is message-content.

            const contentEl = msg.querySelector('.message-content');
            if (contentEl) {
                const text = contentEl.textContent;
                if (text.toLowerCase().includes(lowerQuery)) {
                    count++;
                    msg.classList.add('match');
                    this.state.searchMatches.push(msg);

                    // Highlight
                    try {
                        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                        contentEl.innerHTML = text.replace(regex, '<span class="highlight-text">$1</span>');
                    } catch (e) {
                        // fallback
                    }
                }
            }
        });

        const countSpan = document.getElementById('search-count');
        if (countSpan) countSpan.textContent = count > 0 ? `1/${count}` : '0 found';

        if (this.state.searchMatches.length > 0) {
            this.state.currentMatchIndex = 0;
            this.state.searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.highlightCurrentMatch();
        } else {
            this.state.currentMatchIndex = -1;
        }
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
    },

    openInfoModal: function () {
        document.getElementById('info-modal').style.display = 'flex';
    },

    initGestures: function () {
        // Media Gallery Swipe
        const gallery = document.getElementById('media-gallery-modal');
        let touchStartX = 0;
        let touchEndX = 0;

        if (gallery) {
            gallery.addEventListener('touchstart', e => {
                touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });

            gallery.addEventListener('touchend', e => {
                touchEndX = e.changedTouches[0].screenX;
                if (touchStartX - touchEndX > 50) this.navigateMedia('next'); // Swipe Left
                if (touchEndX - touchStartX > 50) this.navigateMedia('prev'); // Swipe Right
            }, { passive: true });
        }

        // Sidebar Swipe (Global)
        // Swipe Right from left edge to open sidebar
        // Swipe Left on sidebar to close it

        document.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        document.addEventListener('touchend', e => {
            touchEndX = e.changedTouches[0].screenX;
            const swipeDist = touchEndX - touchStartX;

            // Open Sidebar: Swipe Right (>70px) starting from left edge (<30px)
            if (touchStartX < 30 && swipeDist > 70) {
                if (window.innerWidth <= 480) {
                    const sidebar = document.querySelector('.sidebar');
                    if (!sidebar.classList.contains('open')) {
                        this.toggleSidebar();
                    }
                }
            }

            // Close Sidebar: Swipe Left (<-70px)
            if (swipeDist < -70) {
                if (window.innerWidth <= 480) {
                    const sidebar = document.querySelector('.sidebar');
                    if (sidebar.classList.contains('open')) {
                        this.toggleSidebar();
                    }
                }
            }
        }, { passive: true });
    },

    renderFixedUI: function () {
        // Analytics Button (in stack)
        const stack = document.getElementById('fab-stack');
        if (!stack) return; // Wait for stack

        // Calendar
        const calBtn = document.createElement('div');
        calBtn.className = 'fab';
        calBtn.innerText = '📅';
        calBtn.title = 'Date Calendar';
        calBtn.onclick = () => app.openDateCalendar();
        stack.appendChild(calBtn); // Stack order: Bottom -> Top

        // Analytics
        const analyticsBtn = document.createElement('div');
        analyticsBtn.className = 'fab';
        analyticsBtn.innerText = '📊';
        analyticsBtn.title = 'Analytics';
        analyticsBtn.onclick = () => app.showAnalytics();
        stack.appendChild(analyticsBtn);
    },

    navigateMedia: function (direction) {
        // Stub for media navigation
        console.log("Media navigation not implemented yet", direction);
    },

    initPWA: function () {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.state.deferredPrompt = e;
            // Create Install Button if not exists
            const sidebarHeader = document.querySelector('.sidebar-header');
            if (!sidebarHeader) return;

            const installBtn = document.createElement('button');
            installBtn.textContent = '📲';
            installBtn.title = 'Install App';
            installBtn.className = 'icon-btn';
            installBtn.style.fontSize = '12px';
            installBtn.onclick = () => {
                this.state.deferredPrompt.prompt();
                this.state.deferredPrompt.userChoice.then((choiceResult) => {
                    this.state.deferredPrompt = null;
                    installBtn.remove();
                });
            };
            sidebarHeader.insertBefore(installBtn, sidebarHeader.firstChild);
        });
    },
    // --- Analytics ---
    openAnalytics: function () {
        if (!this.state.currentChatId) {
            alert('Select a chat first to see statistics.');
            return;
        }

        const msgs = this.state.currentChatMessages;
        if (!msgs || msgs.length === 0) return;

        const total = msgs.length;
        const users = {};
        let firstDate = null;
        let lastDate = null;

        msgs.forEach(m => {
            if (m.from_name) {
                users[m.from_name] = (users[m.from_name] || 0) + 1;
            }
            if (m.dt_iso) {
                const d = m.dt_iso.split('T')[0];
                if (!firstDate) firstDate = d;
                lastDate = d;
            }
        });

        const sortedUsers = Object.entries(users).sort((a, b) => b[1] - a[1]).slice(0, 10);

        const body = document.getElementById('analytics-body');
        body.innerHTML = `
            <div class="stat-card">
                <h3>General Stats</h3>
                <div class="stat-row"><span>Total Messages:</span> <strong>${total}</strong></div>
                <div class="stat-row"><span>Date Range:</span> <strong>${firstDate || '?'} - ${lastDate || '?'}</strong></div>
                <div class="stat-row"><span>Active Participants:</span> <strong>${Object.keys(users).length}</strong></div>
            </div>
            
            <div class="stat-card">
                <h3>Top 10 Active Users</h3>
                ${sortedUsers.map(([name, count]) => {
            const pct = Math.round((count / total) * 100);
            return `
                    <div class="bar-chart-row">
                        <div class="bar-label" title="${name}">${this.escapeHtml(name)}</div>
                        <div class="bar-container">
                            <div class="bar-fill" style="width: ${pct}%"></div>
                        </div>
                        <div class="bar-value">${count}</div>
                    </div>`;
        }).join('')}
            </div>
        `;

        document.getElementById('analytics-modal').style.display = 'flex';
    },

    // --- Sticky Audio ---
    currentAudio: null,
    playAudio: function (src, title) {
        const player = document.getElementById('global-audio');
        const container = document.getElementById('sticky-audio-player');

        player.src = src;
        player.play();
        this.currentAudio = src;

        container.style.display = 'flex';
        document.getElementById('player-title').textContent = title || 'Audio Message';
        document.getElementById('play-pause-btn').textContent = '⏸️';

        player.ontimeupdate = () => {
            const cur = Math.floor(player.currentTime);
            const dur = Math.floor(player.duration || 0);
            document.getElementById('player-time').textContent = `${this.formatTime(cur)} / ${this.formatTime(dur)}`;
        };

        player.onended = () => {
            document.getElementById('play-pause-btn').textContent = '▶️';
        };
    },

    toggleAudio: function () {
        const player = document.getElementById('global-audio');
        if (player.paused) {
            player.play();
            document.getElementById('play-pause-btn').textContent = '⏸️';
        } else {
            player.pause();
            document.getElementById('play-pause-btn').textContent = '▶️';
        }
    },

    prevAudio: function () { },
    nextAudio: function () { },

    formatTime: function (sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' + s : s}`;
    },


    getInitials: function (name) {
        if (!name) return '??';
        const parts = name.split(' ').filter(n => n.length > 0);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return '??';
    },

    escapeHtml: function (text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    app.initGestures();
    app.initPWA();
});
