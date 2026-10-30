"""Nine synthetic cameras, autonomous collection, server login and CSRF isolation."""
import hashlib
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
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
import base64

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / 'bridge/WisenetPtzBridge/bin/Release/net8.0/WisenetPtzBridge.dll'
PTZ = '/stw-cgi/ptzcontrol.cgi?msubmenu=query&action=view&Query=Pan,Tilt,Zoom'
NVT_PTZ = '/api/ptz.cgi?PTZNumber=1&GetPTZPosition=do'
PASSWORD = 'synthetic-monitor-password'
VIEWER_PASSWORD = 'synthetic-viewer-password'
TOKEN = 'synthetic-nvt-encoded-token'


def jpeg(i):
    return bytes.fromhex('ffd8ffc0000808005000') + bytes([100+i]) + bytes.fromhex('01ffd9')


class Cameras(BaseHTTPRequestHandler):
    counts = [0]*9
    blocked = set()
    broken = set()
    reads = []
    def log_message(self, *_): pass
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == '/cgi-bin/GetImage.cgi' or self.path == NVT_PTZ:
            i = 8
            values = urllib.parse.parse_qs(parsed.query) if parsed.path.endswith('GetImage.cgi') else dict(
                (k, [urllib.parse.unquote(v)]) for part in self.headers.get('Cookie', '').split(';')
                if '=' in part for k, v in [part.strip().split('=', 1)])
            valid = values.get('USER' if parsed.path.endswith('GetImage.cgi') else 'username') == ['nvt-user'] and values.get('PWD' if parsed.path.endswith('GetImage.cgi') else 'password') == [TOKEN]
        else:
            auth = self.headers.get('Authorization', '')
            values = {m[1]: m[2] or m[3] for m in re.finditer(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', auth)}
            username = values.get('username', '')
            i = int(username[-1]) if re.fullmatch(r'camera-[0-7]', username) else -1
            md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
            expected = md5(':'.join([md5(username + ':synthetic-realm:password-' + str(i)), 'synthetic-nonce', values.get('nc', ''), values.get('cnonce', ''), 'auth', md5('GET:' + self.path)]))
            valid = i >= 0 and auth.startswith('Digest ') and values.get('response') == expected
            if not valid:
                self.send_response(401); self.send_header('WWW-Authenticate', 'Digest realm="synthetic-realm", nonce="synthetic-nonce", algorithm=MD5, qop="auth"'); self.send_header('Content-Length', '0'); self.end_headers(); return
        Cameras.reads.append((i, self.path))
        if not valid or i in Cameras.blocked:
            self.send_response(403); self.end_headers(); return
        if i in Cameras.broken:
            self.send_response(503); self.end_headers(); return
        ptz = self.path in (PTZ, NVT_PTZ)
        if not ptz: Cameras.counts[i] += 1
        body = (f'PTZ.1.Position={20+i},-2,1\n' if i == 8 else f'Pan={20+i}\nTilt=-2\nZoom=1\n').encode() if ptz else jpeg(i)
        self.send_response(200); self.send_header('Content-Type', 'text/plain' if ptz else 'image/jpeg'); self.send_header('Content-Length', str(len(body))); self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass


class AutomaticMonitoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.work = Path(cls.temp.name)
        cls.camera = ThreadingHTTPServer(('127.0.0.1', 0), Cameras)
        threading.Thread(target=cls.camera.serve_forever, daemon=True).start()
        cls.camera_base = f'http://127.0.0.1:{cls.camera.server_port}'
        cls.positions = [dict(id=f'camera-{i}', name=f'Synthetic camera {i}', lat=37.5+i*.001, lon=127.1, ssmUuid=None, positionSource='operator', orientation=None) for i in range(9)]
        cls.map = dict(schemaVersion=1, crs='EPSG:4326', positions=cls.positions)
        connections = [dict(cameraId=p['id'], source='hanwha', snapshotUrl=cls.camera_base+'/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1', username=p['id'], password=f'password-{i}') for i, p in enumerate(cls.positions[:8])]
        connections.append(dict(cameraId='camera-8', source='nvt-getimage', snapshotUrl=cls.camera_base+'/cgi-bin/GetImage.cgi?USER=nvt-user&PWD='+TOKEN+'&InputNumber=1'))
        salt = b'synthetic-salt16'
        assert len(salt) == 16
        password_hash = 'pbkdf2-sha256$600000$'+base64.b64encode(salt).decode()+'$'+base64.b64encode(hashlib.pbkdf2_hmac('sha256', PASSWORD.encode(), salt, 600000)).decode()
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = os.environ.copy(); env.update(MONITOR_SERVER_MODE='true', MONITOR_PORT=str(port), CCTV_DATA_DIR=str(cls.work), CCTV_MONITOR_USER='monitor', CCTV_MONITOR_PASSWORD_HASH=password_hash,
            CCTV_VIEWER_USER='viewer', CCTV_VIEWER_PASSWORD_HASH='pbkdf2-sha256$600000$'+base64.b64encode(salt).decode()+'$'+base64.b64encode(hashlib.pbkdf2_hmac('sha256', VIEWER_PASSWORD.encode(), salt, 600000)).decode(),
            CCTV_CONNECTIONS_JSON=json.dumps(dict(schemaVersion=1, cameras=connections)), CCTV_MAP_CONFIGURATION_JSON=json.dumps(cls.map), ASPNETCORE_ENVIRONMENT='Production')
        cls.env = env
        cls.log_path = cls.work/'bridge.log'; cls.log = cls.log_path.open('wb')
        cls.process = subprocess.Popen([os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet'), str(DLL)], cwd=ROOT/'bridge/WisenetPtzBridge', env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(120):
            try:
                with urllib.request.urlopen(cls.base+'/health', timeout=1): break
            except urllib.error.URLError: time.sleep(.1)
        else: raise RuntimeError(cls.log_path.read_text())
        # Deliberately make no browser/status calls for longer than the legacy lease.
        time.sleep(16)
        cls.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        _, html, _ = cls.request('/login')
        token = re.search("name=__RequestVerificationToken value='([^']+)'", html.decode())[1]
        code, _, _ = cls.request('/login', 'POST', urllib.parse.urlencode(dict(username='monitor', password=PASSWORD, __RequestVerificationToken=token)).encode(), {'Content-Type': 'application/x-www-form-urlencoded'})
        if code != 200: raise RuntimeError('Synthetic login failed')
        cls.csrf = json.loads(cls.request('/api/session')[1])['csrfToken']
        cls.viewer = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        _, html, _ = cls.request('/login', client=cls.viewer)
        token = re.search("name=__RequestVerificationToken value='([^']+)'", html.decode())[1]
        code, _, _ = cls.request('/login', 'POST', urllib.parse.urlencode(dict(username='viewer', password=VIEWER_PASSWORD, role='admin', __RequestVerificationToken=token)).encode(), {'Content-Type':'application/x-www-form-urlencoded'}, client=cls.viewer)
        if code != 200: raise RuntimeError('Synthetic viewer login failed')
        cls.viewer_csrf = json.loads(cls.request('/api/session',client=cls.viewer)[1])['csrfToken']
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=10); cls.log.close(); cls.camera.shutdown(); cls.camera.server_close(); cls.temp.cleanup()
    @classmethod
    def request(cls, path, method='GET', data=None, headers=None, anonymous=False, client=None):
        client = urllib.request.build_opener() if anonymous else client or cls.client
        req = urllib.request.Request(cls.base+path, method=method, data=data, headers=headers or {})
        try: response = client.open(req, timeout=10)
        except urllib.error.HTTPError as e: response = e
        with response: return response.status, response.read(), response.headers
    def status(self):
        code, raw, _ = self.request('/api/auto-monitor/status'); self.assertEqual(code, 200)
        return json.loads(raw)
    def wait_for(self, condition, timeout=15):
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            result = condition()
            if result: return result
            time.sleep(.15)
        self.fail('Synthetic camera state timeout')
    def test_autonomous_nine_sessions_are_fresh_isolated_and_secret_free(self):
        state = self.status(); self.assertTrue(state['configured']); self.assertEqual(len(state['cameras']), 9)
        self.assertTrue(all(n >= 8 for n in Cameras.counts), Cameras.counts)
        sessions = set()
        for c in state['cameras']:
            feed = c['feed']; o = feed['observation']; sessions.add(o['sessionId'])
            self.assertTrue(feed['liveFrameAvailable']); self.assertEqual(feed['devicePtz']['status'], 'live')
            i = int(c['cameraId'][-1]); self.assertEqual(feed['devicePtz']['sample']['panDeg'], 20+i)
            query = urllib.parse.urlencode(dict(cameraId=c['cameraId'], sessionId=o['sessionId'], sequence=o['sequence']))
            self.assertEqual(self.request('/api/auto-monitor/frame?'+query)[:2], (200, jpeg(i)))
            wrong = query.replace('cameraId='+c['cameraId'], 'cameraId=camera-'+str((i+1)%9))
            self.assertEqual(self.request('/api/auto-monitor/frame?'+wrong)[0], 409)
        self.assertEqual(len(sessions), 9)
        public = json.dumps(state)+self.request('/api/map-configuration')[1].decode()+self.log_path.read_text()
        for secret in [TOKEN, PASSWORD, self.camera_base, 'password-0', 'USER=', 'PWD=', 'Authorization']:
            self.assertNotIn(secret, public)
        self.assertTrue(all(path == PTZ or path == NVT_PTZ or path.startswith('/cgi-bin/GetImage.cgi?') or path.startswith('/stw-cgi/video.cgi?') for _, path in Cameras.reads))
    def test_authentication_https_proxy_and_csrf_protect_reads_and_writes(self):
        for path in ['/api/auto-monitor/status', '/api/map-configuration', '/api/map-client-settings', '/api/session']:
            self.assertEqual(self.request(path, anonymous=True)[0], 401)
        self.assertEqual(self.request('/login', 'POST', b'username=monitor&password=ignored', {'Content-Type':'application/x-www-form-urlencoded'}, anonymous=True)[0], 403)
        self.assertEqual(self.request('/health', headers={'Host':'remote.invalid'}, anonymous=True)[0], 400)
        self.assertEqual(self.request('/health', headers={'X-Forwarded-For':'192.0.2.1'}, anonymous=True)[0], 400)
        self.assertEqual(self.request('/health', headers={'Host':'monitor.invalid','X-Forwarded-For':'192.0.2.1','X-Forwarded-Proto':'https'}, anonymous=True)[0], 200)
        saved = json.loads(self.request('/api/map-configuration')[1])
        body = json.dumps(dict(configurationRevision=saved['revision'], configuration=saved['configuration'])).encode()
        self.assertEqual(self.request('/api/map-configuration','PUT',body,{'Content-Type':'application/json'})[0], 403)
        code, _, _ = self.request('/api/map-configuration','PUT',body,{'Content-Type':'application/json','X-Monitor-CSRF':self.csrf})
        self.assertEqual(code, 200)
    def test_reconnect_one_failed_camera_preserves_other_eight(self):
        before = Cameras.counts.copy(); Cameras.broken.add(0)
        try:
            self.wait_for(lambda: any(c['cameraId']=='camera-0' and not c['feed']['liveFrameAvailable'] for c in self.status()['cameras']))
            time.sleep(1.3)
            for c in self.status()['cameras']:
                if c['cameraId'] != 'camera-0': self.assertTrue(c['feed']['liveFrameAvailable'])
            self.assertTrue(all(Cameras.counts[i] > before[i] for i in range(1,9)))
        finally: Cameras.broken.discard(0)
        self.wait_for(lambda: any(c['cameraId']=='camera-0' and c['feed']['liveFrameAvailable'] for c in self.status()['cameras']))
    def test_viewer_role_is_server_enforced_even_with_forged_role_and_valid_csrf(self):
        admin=json.loads(self.request('/api/session')[1]);viewer=json.loads(self.request('/api/session',client=self.viewer)[1])
        self.assertEqual((admin['role'],viewer['role'],viewer['userName']),('admin','viewer','viewer'))
        self.assertEqual(self.request('/api/map-configuration',client=self.viewer)[0],200)
        code,raw,_=self.request('/api/auto-monitor/status',client=self.viewer);self.assertEqual(code,200)
        observation=next(c for c in json.loads(raw)['cameras'] if c['feed']['liveFrameAvailable'])
        o=observation['feed']['observation'];query=urllib.parse.urlencode(dict(cameraId=observation['cameraId'],sessionId=o['sessionId'],sequence=o['sequence']))
        self.assertEqual(self.request('/api/auto-monitor/frame?'+query,client=self.viewer)[0],200)
        for path in ['/api/inventory','/api/cameras','/api/camera-snapshot/status','/api/screen-capture/status']:
            self.assertEqual(self.request(path,client=self.viewer)[0],403)
        for path in ['/api/map-configuration','/api/cameras','/api/inventory','/api/camera-snapshot/session']:
            self.assertEqual(self.request(path,'PUT' if path in ['/api/map-configuration','/api/cameras'] else 'POST',b'{}',
                {'Content-Type':'application/json','X-Monitor-CSRF':self.viewer_csrf,'X-Role':'admin'},client=self.viewer)[0],403)
        self.assertNotIn(VIEWER_PASSWORD,raw.decode()+self.log_path.read_text())
    def test_z_authentication_denial_stops_repeated_credentials_for_only_that_camera(self):
        Cameras.blocked.add(7)
        self.wait_for(lambda: any(c['cameraId']=='camera-7' and c['needsAttention'] for c in self.status()['cameras']))
        before = sum(i==7 for i,_ in Cameras.reads); time.sleep(2.2)
        self.assertEqual(sum(i==7 for i,_ in Cameras.reads), before)
        self.assertTrue(all(c['feed']['liveFrameAvailable'] for c in self.status()['cameras'] if c['cameraId']!='camera-7'))
    def test_zz_disabled_viewer_cookie_is_rejected_after_restart_while_admin_remains_valid(self):
        self.process.terminate();self.process.wait(timeout=10)
        env=self.env.copy();env.update(CCTV_VIEWER_USER='',CCTV_VIEWER_PASSWORD_HASH='')
        self.__class__.process=subprocess.Popen([os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet'),str(DLL)],cwd=ROOT/'bridge/WisenetPtzBridge',env=env,stdout=self.log,stderr=self.log)
        for _ in range(100):
            try:
                with urllib.request.urlopen(self.base+'/health',timeout=1):break
            except urllib.error.URLError:time.sleep(.1)
        else:self.fail('Restart timeout')
        self.assertEqual(self.request('/api/session',client=self.viewer)[0],401)
        self.assertEqual(json.loads(self.request('/api/session')[1])['role'],'admin')


if __name__ == '__main__': unittest.main()
