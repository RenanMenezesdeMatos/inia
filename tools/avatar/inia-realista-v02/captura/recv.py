import http.server, sys, base64, os, urllib.parse
OUT=sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","*"); self.send_header("Access-Control-Allow-Methods","POST, PUT, OPTIONS")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); body=self.rfile.read(n)
        name=os.path.basename(urllib.parse.urlparse(self.path).path) or "upload.bin"
        q=urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if "name" in q: name=os.path.basename(q["name"][0])
        if body.startswith(b"data:"): body=base64.b64decode(body.split(b",",1)[1])
        open(os.path.join(OUT,name),"wb").write(body)
        self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b"ok")
    do_PUT=do_POST
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(("127.0.0.1",8765),H).serve_forever()
