import http.server
import socketserver
import json
import os
import csv

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/api/goals':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            metas_file = os.path.join(DIRECTORY, 'metas.csv')
            goals = {}
            if os.path.exists(metas_file):
                try:
                    with open(metas_file, 'r', encoding='utf-8') as f:
                        reader = csv.reader(f)
                        header = next(reader, None) # Skip header row
                        for row in reader:
                            if len(row) >= 2:
                                key = row[0].strip()
                                val_str = row[1].strip()
                                try:
                                    goals[key] = int(val_str)
                                except ValueError:
                                    try:
                                        goals[key] = float(val_str)
                                    except ValueError:
                                        goals[key] = val_str
                except Exception as e:
                    goals = {"error": str(e)}
            
            self.wfile.write(json.dumps(goals, indent=4, ensure_ascii=False).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/goals':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                # Validate json
                goals = json.loads(post_data.decode('utf-8'))
                metas_file = os.path.join(DIRECTORY, 'metas.csv')
                
                # Write to metas.csv
                with open(metas_file, 'w', encoding='utf-8', newline='') as f:
                    writer = csv.writer(f)
                    writer.writerow(["Mês/Ano", "Meta"]) # CSV Headers
                    for k, v in goals.items():
                        writer.writerow([k, v])
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

# Set working directory to project directory
os.chdir(DIRECTORY)

# Allow reuse of address
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
    print(f"Server running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
