// static/debug.js
document.addEventListener('DOMContentLoaded', () => {
    if (window.app) {
        const originalUpdateStats = window.app.updateStats;
        window.app.updateStats = function () {
            originalUpdateStats.call(this);
            const debugSessionCount = document.getElementById('debugSessionCount');
            if (debugSessionCount) {
                debugSessionCount.textContent = this.sessions.size;
            }
        };
        app.socket.on('connect', () => {
            const debugSocketStatus = document.getElementById('debugSocketStatus');
            if (debugSocketStatus) {
                debugSocketStatus.textContent = 'Connected';
                debugSocketStatus.style.color = 'lightgreen';
            }
        });
        app.socket.on('disconnect', () => {
            const debugSocketStatus = document.getElementById('debugSocketStatus');
            if (debugSocketStatus) {
                debugSocketStatus.textContent = 'Disconnected';
                debugSocketStatus.style.color = 'red';
            }
        });
        if (app.socket && app.socket.connected) {
            const debugSocketStatus = document.getElementById('debugSocketStatus');
            if (debugSocketStatus) {
                debugSocketStatus.textContent = 'Connected';
                debugSocketStatus.style.color = 'lightgreen';
            }
        }
        // Force initial update
        window.app.updateStats();
    } else {
        console.error('window.app is undefined in debug.js');
    }
});