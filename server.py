"""
ECOBAT Smart AI BMS - Enterprise Real-Time Web & API Server
Serves Web Dashboard and Real-Time SSE/REST Telemetry API
"""

import argparse
import http.server
import json
import os
import random
import socketserver
import sys
import threading
import time
import webbrowser

# Fix Windows console UTF-8 printing
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Global Simulation & Prototype Hardware State in Python
SERVER_START_TIME = time.time()
bms_state = {
    "voltage": 350.0,
    "current": -45.2,
    "temperature": 29.4,
    "soc": 64.5,
    "soh": 97.8,
    "cycles": 215,
    "mode": "discharge",
    "step": 0,
    # Prototype & Hardware Controller States
    "hardware_connected": False,
    "hardware_source": "simulated", # "simulated", "web_serial", "esp32_wifi", "can_gateway"
    "hardware_last_seen": 0,
    "contactor_state": "CLOSED", # "CLOSED" (ON), "OPEN" (OFF/Isolated)
    "cooling_fan_pwm": 35, # 0 - 100%
    "current_limit": 90.0, # Amperes
    "balancer_mode": "AUTO", # "AUTO", "FORCE", "OFF"
    "estop_active": False,
    "cells": [round(3.645 + (i % 4) * 0.004, 3) for i in range(16)],
    "cell_temps": [round(28.8 + (i % 3) * 0.4, 1) for i in range(16)]
}

# Pending command queue for hardware prototype
hardware_command_queue = []

def update_physics_step():
    """Simulates one physics & telemetry update step on the backend if no physical hardware is overriding."""
    global bms_state
    bms_state["step"] += 1

    # Check if physical hardware timed out (10s threshold)
    if bms_state["hardware_connected"] and (time.time() - bms_state["hardware_last_seen"] > 10.0):
        bms_state["hardware_connected"] = False
        bms_state["hardware_source"] = "simulated"
    
    # If Estop is triggered, cut current to 0 and isolate
    if bms_state.get("estop_active"):
        bms_state["current"] = 0.0
        bms_state["contactor_state"] = "OPEN"
        return

    # If contactor is open, zero out current
    if bms_state.get("contactor_state") == "OPEN":
        bms_state["current"] = 0.0
        return

    # If no live hardware is overriding data, run dynamic simulated physics
    if not bms_state["hardware_connected"]:
        # State of charge transitions
        if bms_state["soc"] <= 15.0:
            bms_state["mode"] = "charge"
        elif bms_state["soc"] >= 92.0:
            bms_state["mode"] = "discharge"
            
        if bms_state["mode"] == "charge":
            charge_cap = min(bms_state["current_limit"], 75.0)
            bms_state["current"] = round(35.0 + random.uniform(0, max(5.0, charge_cap - 35.0)), 1)
            bms_state["soc"] = min(100.0, bms_state["soc"] + random.uniform(0.2, 0.45))
        else:
            bms_state["current"] = -round(25.0 + random.uniform(0, 50.0), 1)
            bms_state["soc"] = max(0.0, bms_state["soc"] - random.uniform(0.15, 0.40))
            
        bms_state["soc"] = round(bms_state["soc"], 2)
        bms_state["voltage"] = round(300.0 + (bms_state["soc"] / 100.0) * 100.0 + random.uniform(-0.8, 0.8), 1)
        
        # Heat calculation factoring in cooling fan PWM
        stress = abs(bms_state["current"]) / 120.0
        heat = 0.45 * stress
        fan_cooling = (bms_state["cooling_fan_pwm"] / 100.0) * 0.20
        passive_cooling = 0.08 * (bms_state["temperature"] - 27.0)
        bms_state["temperature"] = round(min(60.0, max(15.0, bms_state["temperature"] + heat - fan_cooling - passive_cooling + random.uniform(-0.15, 0.15))), 1)

        # Update 16 individual cells
        cell_base = bms_state["voltage"] / 96.0
        cells = []
        for i in range(16):
            variance = (random.uniform(-0.008, 0.008))
            cells.append(round(cell_base + variance, 3))
        bms_state["cells"] = cells

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

class EcobatHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_OPTIONS(self):
        # Support CORS preflight requests
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, Authorization")
        self.end_headers()

    def do_GET(self):
        # 1. API Status Endpoint
        if self.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            uptime = int(time.time() - SERVER_START_TIME)
            status_data = {
                "status": "ONLINE",
                "system": "ECOBAT Smart AI BMS Enterprise Server",
                "version": "3.1.0",
                "uptime_seconds": uptime,
                "hardware_connected": bms_state["hardware_connected"],
                "hardware_source": bms_state["hardware_source"],
                "python_version": sys.version.split()[0],
                "telemetry_stream": "SSE Active (/api/stream)",
                "prototype_api": {
                    "push_telemetry": "POST /api/prototype/telemetry",
                    "send_command": "POST /api/prototype/command",
                    "poll_commands": "GET /api/prototype/command"
                }
            }
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
            return

        # 2. API Telemetry Endpoint
        if self.path == "/api/telemetry":
            update_physics_step()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            rul = max(0, int(((bms_state["soh"] - 80.0) / 20.0) * 10000))
            payload = {
                **bms_state,
                "rul_cycles": rul,
                "latency_ms": random.randint(4, 12),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
            return

        # 3. Server-Sent Events (SSE) Live Real-Time Stream
        if self.path == "/api/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            try:
                while True:
                    update_physics_step()
                    rul = max(0, int(((bms_state["soh"] - 80.0) / 20.0) * 10000))
                    payload = {
                        **bms_state,
                        "rul_cycles": rul,
                        "latency_ms": random.randint(4, 10),
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    data_str = f"data: {json.dumps(payload)}\n\n"
                    self.wfile.write(data_str.encode("utf-8"))
                    self.wfile.flush()
                    time.sleep(1.0)
            except (BrokenPipeError, ConnectionResetError):
                return
            return

        # 4. Prototype Hardware Polling for Pending Commands (e.g., from ESP32/Arduino)
        if self.path == "/api/prototype/command":
            global hardware_command_queue
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            cmds = list(hardware_command_queue)
            hardware_command_queue.clear() # consume commands
            response_payload = {
                "commands": cmds,
                "status": "OK",
                "timestamp": time.time()
            }
            self.wfile.write(json.dumps(response_payload).encode("utf-8"))
            return

        # 5. Prototype Hardware Status
        if self.path == "/api/prototype/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "connected": bms_state["hardware_connected"],
                "source": bms_state["hardware_source"],
                "contactor": bms_state["contactor_state"],
                "cooling_fan_pwm": bms_state["cooling_fan_pwm"],
                "current_limit": bms_state["current_limit"],
                "balancer_mode": bms_state["balancer_mode"],
                "estop": bms_state["estop_active"],
                "last_seen": bms_state["hardware_last_seen"]
            }).encode("utf-8"))
            return

        # Fallback to static files (HTML, CSS, JS)
        super().do_GET()

    def do_POST(self):
        # 1. Prototype Command Endpoint (Dispatched from UI to Hardware Prototype)
        if self.path == "/api/prototype/command":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                cmd = data.get("command", "")
                val = data.get("value")

                if cmd == "SET_CONTACTOR":
                    bms_state["contactor_state"] = "CLOSED" if val in ["CLOSED", True, 1] else "OPEN"
                elif cmd == "SET_FAN_PWM":
                    bms_state["cooling_fan_pwm"] = max(0, min(100, int(val)))
                elif cmd == "SET_CURRENT_LIMIT":
                    bms_state["current_limit"] = max(5.0, min(150.0, float(val)))
                elif cmd == "SET_BALANCER":
                    bms_state["balancer_mode"] = str(val).upper()
                elif cmd == "TRIGGER_ESTOP":
                    bms_state["estop_active"] = bool(val)
                    if bms_state["estop_active"]:
                        bms_state["contactor_state"] = "OPEN"
                        bms_state["current"] = 0.0
                elif cmd == "RESET_ESTOP":
                    bms_state["estop_active"] = False

                # Queue command for physical board polling
                hardware_command_queue.append({
                    "command": cmd,
                    "value": val,
                    "id": f"cmd_{int(time.time()*1000)}"
                })

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "COMMAND_QUEUED",
                    "command": cmd,
                    "current_state": bms_state
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        # 2. Prototype Telemetry Push Endpoint (Hardware sends its live sensor data here)
        if self.path == "/api/prototype/telemetry":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                
                # Update state from physical hardware
                bms_state["hardware_connected"] = True
                bms_state["hardware_source"] = data.get("source", "esp32_wifi")
                bms_state["hardware_last_seen"] = time.time()

                for k in ["voltage", "current", "temperature", "soc", "soh", "cycles", "mode", "contactor_state"]:
                    if k in data:
                        bms_state[k] = data[k]
                
                if "cells" in data and isinstance(data["cells"], list):
                    bms_state["cells"] = data["cells"]
                if "cell_temps" in data and isinstance(data["cell_temps"], list):
                    bms_state["cell_temps"] = data["cell_temps"]

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "TELEMETRY_RECEIVED",
                    "ack_time": time.time(),
                    "queued_commands": len(hardware_command_queue)
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        # 3. General Dashboard Control Endpoint
        if self.path == "/api/control":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                command = json.loads(post_data.decode("utf-8"))
                for k in ["voltage", "current", "temperature", "soc", "mode", "cooling_fan_pwm", "current_limit", "balancer_mode", "contactor_state"]:
                    if k in command:
                        bms_state[k] = command[k]
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "SUCCESS", "current_state": bms_state}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        # 4. Vercel AI SDK Agent Endpoint (/api/agent)
        if self.path == "/api/agent":
            import subprocess
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                node_script = """
import handler from './api/agent.mjs';
const input = JSON.parse(process.argv[1] || '{}');
const req = { method: 'POST', body: input };
const res = {
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(payload) { console.log(JSON.stringify(payload)); return this; },
  end() {}
};
await handler(req, res);
"""
                proc = subprocess.run(
                    ["node", "--input-type=module", "-e", node_script, post_data.decode("utf-8")],
                    cwd=DIRECTORY,
                    capture_output=True,
                    text=True,
                    timeout=20
                )
                out = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(out.encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        super().do_POST()

def run_server(port=PORT, open_browser=True):
    os.chdir(DIRECTORY)
    server_address = ("", port)
    httpd = ThreadedHTTPServer(server_address, EcobatHandler)
    
    url = f"http://localhost:{port}"
    print("==================================================================")
    print("      [ECOBAT SMART AI BMS - ENTERPRISE REAL-TIME SERVER]         ")
    print("==================================================================")
    print(f" Web Dashboard URL : {url}")
    print(f" REST API Status   : {url}/api/status")
    print(f" Telemetry API     : {url}/api/telemetry")
    print(f" Live SSE Stream   : {url}/api/stream")
    print(" Modern Pastel Theme, 16-Cell Balancer & Audio Ready!")
    print(" Tekan Ctrl+C untuk menghentikan server.")
    print("==================================================================")
    
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Server dihentikan oleh pengguna.")
        httpd.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ECOBAT Real-Time Server")
    parser.add_argument("--port", type=int, default=PORT, help="Port untuk server (default: 8080)")
    parser.add_argument("--no-browser", action="store_true", help="Jangan otomatis buka browser")
    args = parser.parse_args()
    
    run_server(port=args.port, open_browser=not args.no_browser)
