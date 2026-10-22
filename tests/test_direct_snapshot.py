"""Direct JPEG adapter against a synthetic Digest camera only. No real devices."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / 'bridge/WisenetPtzBridge/bin/Release/net8.0/WisenetPtzBridge.dll'
JPEG = bytes.fromhex('ffd8ffc00008080050006401ffd9')
PATH = '/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1'
USER, PASSWORD = 'synthetic-camera-user', 'synthetic-camera-password'


class Camera(BaseHTTPRequestHandler):
    requests = []
    behavior = 'jpeg'
    def log_message(self, *_): pass
    def do_GET(self):
        Camera.requests.append((self.command, self.path, self.headers.get('Authorization', '')))
        if Camera.behavior == 'basic':
            self.send_response(401); self.send_header('WWW-Authenticate', 'Basic realm="synthetic-realm"'); self.end_headers(); return
        auth = self.headers.get('Authorization', '')
        values = {}
        for match in re.finditer(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', auth): values[match[1]] = match[2] or match[3]
        md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
        ha1 = md5(USER + ':synthetic-realm:' + PASSWORD)
        ha2 = md5('GET:' + self.path)
        expected = md5(':'.join([ha1, 'synthetic-nonce', values.get('nc', ''), values.get('cnonce', ''), 'auth', ha2]))
        if not auth.startswith('Digest ') or values.get('username') != USER or values.get('response') != expected:
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Digest realm="synthetic-realm", nonce="synthetic-nonce", algorithm=MD5, qop="auth"')
            self.send_header('Content-Length', '0'); self.end_headers(); return
        if Camera.behavior == 'forbidden': self.send_response(403); self.end_headers(); return
        if Camera.behavior == 'redirect':
            self.send_response(302); self.send_header('Location', '/must-not-follow'); self.end_headers(); return
        body = b'<html>synthetic login</html>' if Camera.behavior == 'html' else b'not a jpeg' if Camera.behavior == 'corrupt' else JPEG
        self.send_response(200)
        self.send_header('Content-Type', 'text/html' if Camera.behavior == 'html' else 'image/jpeg')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)


class DirectSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.work = Path(cls.temp.name)
        cls.camera = ThreadingHTTPServer(('127.0.0.1', 0), Camera)
        threading.Thread(target=cls.camera.serve_forever, daemon=True).start()
        cls.camera_base = f'http://127.0.0.1:{cls.camera.server_port}'
        cls.dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        if not cls.dotnet or not DLL.exists(): raise RuntimeError('Build Bridge and configure DOTNET_EXECUTABLE.')
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'; cls.key = secrets.token_urlsafe(24)
        env = os.environ.copy(); env.update(ASPNETCORE_URLS=cls.base, ASPNETCORE_ENVIRONMENT='Production', DIRECT_CAMERA_SNAPSHOT_ENABLED='true', CAPTURE_READ_KEY=cls.key)
        cls.log_path = cls.work / 'bridge.log'; cls.log = cls.log_path.open('wb')
        cls.process = subprocess.Popen([cls.dotnet, str(DLL)], cwd=cls.work, env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.base + '/health', timeout=1): break
            except urllib.error.URLError: time.sleep(.05)
        else: raise RuntimeError('Bridge startup timeout')
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=8); cls.log.close(); cls.camera.shutdown(); cls.camera.server_close(); cls.temp.cleanup()
    def request(self, path='status', method='GET', body=None, key=True, headers=None):
        h = {'Content-Type': 'application/json'}
        if key: h['X-Capture-Read-Key'] = self.key
        if headers: h.update(headers)
        req = urllib.request.Request(self.base + '/api/camera-snapshot/' + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
        try: response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as e: response = e
        with response: return response.status, response.read(), response.headers
    def payload(self, **overrides):
        return dict(cameraLabel='Synthetic direct camera', snapshotUrl=self.camera_base + PATH, username=USER, password=PASSWORD, **overrides)
    def start(self, **overrides):
        body = self.payload(); body.update(overrides)
        status, raw, _ = self.request('session', 'POST', body)
        return status, json.loads(raw)
    def setUp(self):
        current = json.loads(self.request()[1]); session = (current.get('observation') or {}).get('sessionId', '')
        self.request('session?' + urllib.parse.urlencode({'sessionId': session}), 'DELETE')
        Camera.behavior = 'jpeg'; Camera.requests.clear()
    def test_digest_snapshot_and_identity_guarded_frames(self):
        code, status = self.start(); self.assertEqual(code, 200); self.assertTrue(status['liveFrameAvailable'])
        self.assertEqual(status['frameSource'], 'hanwha-jpeg-snapshot'); self.assertEqual(status['directionStatus'], 'unknown')
        self.assertFalse(status['underlyingStreamFreshnessVerified'])
        observation = status['observation']; self.assertEqual((observation['width'], observation['height']), (100, 80))
        query = urllib.parse.urlencode({'sessionId': observation['sessionId'], 'sequence': observation['sequence']})
        code, body, headers = self.request('frame?' + query)
        self.assertEqual(code, 200); self.assertEqual(body, JPEG); self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.request('frame?sessionId=wrong&sequence=1')[0], 409)
        self.assertTrue(any(auth.startswith('Digest ') for _, _, auth in Camera.requests))
        self.assertTrue(all(method == 'GET' and path == PATH for method, path, _ in Camera.requests))
        serialized = json.dumps(status)
        for secret in [USER, PASSWORD, self.camera_base]: self.assertNotIn(secret, serialized)
    def test_poll_refreshes_and_stop_clears_old_images_and_does_not_keep_polling(self):
        _, status = self.start(); observation = status['observation']; time.sleep(1.2)
        after = json.loads(self.request()[1]); self.assertGreater(after['observation']['sequence'], observation['sequence'])
        self.assertEqual(self.request('session?sessionId=wrong', 'DELETE')[0], 409)
        self.assertEqual(self.request('session?sessionId=' + observation['sessionId'], 'DELETE')[0], 200)
        count = len(Camera.requests); time.sleep(1.2); self.assertEqual(len(Camera.requests), count)
        self.assertFalse(json.loads(self.request()[1])['liveFrameAvailable'])
        self.assertEqual(self.request('frame?sessionId=' + observation['sessionId'] + '&sequence=1')[0], 409)
    def test_access_requires_loopback_host_key_and_same_origin(self):
        payload = self.payload()
        self.assertEqual(self.request('session', 'POST', payload, key=False)[0], 401)
        for headers in [{'Origin': 'https://unrelated.invalid'}, {'Sec-Fetch-Site': 'cross-site'}, {'Host': 'unrelated.invalid'}]:
            self.assertEqual(self.request('session', 'POST', payload, headers=headers)[0], 403)
        self.assertEqual(Camera.requests, [])
    def test_regular_bridge_does_not_enable_direct_connections_by_default(self):
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = os.environ.copy(); env.pop('DIRECT_CAMERA_SNAPSHOT_ENABLED', None)
        env.update(ASPNETCORE_URLS=base, ASPNETCORE_ENVIRONMENT='Production', CAPTURE_READ_KEY=self.key)
        process = subprocess.Popen([self.dotnet, str(DLL)], cwd=self.work, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base + '/health', timeout=1): break
                except urllib.error.URLError: time.sleep(.05)
            request = urllib.request.Request(base + '/api/camera-snapshot/session', data=json.dumps(self.payload()).encode(), headers={'Content-Type':'application/json','X-Capture-Read-Key':self.key})
            with self.assertRaises(urllib.error.HTTPError) as failure: urllib.request.urlopen(request, timeout=5)
            self.assertEqual(failure.exception.code, 503); self.assertEqual(Camera.requests, [])
        finally: process.terminate(); process.wait(timeout=8)
    def test_rejects_viewer_ddns_and_control_paths_without_requests(self):
        for url in [self.camera_base + '/wmf/index.html#/uni/channel', 'http://ddns.example.invalid/camera',
                    self.camera_base + '/stw-cgi/ptz.cgi?msubmenu=absolute&action=view',
                    self.camera_base + PATH + '&Password=not-allowed', self.camera_base + PATH.replace('action=view', 'action=set'),
                    self.camera_base + PATH + '&action=set', self.camera_base.replace('http://','http://user:pw@') + PATH]:
            self.assertEqual(self.start(snapshotUrl=url)[0], 400)
        self.assertEqual(Camera.requests, [])
    def test_wrong_password_and_forbidden_stop_without_credential_retries(self):
        self.assertEqual(self.start(password='synthetic-wrong')[1]['code'], 'authentication-denied')
        count = len(Camera.requests); time.sleep(1.2); self.assertEqual(len(Camera.requests), count)
        Camera.behavior = 'forbidden'; self.assertEqual(self.start()[1]['code'], 'authentication-denied')
    def test_plain_http_does_not_fall_back_to_basic_authentication(self):
        Camera.behavior = 'basic'; self.assertEqual(self.start()[1]['code'], 'authentication-denied')
        self.assertFalse(any(auth.startswith('Basic ') for _, _, auth in Camera.requests))
    def test_redirect_login_and_bad_jpeg_never_become_images(self):
        for behavior, expected in [('redirect','redirect-rejected'), ('html','not-jpeg'), ('corrupt','invalid-jpeg')]:
            Camera.behavior = behavior; self.assertEqual(self.start()[1]['code'], expected)
            self.assertFalse(json.loads(self.request()[1])['liveFrameAvailable'])
        self.assertFalse(any(path == '/must-not-follow' for _, path, _ in Camera.requests))
    def test_late_camera_failure_clears_frames_and_stops_polling(self):
        _, status = self.start(); Camera.behavior = 'forbidden'; time.sleep(1.2)
        after = json.loads(self.request()[1]); self.assertFalse(after['liveFrameAvailable']); self.assertEqual(after['reasonCode'], 'authentication-denied')
        count = len(Camera.requests); time.sleep(1.2); self.assertEqual(len(Camera.requests), count)
        self.assertEqual(self.request('frame?sessionId=' + status['observation']['sessionId'] + '&sequence=1')[0], 409)
    def test_idle_viewer_expires_credentials_without_persisting_them(self):
        self.start(); time.sleep(16.5)
        status = json.loads(self.request()[1]); self.assertFalse(status['liveFrameAvailable']); self.assertEqual(status['reasonCode'], 'viewer-inactive')
        count = len(Camera.requests); time.sleep(1.2); self.assertEqual(len(Camera.requests), count)
        self.log.flush(); raw = self.log_path.read_text()
        for secret in [USER, PASSWORD, 'synthetic-nonce', 'Authorization:', self.camera_base]: self.assertNotIn(secret, raw)
        self.assertEqual([p.name for p in self.work.iterdir()], ['bridge.log'])


if __name__ == '__main__': unittest.main(verbosity=2)
