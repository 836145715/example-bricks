import http.client
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from proxy_engine import ProxyEngine


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"source":"fixture"}'
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


def test_proxy_captures_local_http_response():
    origin = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin_thread = threading.Thread(target=origin.serve_forever, daemon=True)
    origin_thread.start()
    captured = []
    engine = ProxyEngine(captured.append)
    proxy_port = 18991
    try:
        engine.start(proxy_port, 1024)
        connection = http.client.HTTPConnection("127.0.0.1", proxy_port, timeout=5)
        connection.request("GET", f"http://127.0.0.1:{origin.server_port}/fixture")
        response = connection.getresponse()
        assert response.status == 200
        assert response.read() == b'{"source":"fixture"}'
        deadline = time.time() + 3
        while not captured and time.time() < deadline:
            time.sleep(0.05)
        assert captured[0]["url"].endswith("/fixture")
        assert captured[0]["statusCode"] == 200
    finally:
        engine.stop()
        origin.shutdown()
        origin.server_close()
