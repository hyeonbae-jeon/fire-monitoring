"""Direct JPEG adapter against a synthetic Digest camera only. No real devices."""
import hashlib
import concurrent.futures
import io
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
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / 'bridge/WisenetPtzBridge/bin/Release/net8.0/WisenetPtzBridge.dll'
JPEG = bytes.fromhex('ffd8ffc00008080050006401ffd9')
PATH = '/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1'
PTZ_PATH = '/stw-cgi/ptzcontrol.cgi?msubmenu=query&action=view&Query=Pan,Tilt,Zoom'
PTZ_BODY = b'Pan=12.5\r\nTilt=-4.25\r\nZoom=2\r\nZoomPulse=0\r\nChannel.0.Pan=12.5\r\nChannel.0.Tilt=-4.25\r\nChannel.0.Zoom=2\r\nChannel.0.ZoomPulse=0\r\n'
USER, PASSWORD = 'synthetic-camera-user', 'synthetic-camera-password'


class Camera(BaseHTTPRequestHandler):
    requests = []
    behavior = 'jpeg'
    ptz_body = PTZ_BODY
    ptz_mode = 'ok'
    ptz_entered = threading.Event()
    ptz_gate = threading.Event()
    ptz_after_snapshot = None
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
        if self.path == PTZ_PATH:
            Camera.ptz_entered.set()
            if Camera.ptz_mode == 'hold': Camera.ptz_gate.wait(timeout=8)
            if Camera.ptz_mode == 'forbidden': self.send_response(403); self.end_headers(); return
            if Camera.ptz_mode == 'redirect':
                self.send_response(302); self.send_header('Location', '/must-not-follow-ptz'); self.end_headers(); return
            body = Camera.ptz_body
            self.send_response(200); self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body))); self.end_headers()
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass
            return
        if Camera.behavior == 'forbidden': self.send_response(403); self.end_headers(); return
        if Camera.behavior == 'redirect':
            self.send_response(302); self.send_header('Location', '/must-not-follow'); self.end_headers(); return
        body = b'<html>synthetic login</html>' if Camera.behavior == 'html' else b'not a jpeg' if Camera.behavior == 'corrupt' else JPEG
        if Camera.ptz_after_snapshot is not None: Camera.ptz_body = Camera.ptz_after_snapshot
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
        Camera.ptz_body = PTZ_BODY; Camera.ptz_mode = 'ok'; Camera.ptz_gate.set(); Camera.ptz_entered.clear()
        Camera.ptz_after_snapshot = None
    def reference(self, session):
        return self.request('reference', 'POST', {'sessionId':session})
    def test_reference_zip_contains_original_hash_bracketed_ptz_and_no_connection_secrets(self):
        _,started=self.start(readDevicePtz=True); self.wait_ptz(); session=started['observation']['sessionId']
        code,raw,headers=self.reference(session); self.assertEqual(code,200)
        self.assertEqual(headers['Content-Type'],'application/zip'); self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertIn('.zip',headers['Content-Disposition'])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertEqual(set(archive.namelist()),{'reference.jpg','reference-metadata.private.json'})
            jpeg=archive.read('reference.jpg'); metadata=archive.read('reference-metadata.private.json'); d=json.loads(metadata)
        self.assertEqual(jpeg,JPEG); self.assertEqual(d['kind'],'camera-ptz-reference'); self.assertEqual(d['sessionId'],session)
        self.assertEqual(d['reference']['sha256'],hashlib.sha256(jpeg).hexdigest())
        self.assertEqual((d['reference']['width'],d['reference']['height']),(100,80))
        self.assertEqual(d['reference']['snapshotSelection'],{'channel':None,'profile':1})
        before,after=d['devicePtz']['before'],d['devicePtz']['after']
        self.assertEqual((before['panDeg'],after['panDeg'],after['zoomPulse']),(12.5,12.5,0))
        self.assertLessEqual(before['receivedAt'],d['reference']['requestStartedAt'])
        self.assertLessEqual(d['reference']['requestStartedAt'],d['reference']['receivedAt'])
        self.assertLessEqual(d['reference']['receivedAt'],after['requestStartedAt'])
        self.assertTrue(d['stability']['passed']); self.assertFalse(d['synchronization']['sensorCaptureTimeKnown'])
        self.assertFalse(d['synchronization']['underlyingStreamFreshnessVerified']); self.assertFalse(d['geographicHeadingCalibrated'])
        for secret in [USER,PASSWORD,self.camera_base,'Authorization',self.key]: self.assertNotIn(secret,metadata.decode())
        self.assertTrue(all(method=='GET' and path in [PATH,PTZ_PATH] for method,path,_ in Camera.requests))
        self.assertTrue(json.loads(self.request()[1])['liveFrameAvailable'])
    def test_reference_rejects_changed_pan_tilt_zoom_and_zoom_pulse(self):
        for old,new in [(b'Pan=12.5',b'Pan=12.9'),(b'Tilt=-4.25',b'Tilt=-4.8'),(b'Zoom=2',b'Zoom=3'),(b'ZoomPulse=0',b'ZoomPulse=1')]:
            Camera.ptz_after_snapshot=None; Camera.ptz_body=PTZ_BODY
            _,started=self.start(readDevicePtz=True);self.wait_ptz();Camera.ptz_after_snapshot=PTZ_BODY.replace(old,new)
            code,raw,headers=self.reference(started['observation']['sessionId'])
            self.assertEqual(code,409);self.assertEqual(json.loads(raw)['code'],'reference-moving');self.assertNotEqual(headers['Content-Type'],'application/zip')
    def test_reference_treats_pan_wrap_as_small_difference(self):
        Camera.ptz_body=PTZ_BODY.replace(b'Pan=12.5',b'Pan=359.96')
        _,started=self.start(readDevicePtz=True);self.wait_ptz();Camera.ptz_after_snapshot=PTZ_BODY.replace(b'Pan=12.5',b'Pan=0.02')
        code,raw,_=self.reference(started['observation']['sessionId']);self.assertEqual(code,200)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:d=json.loads(archive.read('reference-metadata.private.json'))
        self.assertAlmostEqual(d['stability']['panDifferenceDeg'],.06,places=6)
    def test_reference_requires_key_origin_current_session_and_enabled_ptz(self):
        body={'sessionId':'wrong'}
        self.assertEqual(self.request('reference','POST',body,key=False)[0],401)
        self.assertEqual(self.request('reference','POST',body,headers={'Origin':'https://unrelated.invalid'})[0],403)
        self.assertEqual(self.reference('wrong')[0],409);self.assertEqual(Camera.requests,[])
        _,started=self.start();code,raw,_=self.reference(started['observation']['sessionId'])
        self.assertEqual(code,409);self.assertEqual(json.loads(raw)['code'],'reference-not-ready')
    def test_reference_bad_ptz_does_not_create_an_archive(self):
        _,started=self.start(readDevicePtz=True);self.wait_ptz();Camera.ptz_body=b'NG\nError Code: 604\n'
        code,raw,headers=self.reference(started['observation']['sessionId'])
        self.assertEqual(code,502);self.assertEqual(json.loads(raw)['code'],'ptz-invalid-response');self.assertNotEqual(headers['Content-Type'],'application/zip')
    def test_reference_in_flight_cancels_on_session_end_and_parallel_export_is_rejected(self):
        _,started=self.start(readDevicePtz=True);self.wait_ptz();session=started['observation']['sessionId']
        Camera.ptz_mode='hold';Camera.ptz_gate.clear();Camera.ptz_entered.clear()
        try:
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pending=pool.submit(self.reference,session);self.assertTrue(Camera.ptz_entered.wait(3))
                code,raw,_=self.reference(session);self.assertEqual(code,409);self.assertEqual(json.loads(raw)['code'],'reference-busy')
                self.request('session?sessionId='+session,'DELETE')
                code,raw,headers=pending.result(timeout=4);self.assertEqual(code,409);self.assertEqual(json.loads(raw)['code'],'session-changed')
                self.assertNotEqual(headers['Content-Type'],'application/zip')
        finally:Camera.ptz_gate.set()
    def wait_ptz(self, expected='live', timeout=4):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            status = json.loads(self.request()[1])
            if status['devicePtz']['status'] == expected: return status
            time.sleep(.05)
        self.fail('PTZ status did not become ' + expected)
    def test_ptz_exact_read_only_query_uses_existing_digest_session_and_preserves_zero(self):
        self.assertEqual(self.start(readDevicePtz=True)[0], 200)
        status = self.wait_ptz(); sample = status['devicePtz']['sample']
        self.assertEqual([sample[k] for k in ['panDeg','tiltDeg','zoom','zoomPulse']], [12.5,-4.25,2,0])
        self.assertLessEqual(sample['requestStartedAt'], sample['receivedAt'])
        self.assertFalse(status['devicePtz']['geographicHeadingCalibrated']); self.assertFalse(status['devicePtz']['imageSynchronized'])
        self.assertEqual(status['directionStatus'], 'unknown'); self.assertFalse(status['automaticDirectionTrackingImplemented'])
        time.sleep(1.2); after = self.wait_ptz(); self.assertGreater(after['devicePtz']['sample']['sequence'], sample['sequence'])
        self.assertTrue(all(method == 'GET' and path in [PATH, PTZ_PATH] for method,path,_ in Camera.requests))
        for secret in [USER,PASSWORD,self.camera_base,'Authorization',PTZ_BODY.decode()]: self.assertNotIn(secret,json.dumps(after))
    def test_ptz_zero_angles_and_channel_only_response(self):
        Camera.ptz_body = b'Channel.0.Pan=0\nChannel.0.Tilt=0\nChannel.0.Zoom=1\nChannel.0.ZoomPulse=0\n'
        self.start(readDevicePtz=True); sample = self.wait_ptz()['devicePtz']['sample']
        self.assertEqual([sample[k] for k in ['panDeg','tiltDeg','zoom','zoomPulse']], [0,0,1,0])
    def test_ptz_bad_responses_stop_angle_reads_but_keep_jpeg(self):
        for body in [b'NG\nError Code: 604\nInvalid Input Value(s)', PTZ_BODY.replace(b'Channel.0.Pan=12.5',b'Channel.0.Pan=99'),
                     b'Pan=NaN\nTilt=0\nZoom=1',b'Pan=1\nTilt=0',b'Pan=1\nPan=1\nTilt=0\nZoom=1',
                     b'Pan=1\nChannel.0.Tilt=0\nZoom=1',b'<html>login</html>',b'x'*8193]:
            Camera.ptz_body=body; self.start(readDevicePtz=True)
            status = self.wait_ptz('error'); self.assertEqual(status['devicePtz']['reasonCode'],'ptz-invalid-response')
            self.assertIsNone(status['devicePtz']['sample']); self.assertTrue(status['liveFrameAvailable'])
            count = sum(path == PTZ_PATH for _,path,_ in Camera.requests); sequence = status['observation']['sequence']
            time.sleep(1.1); after = json.loads(self.request()[1])
            self.assertGreater(after['observation']['sequence'],sequence)
            self.assertEqual(sum(path == PTZ_PATH for _,path,_ in Camera.requests),count)
    def test_ptz_access_errors_clear_previous_angles_without_redirect_or_retry(self):
        for mode,reason in [('forbidden','ptz-authentication-denied'),('redirect','ptz-redirect-rejected')]:
            Camera.ptz_mode='ok'; self.start(readDevicePtz=True); self.wait_ptz()
            Camera.ptz_mode=mode; status=self.wait_ptz('error')
            self.assertEqual(status['devicePtz']['reasonCode'],reason); self.assertIsNone(status['devicePtz']['sample'])
            count = sum(path == PTZ_PATH for _,path,_ in Camera.requests); time.sleep(1.1)
            self.assertEqual(sum(path == PTZ_PATH for _,path,_ in Camera.requests),count)
            self.assertTrue(json.loads(self.request()[1])['liveFrameAvailable'])
        self.assertFalse(any(path == '/must-not-follow-ptz' for _,path,_ in Camera.requests))
    def test_ptz_expiry_and_timeout_do_not_freeze_video(self):
        self.start(readDevicePtz=True); first=self.wait_ptz()
        Camera.ptz_mode='hold'; Camera.ptz_gate.clear(); Camera.ptz_entered.clear()
        self.assertTrue(Camera.ptz_entered.wait(3))
        try:
            status=self.wait_ptz('stale',timeout=5); self.assertIsNone(status['devicePtz']['sample']); self.assertTrue(status['liveFrameAvailable'])
            after=self.wait_ptz('error',timeout=4); self.assertEqual(after['devicePtz']['reasonCode'],'ptz-timeout')
            self.assertGreater(after['observation']['sequence'], first['observation']['sequence'])
        finally: Camera.ptz_gate.set()
    def test_late_ptz_response_cannot_attach_to_replacement_session(self):
        Camera.ptz_mode='hold'; Camera.ptz_gate.clear(); self.start(readDevicePtz=True)
        self.assertTrue(Camera.ptz_entered.wait(3))
        try:
            code,new=self.start(); self.assertEqual(code,200)
            Camera.ptz_gate.set(); time.sleep(.3); status=json.loads(self.request()[1])
            self.assertEqual(status['observation']['sessionId'],new['observation']['sessionId'])
            self.assertFalse(status['devicePtz']['enabled']); self.assertIsNone(status['devicePtz']['sample'])
        finally: Camera.ptz_gate.set()
    def test_ptz_stops_with_session_and_rejects_other_video_channels(self):
        self.assertEqual(self.start(readDevicePtz=True,snapshotUrl=self.camera_base+PATH+'&Channel=1')[0],400)
        self.assertEqual(Camera.requests,[])
        _,started=self.start(readDevicePtz=True); self.wait_ptz()
        self.request('session?sessionId='+started['observation']['sessionId'],'DELETE')
        count=len(Camera.requests); time.sleep(1.1); self.assertEqual(len(Camera.requests),count)
        status=json.loads(self.request()[1]); self.assertFalse(status['devicePtz']['enabled']); self.assertIsNone(status['devicePtz']['sample'])
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
        self.start(readDevicePtz=True); time.sleep(16.5)
        status = json.loads(self.request()[1]); self.assertFalse(status['liveFrameAvailable']); self.assertEqual(status['reasonCode'], 'viewer-inactive')
        count = len(Camera.requests); time.sleep(1.2); self.assertEqual(len(Camera.requests), count)
        self.log.flush(); raw = self.log_path.read_text()
        for secret in [USER, PASSWORD, 'synthetic-nonce', 'Authorization:', self.camera_base]: self.assertNotIn(secret, raw)
        self.assertEqual([p.name for p in self.work.iterdir()], ['bridge.log'])


if __name__ == '__main__': unittest.main(verbosity=2)
