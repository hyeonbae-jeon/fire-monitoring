"""Read-only frame API integration. Synthetic JPEG headers only; no CCTV requests."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / 'bridge/WisenetPtzBridge/bin/Release/net8.0/WisenetPtzBridge.dll'
SESSION = '11111111111141118111111111111111'
JPEG = bytes.fromhex('ffd8ffc00008080050006401ffd9')  # SOF dimensions 100x80, not a real scene.


class ScreenCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.work = Path(cls.temp.name)
        cls.capture = cls.work / 'capture.private'
        cls.capture.mkdir()
        cls.key = secrets.token_urlsafe(32)
        cls.dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        if not cls.dotnet or not DLL.exists(): raise RuntimeError('Build Bridge Release and configure DOTNET_EXECUTABLE.')
        cls.start()

    @classmethod
    def start(cls, enabled=True, key=True):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = os.environ.copy()
        for name in ['CAPTURE_SOURCE_DIR', 'CAPTURE_READ_KEY']: env.pop(name, None)
        env.update(ASPNETCORE_URLS=cls.base, ASPNETCORE_ENVIRONMENT='Production')
        if enabled: env['CAPTURE_SOURCE_DIR'] = str(cls.capture)
        if key: env['CAPTURE_READ_KEY'] = cls.key
        cls.log = (cls.work / 'bridge.log').open('ab')
        cls.process = subprocess.Popen([cls.dotnet, str(DLL)], cwd=ROOT / 'bridge/WisenetPtzBridge', env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            if cls.process.poll() is not None: raise RuntimeError('Bridge exited.')
            try:
                with urllib.request.urlopen(cls.base + '/health', timeout=1): return
            except (urllib.error.URLError, TimeoutError): time.sleep(.05)
        raise RuntimeError('Bridge not ready.')

    @classmethod
    def stop(cls):
        cls.process.terminate(); cls.process.wait(timeout=5); cls.log.close()

    @classmethod
    def tearDownClass(cls):
        cls.stop(); cls.temp.cleanup()

    def setUp(self):
        for p in self.capture.iterdir(): p.unlink()

    def request(self, path='status', key=True):
        headers = {'X-Capture-Read-Key': self.key} if key else {}
        req = urllib.request.Request(self.base + '/api/screen-capture/' + path, headers=headers)
        try: response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error: response = error
        with response: return response.status, response.read(), response.headers

    def state(self, **overrides):
        now = datetime.now(timezone.utc).isoformat()
        result = dict(schemaVersion=1, sessionId=SESSION, cameraLabel='Synthetic camera', status='live', reasonCode='capturing',
                      updatedAt=now, capturedAt=now, sequence=1, width=100, height=80,
                      frameFile=f'frame-{SESSION}-1.jpg', meanDifference=0, referenceDifference=0,
                      sceneChanged=False, lowContrast=False, directionStatus='unknown')
        result.update(overrides)
        (self.capture / 'capture-source.json').write_text(json.dumps(result))
        return result

    def frame_path(self, sequence=1, session=SESSION): return f'frame?sessionId={session}&sequence={sequence}'

    def test_missing_source_waits_without_claiming_live_direction(self):
        status, body, _ = self.request()
        result = json.loads(body)
        self.assertEqual(status, 200); self.assertEqual(result['status'], 'waiting')
        self.assertFalse(result['liveFrameAvailable']); self.assertEqual(result['directionStatus'], 'unknown')

    def test_missing_frame_cannot_claim_live_availability(self):
        self.state()
        result = json.loads(self.request()[1])
        self.assertEqual(result['status'], 'waiting'); self.assertFalse(result['liveFrameAvailable'])
        self.assertEqual(self.request(self.frame_path())[0], 409)

    def test_private_status_and_frame_require_read_key(self):
        self.state(); (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(JPEG)
        for route in ['status', self.frame_path()]:
            status, body, headers = self.request(route, key=False)
            self.assertEqual(status, 401); self.assertNotIn(b'Synthetic camera', body)
            self.assertEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin')

    def test_live_frame_and_headers_but_direction_stays_unknown(self):
        self.state(sceneChanged=True); (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(JPEG)
        result = json.loads(self.request()[1])
        self.assertTrue(result['liveFrameAvailable']); self.assertEqual(result['directionStatus'], 'unknown')
        self.assertFalse(result['automaticDirectionTrackingImplemented'])
        self.assertFalse(result['underlyingStreamFreshnessVerified'])
        self.assertEqual(result['captureTimestampSource'], 'local-pc-clock')
        status, body, headers = self.request(self.frame_path())
        self.assertEqual(status, 200); self.assertEqual(body, JPEG)
        self.assertEqual(headers['Content-Type'], 'image/jpeg'); self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin')

    def test_stale_or_future_time_cannot_return_image(self):
        for seconds in [-60, 60]:
            when = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
            self.state(capturedAt=when, updatedAt=when)
            (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(JPEG)
            result = json.loads(self.request()[1])
            self.assertEqual(result['status'], 'stale'); self.assertFalse(result['liveFrameAvailable'])
            self.assertEqual(self.request(self.frame_path())[0], 409)

    def test_paused_and_stopped_state_deny_retained_image(self):
        (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(JPEG)
        for value, reason in [('paused','region-occluded'), ('stopped','user-stopped')]:
            self.state(status=value, reasonCode=reason, frameFile=None)
            self.assertFalse(json.loads(self.request()[1])['liveFrameAvailable'])
            self.assertEqual(self.request(self.frame_path())[0], 409)

    def test_old_session_or_sequence_cannot_retrieve_frame(self):
        self.state(); (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(JPEG)
        for path in [self.frame_path(2), self.frame_path(1, '22222222222242228222222222222222')]:
            self.assertEqual(self.request(path)[0], 409)

    def test_malformed_or_path_traversal_state_fails_closed(self):
        for invalid in [dict(frameFile='../outside.jpg'), dict(cameraLabel=None), dict(directionStatus='verified'),
                        dict(headingDeg=163), dict(width=20000), dict(status='paused')]:
            self.state(**invalid)
            result = json.loads(self.request()[1])
            self.assertEqual(result['status'], 'invalid'); self.assertFalse(result['liveFrameAvailable'])
        (self.capture / 'capture-source.json').write_bytes(b'[' * 5000)
        self.assertEqual(json.loads(self.request()[1])['status'], 'invalid')

    def test_corrupt_or_wrong_dimension_frame_is_unavailable(self):
        self.state()
        for payload in [b'not a JPEG', JPEG.replace(bytes.fromhex('0064'),bytes.fromhex('4000')), JPEG[:-2]]:
            (self.capture / f'frame-{SESSION}-1.jpg').write_bytes(payload)
            self.assertEqual(self.request(self.frame_path())[0], 409)

    def test_frame_symlink_cannot_read_outside_exchange_folder(self):
        self.state(); outside=self.work / 'outside.jpg'; outside.write_bytes(JPEG)
        (self.capture / f'frame-{SESSION}-1.jpg').symlink_to(outside)
        self.assertEqual(self.request(self.frame_path())[0], 409)

    def test_disabled_or_keyless_configuration_does_not_expose_source(self):
        self.stop()
        try:
            self.start(enabled=False)
            result = json.loads(self.request(key=False)[1])
            self.assertFalse(result['configured']); self.assertEqual(result['status'], 'disabled')
            self.stop(); self.start(key=False)
            self.assertEqual(self.request()[0], 503)
        finally:
            self.stop(); self.start()


if __name__ == '__main__': unittest.main(verbosity=2)
