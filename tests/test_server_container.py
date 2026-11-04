"""Smoke-test the built container with synthetic, disabled camera inputs only."""
import base64
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path
import urllib.request
import urllib.error

image = 'fire-monitoring:server-check'
with tempfile.TemporaryDirectory() as directory:
    salt = b'synthetic-salt16'
    encoded = 'pbkdf2-sha256$600000$'+base64.b64encode(salt).decode()+'$'+base64.b64encode(hashlib.pbkdf2_hmac('sha256', b'synthetic-monitor-password', salt, 600000)).decode()
    settings = dict(CCTV_MONITOR_USER='monitor', CCTV_MONITOR_PASSWORD_HASH=encoded,
        CCTV_MAP_CONFIGURATION_JSON=json.dumps(dict(schemaVersion=1,crs='EPSG:4326',positions=[])),
        CCTV_CONNECTIONS_JSON=json.dumps(dict(schemaVersion=1,cameras=[dict(cameraId='synthetic-disabled',source='hanwha',snapshotUrl='http://127.0.0.1:9/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1',username='synthetic-user',password='synthetic-password',enabled=False)])),
        MONITOR_PROXY_CIDR='172.17.0.0/16')
    envfile = Path(directory)/'synthetic.env'; envfile.write_text('\n'.join(k+'='+v for k,v in settings.items()))
    container = subprocess.check_output(['docker','run','-d','--env-file',str(envfile),'-p','127.0.0.1::5080',image],text=True).strip()
    try:
        port = subprocess.check_output(['docker','port',container,'5080/tcp'],text=True).strip().split(':')[-1]
        for _ in range(45):
            if subprocess.run(['docker','exec',container,'dotnet','WisenetPtzBridge.dll','--health-probe'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0: break
            time.sleep(1)
        else: raise RuntimeError('Synthetic container health check failed')
        def request(path, secure=False):
            req=urllib.request.Request('http://127.0.0.1:'+port+path,headers={'X-Forwarded-Proto':'https'} if secure else {})
            try: response=urllib.request.urlopen(req,timeout=5)
            except urllib.error.HTTPError as e: response=e
            with response: return response.status,response.read()
        assert request('/health')[0] == 400, 'Remote HTTP must be rejected'
        assert request('/health',True)[0] == 200
        assert request('/api/auto-monitor/status',True)[0] == 401
        assert request('/login',True)[0] == 200
        assert request('/assets/no-such-file',True)[0] == 200, 'Unauthenticated static URLs must lead to login'
        print('Container health, HTTPS enforcement, login and protected API checks passed.')
    finally: subprocess.run(['docker','rm','-f',container],check=True,stdout=subprocess.DEVNULL)
