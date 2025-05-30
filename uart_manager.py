"""
Multi-UART Serial Monitor - Flask Backend
Handles serial port communication, connection management, and data processing
"""

from flask import Flask, request, jsonify, render_template

from flask_socketio import SocketIO, emit
import asyncio
import json
import time
import threading
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum
import logging

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    print("PySerial not available - using mock implementation")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'uart-monitor-secret-key'
#socketio = SocketIO(app, cors_allowed_origins="*")
#socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

try:
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
except ValueError:
    try:
        socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
    except (ValueError, ImportError):
        socketio = SocketIO(app, cors_allowed_origins="*")




class ConnectionStatus(Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"  
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class SerialMessage:
    timestamp: float
    session_id: int
    message: str
    message_type: str = "received"  # sent, received, error, info


@dataclass
class SessionConfig:
    session_id: int
    port: str
    baud_rate: int = 115200
    timeout: float = 1.0
    data_bits: int = 8
    stop_bits: int = 1
    parity: str = 'N'  # N, E, O
    flow_control: bool = False


class SerialSession:
    """Manages individual serial port connection"""
    
    def __init__(self, config: SessionConfig):
        self.config = config
        self.connection: Optional[serial.Serial] = None
        self.status = ConnectionStatus.DISCONNECTED
        self.read_thread: Optional[threading.Thread] = None
        self.running = False
        self.message_buffer: List[SerialMessage] = []
        self.stats = {
            'bytes_sent': 0,
            'bytes_received': 0,
            'messages_sent': 0,
            'messages_received': 0,
            'connection_time': None,
            'last_activity': None,
            'reconnect_attempts': 0,
            'max_reconnect_attempts': 3,
            'errors': []
        }
        
    def connect(self) -> bool:
        """Establish serial connection"""
        try:
            if not SERIAL_AVAILABLE:
                return self._mock_connect()
                
            self.status = ConnectionStatus.CONNECTING
            logger.info(f"Connecting to {self.config.port} at {self.config.baud_rate} baud")
            
            # Configure serial connection
            self.connection = serial.Serial(
                port=self.config.port,
                baudrate=self.config.baud_rate,
                bytesize=self.config.data_bits,
                stopbits=self.config.stop_bits,
                parity=self.config.parity,
                timeout=self.config.timeout,
                xonxoff=self.config.flow_control,
                rtscts=self.config.flow_control,
                dsrdtr=self.config.flow_control
            )
            
            # Test connection
            if self.connection.is_open:
                self.status = ConnectionStatus.CONNECTED
                self.stats['connection_time'] = time.time()
                self.stats['reconnect_attempts'] = 0
                self.running = True
                
                # Start read thread
                self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
                self.read_thread.start()
                
                logger.info(f"Session {self.config.session_id} connected successfully")
                
                # Emit connection status to frontend
                socketio.emit('session_status', {
                    'session_id': self.config.session_id,
                    'status': 'connected',
                    'message': f'Connected to {self.config.port}'
                })
                
                return True
            else:
                raise Exception("Failed to open serial port")
                
        except Exception as e:
            self.status = ConnectionStatus.ERROR
            error_msg = f"Connection error for session {self.config.session_id}: {str(e)}"
            logger.error(error_msg)
            self.stats['errors'].append({
                'timestamp': time.time(),
                'error': str(e),
                'type': 'connection'
            })
            
            # Emit error status to frontend
            socketio.emit('session_status', {
                'session_id': self.config.session_id,
                'status': 'error',
                'message': str(e)
            })
            
            return False
    
    def _mock_connect(self) -> bool:
        """Mock connection for testing without hardware"""
        logger.info(f"Mock connection to {self.config.port}")
        self.status = ConnectionStatus.CONNECTED
        self.stats['connection_time'] = time.time()
        self.running = True
        
        # Start mock read thread
        self.read_thread = threading.Thread(target=self._mock_read_loop, daemon=True)
        self.read_thread.start()
        
        # Emit connection status to frontend
        socketio.emit('session_status', {
            'session_id': self.config.session_id,
            'status': 'connected',
            'message': f'Mock connected to {self.config.port}'
        })
        
        return True
    
    def disconnect(self) -> bool:
        """Close serial connection"""
        try:
            self.running = False
            
            if self.read_thread and self.read_thread.is_alive():
                self.read_thread.join(timeout=2.0)
            
            if self.connection and self.connection.is_open:
                self.connection.close()
                
            self.status = ConnectionStatus.DISCONNECTED
            logger.info(f"Session {self.config.session_id} disconnected")
            
            # Emit disconnection status to frontend
            socketio.emit('session_status', {
                'session_id': self.config.session_id,
                'status': 'disconnected',
                'message': 'Disconnected'
            })
            
            return True
            
        except Exception as e:
            error_msg = f"Disconnect error for session {self.config.session_id}: {str(e)}"
            logger.error(error_msg)
            self.stats['errors'].append({
                'timestamp': time.time(),
                'error': str(e),
                'type': 'disconnection'
            })
            return False
    
    def send_message(self, message: str) -> bool:
        """Send message through serial connection"""
        try:
            if self.status != ConnectionStatus.CONNECTED:
                raise Exception("Session not connected")
            
            if not SERIAL_AVAILABLE or not self.connection:
                return self._mock_send(message)
            
            # Add newline if not present
            if not message.endswith('\n'):
                message += '\n'
            
            bytes_to_send = message.encode('utf-8')
            bytes_sent = self.connection.write(bytes_to_send)
            
            if bytes_sent > 0:
                self.stats['bytes_sent'] += bytes_sent
                self.stats['messages_sent'] += 1
                self.stats['last_activity'] = time.time()
                
                # Log sent message
                sent_msg = SerialMessage(
                    timestamp=time.time(),
                    session_id=self.config.session_id,
                    message=message.strip(),
                    message_type="sent"
                )
                self.message_buffer.append(sent_msg)
                
                # Emit sent message to frontend
                socketio.emit('message_sent', {
                    'session_id': self.config.session_id,
                    'message': message.strip(),
                    'timestamp': time.time()
                })
                
                logger.info(f"Session {self.config.session_id} sent: {message.strip()}")
                return True
            
            return False
            
        except Exception as e:
            error_msg = f"Send error for session {self.config.session_id}: {str(e)}"
            logger.error(error_msg)
            self.stats['errors'].append({
                'timestamp': time.time(),
                'error': str(e),
                'type': 'send'
            })
            return False
    
    def _mock_send(self, message: str) -> bool:
        """Mock send for testing"""
        logger.info(f"Mock send on session {self.config.session_id}: {message}")
        self.stats['messages_sent'] += 1
        self.stats['last_activity'] = time.time()
        
        # Emit sent message to frontend
        socketio.emit('message_sent', {
            'session_id': self.config.session_id,
            'message': message.strip(),
            'timestamp': time.time()
        })
        
        return True
    
    def _read_loop(self):
        """Background thread for reading serial data"""
        logger.info(f"Started read loop for session {self.config.session_id}")
        
        while self.running and self.connection and self.connection.is_open:
            try:
                if self.connection.in_waiting > 0:
                    data = self.connection.readline()
                    if data:
                        message = data.decode('utf-8', errors='ignore').strip()
                        if message:
                            self._process_received_message(message)
                else:
                    time.sleep(0.01)  # Small delay to prevent CPU hogging
                    
            except Exception as e:
                if self.running:  # Only log if we're still supposed to be running
                    error_msg = f"Read error for session {self.config.session_id}: {str(e)}"
                    logger.error(error_msg)
                    self.stats['errors'].append({
                        'timestamp': time.time(),
                        'error': str(e),
                        'type': 'read'
                    })
                break
        
        logger.info(f"Read loop ended for session {self.config.session_id}")
    
    def _mock_read_loop(self):
        """Mock read loop for testing"""
        logger.info(f"Started mock read loop for session {self.config.session_id}")
        
        mock_messages = [
            "System initialized",
            "Temperature: 24.5°C",
            "Voltage: 3.3V",
            "Memory usage: 42%",
            "Signal strength: -65dBm",
            "Sensor data: 123.45",
            "Status: OK",
            "Heartbeat",
            "Debug: Main loop iteration",
            "Info: WiFi connected",
            "Warning: Low battery",
            "Error: Sensor timeout"
        ]
        
        message_index = 0
        
        while self.running:
            try:
                # Send mock message every 3-8 seconds
                time.sleep(3 + (time.time() % 5))
                
                if self.running:
                    message = mock_messages[message_index % len(mock_messages)]
                    message_index += 1
                    self._process_received_message(message)
                    
            except Exception as e:
                logger.error(f"Mock read error: {str(e)}")
                break
    
    def _process_received_message(self, message: str):
        """Process and forward received message"""
        try:
            self.stats['messages_received'] += 1
            self.stats['bytes_received'] += len(message.encode('utf-8'))
            self.stats['last_activity'] = time.time()
            
            # Create message object
            msg = SerialMessage(
                timestamp=time.time(),
                session_id=self.config.session_id,
                message=message,
                message_type="received"
            )
            
            self.message_buffer.append(msg)
            
            # Limit buffer size
            if len(self.message_buffer) > 1000:
                self.message_buffer = self.message_buffer[-1000:]
            
            # Emit received message to frontend
            socketio.emit('message_received', {
                'session_id': self.config.session_id,
                'message': message,
                'timestamp': time.time()
            })
            
        except Exception as e:
            logger.error(f"Message processing error: {str(e)}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get session statistics"""
        stats = self.stats.copy()
        stats['status'] = self.status.value
        stats['port'] = self.config.port
        stats['baud_rate'] = self.config.baud_rate
        stats['message_count'] = len(self.message_buffer)
        
        if stats['connection_time']:
            stats['uptime'] = time.time() - stats['connection_time']
        
        return stats

    def get_recent_messages(self, count: int = 50) -> List[Dict[str, Any]]:
        """Get recent messages for export/display"""
        recent_messages = self.message_buffer[-count:] if count > 0 else self.message_buffer
        return [asdict(msg) for msg in recent_messages]

    def clear_message_buffer(self):
        """Clear the message buffer"""
        self.message_buffer.clear()
        logger.info(f"Message buffer cleared for session {self.config.session_id}")


class UARTManager:
    """Main manager for multiple UART sessions"""
    
    def __init__(self):
        self.sessions: Dict[int, SerialSession] = {}
        self.available_ports: List[str] = []
        self.last_port_scan = 0
        self.scan_interval = 5.0  # seconds
        self.global_stats = {
            'total_sessions_created': 0,
            'total_messages_processed': 0,
            'start_time': time.time(),
            'last_activity': None
        }
        
        logger.info("UART Manager initialized")
    
    def scan_serial_ports(self) -> List[str]:
        """Scan for available serial ports"""
        try:
            current_time = time.time()
            
            # Use cached result if recent
            if current_time - self.last_port_scan < self.scan_interval:
                return self.available_ports
            
            if not SERIAL_AVAILABLE:
                # Mock ports for testing
                self.available_ports = [
                    'COM1', 'COM3', 'COM4', 'COM5',
                    '/dev/ttyUSB0', '/dev/ttyUSB1',
                    '/dev/ttyACM0', '/dev/ttyACM1',
                    '/dev/ttyS0', '/dev/ttyS1'
                ]
                logger.info("Using mock serial ports")
            else:
                # Scan real ports
                ports = serial.tools.list_ports.comports()
                self.available_ports = []
                
                for port in ports:
                    self.available_ports.append(port.device)
                    logger.info(f"Found port: {port.device} - {port.description}")
                
                logger.info(f"Found {len(self.available_ports)} serial ports")
            
            self.last_port_scan = current_time
            return self.available_ports
            
        except Exception as e:
            logger.error(f"Port scan error: {str(e)}")
            return []
    
    def connect_session(self, session_id: int, port: str, baud_rate: int = 115200) -> bool:
        """Create and connect a new session"""
        try:
            # Disconnect existing session if any
            if session_id in self.sessions:
                self.disconnect_session(session_id)
            
            # Create new session config
            config = SessionConfig(
                session_id=session_id,
                port=port,
                baud_rate=baud_rate
            )
            
            # Create and connect session
            session = SerialSession(config)
            success = session.connect()
            
            if success:
                self.sessions[session_id] = session
                self.global_stats['total_sessions_created'] += 1
                self.global_stats['last_activity'] = time.time()
                logger.info(f"Session {session_id} connected to {port}")
                return True
            else:
                logger.error(f"Failed to connect session {session_id} to {port}")
                return False
                
        except Exception as e:
            logger.error(f"Connect session error: {str(e)}")
            return False
    
    def disconnect_session(self, session_id: int) -> bool:
        """Disconnect and remove a session"""
        try:
            if session_id not in self.sessions:
                logger.info(f"Session {session_id} not found")
                return True
            
            session = self.sessions[session_id]
            success = session.disconnect()
            
            if success:
                del self.sessions[session_id]
                logger.info(f"Session {session_id} disconnected and removed")
                return True
            else:
                logger.error(f"Failed to disconnect session {session_id}")
                return False
                
        except Exception as e:
            logger.error(f"Disconnect session error: {str(e)}")
            return False
    
    def send_message(self, session_id: int, message: str) -> bool:
        """Send message to specific session"""
        try:
            if session_id not in self.sessions:
                logger.error(f"Session {session_id} not found")
                return False
            
            session = self.sessions[session_id]
            success = session.send_message(message)
            
            if success:
                self.global_stats['total_messages_processed'] += 1
                self.global_stats['last_activity'] = time.time()
            
            return success
            
        except Exception as e:
            logger.error(f"Send message error: {str(e)}")
            return False
    
    def get_session_stats(self, session_id: int) -> Optional[Dict[str, Any]]:
        """Get statistics for specific session"""
        if session_id not in self.sessions:
            return None
        
        return self.sessions[session_id].get_stats()
    
    def get_all_sessions_stats(self) -> Dict[int, Dict[str, Any]]:
        """Get statistics for all sessions"""
        stats = {}
        for session_id, session in self.sessions.items():
            stats[session_id] = session.get_stats()
        
        return stats
    
    def get_global_stats(self) -> Dict[str, Any]:
        """Get global manager statistics"""
        stats = self.global_stats.copy()
        stats['active_sessions'] = len([s for s in self.sessions.values() 
                                       if s.status == ConnectionStatus.CONNECTED])
        stats['total_sessions'] = len(self.sessions)
        stats['uptime'] = time.time() - stats['start_time']
        
        # Aggregate session stats
        total_messages_sent = sum(s.stats['messages_sent'] for s in self.sessions.values())
        total_messages_received = sum(s.stats['messages_received'] for s in self.sessions.values())
        total_bytes_sent = sum(s.stats['bytes_sent'] for s in self.sessions.values())
        total_bytes_received = sum(s.stats['bytes_received'] for s in self.sessions.values())
        
        stats['total_messages_sent'] = total_messages_sent
        stats['total_messages_received'] = total_messages_received
        stats['total_bytes_sent'] = total_bytes_sent
        stats['total_bytes_received'] = total_bytes_received
        
        return stats
    
    def export_session_data(self, session_id: int, message_count: int = 0) -> Optional[Dict[str, Any]]:
        """Export data for specific session"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        return {
            'session_id': session_id,
            'config': asdict(session.config),
            'stats': session.get_stats(),
            'messages': session.get_recent_messages(message_count)
        }
    
    def export_all_data(self, message_count: int = 100) -> Dict[str, Any]:
        """Export all data from manager"""
        export_data = {
            'timestamp': time.time(),
            'global_stats': self.get_global_stats(),
            'available_ports': self.available_ports,
            'sessions': {}
        }
        
        for session_id in self.sessions:
            session_data = self.export_session_data(session_id, message_count)
            if session_data:
                export_data['sessions'][session_id] = session_data
        
        return export_data


# Global UART Manager instance
uart_manager = UARTManager()


# Flask Routes
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/ports', methods=['GET'])
def get_ports():
    """Get available serial ports"""
    try:
        ports = uart_manager.scan_serial_ports()
        return jsonify({'success': True, 'ports': ports})
    except Exception as e:
        logger.error(f"Get ports error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/connect', methods=['POST'])
def connect_session(session_id):
    """Connect a session to a serial port"""
    try:
        data = request.get_json()
        port = data.get('port')
        baud_rate = data.get('baud_rate', 115200)
        
        if not port:
            return jsonify({'success': False, 'error': 'Port is required'}), 400
        
        success = uart_manager.connect_session(session_id, port, baud_rate)
        return jsonify({'success': success})
    except Exception as e:
        logger.error(f"Connect session error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/disconnect', methods=['POST'])
def disconnect_session(session_id):
    """Disconnect a session"""
    try:
        success = uart_manager.disconnect_session(session_id)
        return jsonify({'success': success})
    except Exception as e:
        logger.error(f"Disconnect session error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/send', methods=['POST'])
def send_message(session_id):
    """Send message to a session"""
    try:
        data = request.get_json()
        message = data.get('message', '')
        
        success = uart_manager.send_message(session_id, message)
        return jsonify({'success': success})
    except Exception as e:
        logger.error(f"Send message error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/stats', methods=['GET'])
def get_session_stats(session_id):
    """Get session statistics"""
    try:
        stats = uart_manager.get_session_stats(session_id)
        if stats is None:
            return jsonify({'success': False, 'error': 'Session not found'}), 404
        
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        logger.error(f"Get session stats error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stats', methods=['GET'])
def get_global_stats():
    """Get global statistics"""
    try:
        stats = uart_manager.get_global_stats()
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        logger.error(f"Get global stats error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/export', methods=['GET'])
def export_data():
    """Export all data"""
    try:
        session_id = request.args.get('session_id', type=int)
        message_count = request.args.get('message_count', 100, type=int)
        
        if session_id is not None:
            data = uart_manager.export_session_data(session_id, message_count)
            if data is None:
                return jsonify({'success': False, 'error': 'Session not found'}), 404
        else:
            data = uart_manager.export_all_data(message_count)
        
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        logger.error(f"Export data error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    emit('connected', {'status': 'Connected to UART Monitor'})


@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")


if __name__ == '__main__':
    logger.info("Starting UART Monitor Flask Application")
    #socketio.run(app, debug=True, host='0.0.0.0', port=5000)
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)