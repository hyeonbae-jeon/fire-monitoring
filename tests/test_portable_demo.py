"""Exercise the portable startup path in a staged, platform-neutral publish.

Windows PE files cannot execute on this Linux host. This tests shared startup,
loopback binding, hostile working directory/env isolation, UI and persistence.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class PortableDemoTests(unittest.TestCase):
    def test_double_click_mode_is_isolated_and_persistent(self):
        dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        self.assertIsNotNone(dotnet, 'Set DOTNET_EXECUTABLE or put dotnet on PATH')
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            package = work / 'portable package with spaces'
            subprocess.run([dotnet, 'publish', str(ROOT / 'bridge/WisenetPtzBridge'), '-c', 'Release',
                            '--self-contained', 'false', '-o', str(package), '--nologo'], cwd=ROOT, check=True)
            (package / 'demo').mkdir()
            shutil.copyfile(ROOT / 'config/inventory.example.json', package / 'demo/inventory.json')
            (package / 'portable-demo.json').write_text('{"mode":"synthetic-demo"}')
            untouched = work / 'operational.json'
            untouched.write_text('{"cameras":[]}')
            env = os.environ.copy()
            env.update(INVENTORY_FILE=str(work / 'nonexistent-operational-inventory.json'),
                       CAMERA_CONFIG_FILE=str(untouched), INVENTORY_WRITE_KEY='unusable-operational-placeholder',
                       ASPNETCORE_URLS='http://0.0.0.0:1')
            env['ASPNETCORE_ENVIRONMENT'] = 'Production'

            def start():
                log_path = work / 'demo.log'
                log = log_path.open('w')
                process = subprocess.Popen([dotnet, str(package / 'WisenetPtzBridge.dll'), '--no-browser'],
                                           cwd=work, env=env, stdout=log, stderr=log)
                for _ in range(100):
                    if process.poll() is not None:
                        log.close()
                        self.fail('Demo exited during startup: ' + log_path.read_text())
                    text = log_path.read_text()
                    match = re.search(r'Browser: (http://127\.0\.0\.1:\d+)', text)
                    if match: return process, log, match.group(1)
                    time.sleep(.05)
                process.terminate(); process.wait(timeout=5); log.close()
                self.fail('Demo startup timeout')

            def request(base, path, body=None):
                req = urllib.request.Request(base + path,
                    data=json.dumps(body).encode() if body is not None else None,
                    method='PUT' if body is not None else 'GET',
                    headers={'Content-Type': 'application/json', 'X-Inventory-Write-Key': 'local-demo-only'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    return response.read()

            process, log, base = start()
            try:
                health = json.loads(request(base, '/health'))
                self.assertTrue(health['localDesktopDemo'])
                self.assertFalse(health['liveSsmConnected'])
                self.assertFalse(health['ptzCommandsEnabled'])
                self.assertIn(b'<div id="root">', request(base, '/'))
                inv = json.loads(request(base, '/api/inventory'))
                self.assertEqual(inv['totalCount'], 3)
                self.assertIn('SYNTHETIC', inv['provenance'])
                conf = json.loads(request(base, '/api/cameras'))
                selected = inv['cameras'][0]['uuid']
                saved = json.loads(request(base, '/api/cameras', {'cameraUuids': [selected],
                    'inventoryVersion': inv['version'], 'configurationRevision': conf['revision']}))
                self.assertEqual(saved['configuration']['cameras'][0]['uuid'], selected)
                self.assertEqual(untouched.read_text(), '{"cameras":[]}')
                self.assertTrue((package / 'data/cameras.demo.json').is_file())
            finally:
                process.terminate(); process.wait(timeout=5); log.close()
            process, log, base = start()
            try:
                persisted = json.loads(request(base, '/api/cameras'))
                self.assertEqual(persisted, saved)
            finally:
                process.terminate(); process.wait(timeout=5); log.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
