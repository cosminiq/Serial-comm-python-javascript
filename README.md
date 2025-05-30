# Multi-UART Serial Monitor

A web-based application for monitoring and managing multiple UART (serial) connections. Built with Flask and JavaScript, this tool provides a terminal-like interface for interacting with serial devices in real-time.

## Features

- **Serial Port Management**: Scan and list available serial ports.
- **Session Management**: Create and manage multiple independent serial sessions.
- **Configurable Connections**: Connect to serial ports with customizable settings (baud rate, data bits, stop bits, parity, flow control).
- **Real-time Communication**: Send and receive messages instantly using WebSockets.
- **Message Handling**: Filter and search messages within a terminal-inspired display.
- **Statistics**: Monitor connection status, message counts, and other metrics.
- **Data Export**: Export session data and statistics in JSON format.
- **Mock Mode**: Test without hardware using mock serial ports.
- **Responsive UI**: Terminal-themed interface with dark mode and monospaced fonts.

## Screenshots

![Main Interface](screenshots/main_interface.png)  
*Caption: Overview of the main interface showing multiple sessions.*

![Session Configuration](screenshots/session_config.png)  
*Caption: Configuring a session with port and baud rate selection.*

![Message Display](screenshots/message_display.png)  
*Caption: Terminal-like message display with sent and received messages.*

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/yourusername/multi-uart-monitor.git
   cd multi-uart-monitor
   ```

2. **Set Up a Virtual Environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

   *Note: Requires Python 3.6 or later. PySerial is necessary for actual serial communication; without it, the app uses mock ports for testing.*

## Usage

1. **Run the Application**:
   ```bash
   python uart_manager.py
   ```

   *Note: For production, consider using a WSGI server like Gunicorn (e.g., `gunicorn -w 4 uart_manager:app`).*

2. **Access the Interface**:
   Open your browser and navigate to `http://localhost:5000`.

3. **Interact**:
   - Scan for available ports.
   - Create sessions and connect to serial devices.
   - Send/receive messages and monitor statistics.

## Technologies Used

- **Backend**:
  - **Flask**: Lightweight web framework for Python.
  - **Flask-SocketIO**: Enables real-time WebSocket communication.
  - **PySerial**: Handles serial port communication (optional for mock mode).

- **Frontend**:
  - **HTML/CSS/JavaScript**: Core web technologies for the UI.
  - **Socket.IO**: Client-side library for real-time updates.

- **Other**:
  - **WebSockets**: Facilitates bi-directional communication.
  - **Asyncio**: Manages asynchronous operations in Python.

## Python-JavaScript Integration

The application seamlessly integrates Python and JavaScript:
- **Backend (Python)**: Flask serves the web interface and manages serial communication via PySerial. Flask-SocketIO handles WebSocket events, broadcasting messages and status updates to connected clients.
- **Frontend (JavaScript)**: The UI, built with JavaScript, communicates with the backend using HTTP requests (e.g., to scan ports or export data) and WebSockets (e.g., for real-time message updates). Socket.IO ensures the client stays synchronized with the server.
- **Data Flow**: User actions (e.g., connecting a session) trigger API calls or WebSocket events, processed by Python, with responses pushed back to the JavaScript frontend for display.

## Contributing

Contributions are welcome! Please fork the repository, make your changes, and submit a pull request.

## License

This project is licensed under the MIT License.