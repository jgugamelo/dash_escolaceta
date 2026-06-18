import http.server
import socketserver
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

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
