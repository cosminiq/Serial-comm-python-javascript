/**
 * Multi-UART Serial Monitor - Flask-Integrated Frontend Application
 * Handles UI interactions, session management, and Flask backend communication
 */

class UARTMonitorApp {
    constructor() {
        this.sessions = new Map();
        this.sessionCounter = 0;
        this.globalStats = {
            totalMessages: 0,
            startTime: Date.now(),
            activeSessions: 0
        };
        this.availablePorts = [];
        this.isInitialized = false;
        this.socket = null;
        this.baseUrl = window.location.origin; // Flask server URL

        // Bind methods
        this.init = this.init.bind(this);
        this.updateStats = this.updateStats.bind(this);
        this.updateUptime = this.updateUptime.bind(this);

        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.init);
        } else {
            this.init();
        }
    }

    async init() {
        console.log('Initializing UART Monitor App with Flask backend...');
        try {
            this.showLoading(true);
            await this.setupEventListeners();
            await this.initializeSocketIO();
            await this.scanPorts();
            this.startUptimeTimer();
            this.addDefaultSession();
            this.updateAppStatus('ready', 'Ready');
            console.log('App initialized successfully');
            // Fetch server stats to sync sessions
            const stats = await this.getGlobalStats();
            this.updateDebugSocketStatus(this.socket.connected);
            this.updateDebugSessionCount();
            if (stats) {
                this.globalStats.activeSessions = stats.active_sessions;
                this.updateStats();
                this.showNotification(`Synced with server: ${stats.active_sessions} active sessions`, 'success');
            }

            this.showNotification('Application initialized successfully', 'success');
            console.log('App initialized successfully');
        } catch (error) {
            console.error('Initialization error:', error);
            this.showNotification('Failed to initialize application: ' + error.message, 'error');
            this.updateAppStatus('error', 'Initialization Failed');
        } finally {
            this.showLoading(false);
            this.isInitialized = true;
        }
    }






    async initializeSocketIO() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.baseUrl);
                console.log('Attempting Socket.IO connection to', this.baseUrl);

                this.socket = io(this.baseUrl);
                console.log('Attempting Socket.IO connection to', this.baseUrl);

                this.socket.on('connect', () => {
                    console.log('Connected to Flask SocketIO server');
                    this.showNotification('Connected to server', 'success');
                    this.updateDebugSocketStatus(true);
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from Flask SocketIO server');
                    this.showNotification('Disconnected from server', 'warning');
                    this.updateDebugSocketStatus(false);
                });


                this.socket.on('connect', () => {
                    console.log('Connected to Flask SocketIO server');
                    this.showNotification('Connected to server', 'success');
                    // Update debug section
                    const socketStatusEl = document.getElementById('socketStatus');
                    if (socketStatusEl) {
                        socketStatusEl.textContent = 'Connected';
                    }
                    const serverStatusEl = document.getElementById('serverStatus');
                    if (serverStatusEl) {
                        serverStatusEl.textContent = 'Connected';
                    }
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from Flask SocketIO server');
                    this.showNotification('Disconnected from server', 'warning');
                    // Update debug section
                    const socketStatusEl = document.getElementById('socketStatus');
                    if (socketStatusEl) {
                        socketStatusEl.textContent = 'Disconnected';
                    }
                    const serverStatusEl = document.getElementById('serverStatus');
                    if (serverStatusEl) {
                        serverStatusEl.textContent = 'Disconnected';
                    }
                });

                this.socket.on('connected', (data) => {
                    console.log('Server connection confirmed:', data);
                });

                this.socket.on('session_status', (data) => {
                    this.handleSessionStatusUpdate(data);
                });

                this.socket.on('message_received', (data) => {
                    this.receiveMessage(data.session_id, data.message, data.timestamp);
                });

                this.socket.on('message_sent', (data) => {
                    this.confirmMessageSent(data.session_id, data.message, data.timestamp);
                });

                setTimeout(() => {
                    if (!this.socket.connected) {
                        reject(new Error('Socket.IO connection timeout'));
                    }
                }, 10000); // Increased timeout to 10s
            } catch (error) {
                reject(error);
            }
        });
    }

    setupEventListeners() {
        // Header controls
        document.getElementById('scanPorts')?.addEventListener('click', () => this.scanPorts());
        document.getElementById('addSession')?.addEventListener('click', () => this.addSession());
        document.getElementById('exportData')?.addEventListener('click', () => this.exportData());

        // Global controls
        document.getElementById('connectAll')?.addEventListener('click', () => this.connectAllSessions());
        document.getElementById('disconnectAll')?.addEventListener('click', () => this.disconnectAllSessions());
        document.getElementById('clearAll')?.addEventListener('click', () => this.clearAllMessages());

        // Search and filter
        document.getElementById('globalSearch')?.addEventListener('input', (e) => this.filterMessages(e.target.value));
        document.getElementById('logLevel')?.addEventListener('change', (e) => this.filterByLogLevel(e.target.value));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        console.log('Event listeners setup complete');
    }

    handleKeyboardShortcuts(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'n':
                    e.preventDefault();
                    this.addSession();
                    break;
                case 's':
                    e.preventDefault();
                    this.scanPorts();
                    break;
                case 'e':
                    e.preventDefault();
                    this.exportData();
                    break;
            }
        }
    }

    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.toggle('active', show);
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;

        container.appendChild(notification);

        // Auto remove
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    getNotificationIcon(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'error': return 'exclamation-circle';
            case 'warning': return 'exclamation-triangle';
            default: return 'info-circle';
        }
    }

    async scanPorts() {
        try {
            this.showLoading(true);
            console.log('Scanning for available ports...');

            const response = await fetch(`${this.baseUrl}/api/ports`);
            const data = await response.json();

            if (data.success) {
                this.availablePorts = data.ports || [];
                this.updatePortSelectors();
                this.showNotification(`Found ${this.availablePorts.length} available ports`, 'success');
                console.log('Available ports:', this.availablePorts);
            } else {
                throw new Error(data.error || 'Failed to scan ports');
            }
        } catch (error) {
            console.error('Port scanning error:', error);
            this.showNotification('Failed to scan ports: ' + error.message, 'error');
            // Fallback to demo ports
            this.availablePorts = ['COM1', 'COM3', '/dev/ttyUSB0', '/dev/ttyACM0'];
            this.updatePortSelectors();
        } finally {
            this.showLoading(false);
        }
    }

    updatePortSelectors() {
        document.querySelectorAll('.port-select').forEach(select => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select Port...</option>';

            this.availablePorts.forEach(port => {
                const option = document.createElement('option');
                option.value = port;
                option.textContent = port;
                if (port === currentValue) option.selected = true;
                select.appendChild(option);
            });
        });
    }

    addSession() {
        const sessionId = ++this.sessionCounter;
        const template = document.getElementById('sessionTemplate');
        const clone = template.content.cloneNode(true);

        // Configure session
        const sessionCard = clone.querySelector('.session-card');
        sessionCard.dataset.sessionId = sessionId;

        const sessionName = clone.querySelector('.session-name');
        sessionName.textContent = `Session ${sessionId}`;

        // Setup session event listeners
        this.setupSessionEventListeners(clone, sessionId);

        // Add to container
        const container = document.getElementById('sessionsContainer');
        container.appendChild(clone);

        // Update port selector
        const portSelect = container.querySelector(`[data-session-id="${sessionId}"] .port-select`);
        this.updateSinglePortSelector(portSelect);

        // Create session object
        const session = {
            id: sessionId,
            port: null,
            baudRate: 115200,
            connected: false,
            messages: [],
            autoScroll: true,
            showTimestamps: true,
            echoCommands: false,
            reconnectAttempts: 0,
            maxReconnectAttempts: 3
        };

        this.sessions.set(sessionId, session);
        this.updateStats();
        this.showNotification(`Session ${sessionId} created`, 'success');

        console.log(`Session ${sessionId} added`);
    }

    addDefaultSession() {
        this.addSession();
    }

    setupSessionEventListeners(sessionElement, sessionId) {
        // Connect/Disconnect buttons
        const connectBtn = sessionElement.querySelector('.connect-btn');
        const disconnectBtn = sessionElement.querySelector('.disconnect-btn');
        const clearBtn = sessionElement.querySelector('.clear-btn');
        const closeBtn = sessionElement.querySelector('.close-btn');
        const sendBtn = sessionElement.querySelector('.send-btn');
        const messageInput = sessionElement.querySelector('.message-input');

        // Port and baud selectors
        const portSelect = sessionElement.querySelector('.port-select');
        const baudSelect = sessionElement.querySelector('.baud-select');

        // Checkboxes
        const autoScrollCheck = sessionElement.querySelector('.auto-scroll-checkbox');
        const timestampCheck = sessionElement.querySelector('.timestamp-checkbox');
        const echoCheck = sessionElement.querySelector('.echo-checkbox');

        connectBtn?.addEventListener('click', () => this.connectSession(sessionId));
        disconnectBtn?.addEventListener('click', () => this.disconnectSession(sessionId));
        clearBtn?.addEventListener('click', () => this.clearSessionMessages(sessionId));
        closeBtn?.addEventListener('click', () => this.removeSession(sessionId));
        sendBtn?.addEventListener('click', () => this.sendMessage(sessionId));

        messageInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage(sessionId);
            }
        });

        portSelect?.addEventListener('change', (e) => {
            const session = this.sessions.get(sessionId);
            if (session) session.port = e.target.value;
        });

        baudSelect?.addEventListener('change', (e) => {
            const session = this.sessions.get(sessionId);
            if (session) session.baudRate = parseInt(e.target.value);
        });

        autoScrollCheck?.addEventListener('change', (e) => {
            const session = this.sessions.get(sessionId);
            if (session) session.autoScroll = e.target.checked;
        });

        timestampCheck?.addEventListener('change', (e) => {
            const session = this.sessions.get(sessionId);
            if (session) session.showTimestamps = e.target.checked;
        });

        echoCheck?.addEventListener('change', (e) => {
            const session = this.sessions.get(sessionId);
            if (session) session.echoCommands = e.target.checked;
        });
    }

    updateSinglePortSelector(portSelect) {
        if (!portSelect) return;

        const currentValue = portSelect.value;
        portSelect.innerHTML = '<option value="">Select Port...</option>';

        this.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = port;
            if (port === currentValue) option.selected = true;
            portSelect.appendChild(option);
        });
    }

    async connectSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.connected) return;

        try {
            if (!session.port) {
                this.showNotification('Please select a port first', 'warning');
                return;
            }

            console.log(`Connecting session ${sessionId} to ${session.port} at ${session.baudRate} baud`);

            this.updateSessionStatus(sessionId, 'connecting', 'Connecting...');

            // Call Flask API to establish connection
            const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    port: session.port,
                    baud_rate: session.baudRate
                })
            });

            const data = await response.json();

            if (data.success) {
                session.connected = true;
                session.reconnectAttempts = 0;
                this.updateSessionStatus(sessionId, 'connected', 'Connected');
                this.updateSessionButtons(sessionId, true);
                this.addMessage(sessionId, `Connected to ${session.port} at ${session.baudRate} baud`, 'info');
                this.showNotification(`Session ${sessionId} connected to ${session.port}`, 'success');
            } else {
                throw new Error(data.error || 'Connection failed');
            }
        } catch (error) {
            console.error(`Connection error for session ${sessionId}:`, error);
            this.updateSessionStatus(sessionId, 'disconnected', 'Connection failed');
            this.showNotification(`Failed to connect session ${sessionId}: ${error.message}`, 'error');

            // Schedule reconnection attempt
            this.scheduleReconnection(sessionId);
        }

        this.updateStats();
    }

    async disconnectSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.connected) return;

        try {
            console.log(`Disconnecting session ${sessionId}`);

            // Call Flask API to close connection
            const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/disconnect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const data = await response.json();

            if (data.success) {
                session.connected = false;
                this.updateSessionStatus(sessionId, 'disconnected', 'Disconnected');
                this.updateSessionButtons(sessionId, false);
                this.addMessage(sessionId, `Disconnected from ${session.port}`, 'info');
                this.showNotification(`Session ${sessionId} disconnected`, 'success');
            } else {
                throw new Error(data.error || 'Disconnection failed');
            }
        } catch (error) {
            console.error(`Disconnection error for session ${sessionId}:`, error);
            this.showNotification(`Failed to disconnect session ${sessionId}`, 'error');
        }

        this.updateStats();
    }

    scheduleReconnection(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.reconnectAttempts >= session.maxReconnectAttempts) return;

        session.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 30000);

        this.addMessage(sessionId, `Reconnection attempt ${session.reconnectAttempts}/${session.maxReconnectAttempts} in ${delay / 1000}s`, 'warning');

        setTimeout(() => {
            if (!session.connected) {
                this.connectSession(sessionId);
            }
        }, delay);
    }

    handleSessionStatusUpdate(data) {
        const { session_id, status, message } = data;
        console.log(`Session ${session_id} status update:`, status, message);

        const session = this.sessions.get(session_id);
        if (!session) return;

        switch (status) {
            case 'connected':
                session.connected = true;
                this.updateSessionStatus(session_id, 'connected', 'Connected');
                this.updateSessionButtons(session_id, true);
                break;
            case 'disconnected':
                session.connected = false;
                this.updateSessionStatus(session_id, 'disconnected', 'Disconnected');
                this.updateSessionButtons(session_id, false);
                break;
            case 'error':
                session.connected = false;
                this.updateSessionStatus(session_id, 'disconnected', 'Error');
                this.updateSessionButtons(session_id, false);
                this.addMessage(session_id, `Error: ${message}`, 'error');
                break;
        }

        this.updateStats();
    }

    receiveMessage(sessionId, data, timestamp) {
        console.log(`Received message for session ${sessionId}:`, data);
        this.addMessage(sessionId, data, 'received', timestamp);
    }

    confirmMessageSent(sessionId, message, timestamp) {
        console.log(`Message sent confirmation for session ${sessionId}:`, message);
        // Message already added when sent, just log confirmation
    }

    async sendMessage(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.connected) {
            this.showNotification('Session not connected', 'warning');
            return;
        }

        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        const messageInput = sessionCard?.querySelector('.message-input');
        const message = messageInput?.value.trim();

        if (!message) return;

        try {
            // Echo command if enabled
            if (session.echoCommands) {
                this.addMessage(sessionId, message, 'sent');
            }

            // Send message via Flask API
            const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message
                })
            });

            const data = await response.json();

            if (data.success) {
                messageInput.value = '';
                console.log(`Message sent to session ${sessionId}: ${message}`);
                if (!session.echoCommands) {
                    this.addMessage(sessionId, message, 'sent');
                }
            } else {
                throw new Error(data.error || 'Send failed');
            }
        } catch (error) {
            console.error(`Send message error for session ${sessionId}:`, error);
            this.addMessage(sessionId, `Failed to send: ${message}`, 'error');
            this.showNotification(`Failed to send message to session ${sessionId}`, 'error');
        }
    }

    addMessage(sessionId, text, type = 'info', timestamp = null) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const messageTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();
        const message = {
            timestamp: messageTimestamp,
            text,
            type,
            id: Date.now() + Math.random()
        };

        session.messages.push(message);
        this.globalStats.totalMessages++;

        // Display message
        this.displayMessage(sessionId, message);
        this.updateStats();
    }

    displayMessage(sessionId, message) {
        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        const messageDisplay = sessionCard?.querySelector('.message-display');
        if (!messageDisplay) return;

        const session = this.sessions.get(sessionId);
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.type}`;

        let content = '';
        if (session?.showTimestamps) {
            const timeStr = message.timestamp.toLocaleTimeString();
            content += `<span class="timestamp">[${timeStr}]</span> `;
        }

        const prefix = this.getMessagePrefix(message.type);
        if (prefix) {
            content += `<span class="prefix">${prefix}</span> `;
        }

        content += message.text;
        messageElement.innerHTML = content;

        messageDisplay.appendChild(messageElement);

        // Auto-scroll if enabled
        if (session?.autoScroll) {
            messageDisplay.scrollTop = messageDisplay.scrollHeight;
        }

        // Limit message history
        const maxMessages = 1000;
        const messages = messageDisplay.querySelectorAll('.message');
        if (messages.length > maxMessages) {
            messages[0].remove();
            session.messages = session.messages.slice(-maxMessages);
        }
    }

    getMessagePrefix(type) {
        switch (type) {
            case 'sent': return '→';
            case 'received': return '←';
            case 'error': return '✗';
            case 'warning': return '⚠';
            case 'info': return 'ℹ';
            default: return '';
        }
    }

    updateSessionStatus(sessionId, status, text) {
        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        if (!sessionCard) return;

        const statusDot = sessionCard.querySelector('.status-dot');
        const statusText = sessionCard.querySelector('.status-text');

        statusDot?.classList.remove('connected', 'connecting');
        if (status !== 'disconnected') {
            statusDot?.classList.add(status);
        }

        if (statusText) {
            statusText.textContent = text;
        }
    }

    updateSessionButtons(sessionId, connected) {
        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        if (!sessionCard) return;

        const connectBtn = sessionCard.querySelector('.connect-btn');
        const disconnectBtn = sessionCard.querySelector('.disconnect-btn');

        if (connectBtn) connectBtn.disabled = connected;
        if (disconnectBtn) disconnectBtn.disabled = !connected;
    }

    clearSessionMessages(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.messages = [];

        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        const messageDisplay = sessionCard?.querySelector('.message-display');
        if (messageDisplay) {
            messageDisplay.innerHTML = '';
        }

        this.showNotification(`Session ${sessionId} messages cleared`, 'success');
        this.updateStats();
    }

    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Disconnect if connected
        if (session.connected) {
            this.disconnectSession(sessionId);
        }

        // Remove from DOM
        const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
        sessionCard?.remove();

        // Remove from sessions map
        this.sessions.delete(sessionId);

        this.showNotification(`Session ${sessionId} removed`, 'success');
        this.updateStats();
    }

    connectAllSessions() {
        this.sessions.forEach((session, sessionId) => {
            if (!session.connected && session.port) {
                setTimeout(() => this.connectSession(sessionId), Math.random() * 1000);
            }
        });
    }

    disconnectAllSessions() {
        this.sessions.forEach((session, sessionId) => {
            if (session.connected) {
                this.disconnectSession(sessionId);
            }
        });
    }

    clearAllMessages() {
        this.sessions.forEach((session, sessionId) => {
            this.clearSessionMessages(sessionId);
        });
    }

    filterMessages(searchTerm) {
        const term = searchTerm.toLowerCase();

        document.querySelectorAll('.message').forEach(messageEl => {
            const text = messageEl.textContent.toLowerCase();
            const isVisible = !term || text.includes(term);
            messageEl.style.display = isVisible ? 'block' : 'none';
        });
    }

    filterByLogLevel(level) {
        document.querySelectorAll('.message').forEach(messageEl => {
            const isVisible = level === 'all' || messageEl.classList.contains(level);
            messageEl.style.display = isVisible ? 'block' : 'none';
        });
    }

    updateStats() {
        const activeSessionsEl = document.getElementById('activeSessions');
        const totalMessagesEl = document.getElementById('totalMessages');
        const activeCount = Array.from(this.sessions.values())
            .filter(s => s.connected).length;

        console.log('Updating stats:', { activeSessions: activeCount, totalSessions: this.sessions.size });

        if (activeSessionsEl) {
            activeSessionsEl.textContent = activeCount;
        }
        if (totalMessagesEl) {
            totalMessagesEl.textContent = this.globalStats.totalMessages;
        }
        this.updateDebugSessionCount();
    }

    startUptimeTimer() {
        setInterval(() => {
            this.updateUptime();
        }, 1000);
    }

    updateUptime() {
        const uptimeEl = document.getElementById('uptime');
        if (!uptimeEl) return;

        const elapsed = Date.now() - this.globalStats.startTime;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);

        uptimeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    async exportData() {
        try {
            const response = await fetch(`${this.baseUrl}/api/export?message_count=1000`);
            const result = await response.json();

            if (result.success) {
                const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = `uart-monitor-export-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                URL.revokeObjectURL(url);
                this.showNotification('Data exported successfully', 'success');
            } else {
                throw new Error(result.error || 'Export failed');
            }
        } catch (error) {
            console.error('Export error:', error);
            this.showNotification('Failed to export data: ' + error.message, 'error');
        }
    }

    async getGlobalStats() {
        try {
            const response = await fetch(`${this.baseUrl}/api/stats`);
            const data = await response.json();

            if (data.success) {
                return data.stats;
            } else {
                throw new Error(data.error || 'Failed to get stats');
            }
        } catch (error) {
            console.error('Get stats error:', error);
            return null;
        }
    }

    async getSessionStats(sessionId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/stats`);
            const data = await response.json();

            if (data.success) {
                return data.stats;
            } else {
                throw new Error(data.error || 'Failed to get session stats');
            }
        } catch (error) {
            console.error('Get session stats error:', error);
            return null;
        }
    }
    updateAppStatus(status, text) {
        const statusDot = document.getElementById('appStatusDot');
        const statusText = document.getElementById('appStatusText');

        if (statusDot && statusText) {
            // Remove previous status classes
            statusDot.classList.remove('initializing', 'ready', 'error');

            // Add new status class
            statusDot.classList.add(status);
            statusText.textContent = text;
        }
    }


    updateDebugSocketStatus(connected) {
        const debugSocketStatus = document.getElementById('debugSocketStatus');
        if (debugSocketStatus) {
            debugSocketStatus.textContent = connected ? 'Connected' : 'Disconnected';
            debugSocketStatus.style.color = connected ? 'lightgreen' : 'red';
        }
    }

    updateDebugSessionCount() {
        const debugSessionCount = document.getElementById('debugSessionCount');
        if (debugSessionCount) {
            debugSessionCount.textContent = Array.from(this.sessions.values())
                .filter(s => s.connected).length;
        }
    }
}




// Initialize the application
const app = new UARTMonitorApp();