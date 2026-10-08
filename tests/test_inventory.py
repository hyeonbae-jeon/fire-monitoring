"""Integration tests against the real .NET Bridge. All camera data is synthetic."""
import concurrent.futures
import copy
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

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'bridge/WisenetPtzBridge'
DLL = PROJECT / 'bin/Release/net8.0/WisenetPtzBridge.dll'
A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
C = '33333333-3333-4333-8333-333333333333'


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.work = Path(cls.temp.name)
        cls.inventory_path = cls.work / 'inventory.json'
        cls.config_path = cls.work / 'cameras.json'
        cls.key = secrets.token_urlsafe(32)
        cls.fixture = json.loads((ROOT / 'config/inventory.example.json').read_text())
        cls.dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        if not cls.dotnet:
            raise RuntimeError('Set DOTNET_EXECUTABLE or put .NET 8 SDK on PATH.')
        if not DLL.exists():
            raise RuntimeError('Build the Bridge in Release before running tests.')
        cls.start()

    @classmethod
    def start(cls, *, write_key=True, inventory=True, configuration=True):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = os.environ.copy()
        for name in ['INVENTORY_FILE', 'CAMERA_CONFIG_FILE', 'INVENTORY_WRITE_KEY']:
            env.pop(name, None)
        env['ASPNETCORE_URLS'] = cls.base
        env['ASPNETCORE_ENVIRONMENT'] = 'Production'
        if inventory: env['INVENTORY_FILE'] = str(cls.inventory_path)
        if configuration: env['CAMERA_CONFIG_FILE'] = str(cls.config_path)
        if write_key: env['INVENTORY_WRITE_KEY'] = cls.key
        cls.log = open(cls.work / 'bridge.log', 'ab')
        cls.process = subprocess.Popen([cls.dotnet, str(DLL)], cwd=PROJECT,
                                       env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            if cls.process.poll() is not None: raise RuntimeError('Bridge exited during startup')
            try:
                with urllib.request.urlopen(cls.base + '/health', timeout=1) as r:
                    if r.status == 200: return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.05)
        raise RuntimeError('Bridge readiness timeout')

    @classmethod
    def stop(cls):
        cls.process.terminate()
        try: cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill(); cls.process.wait(timeout=5)
        cls.log.close()

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.temp.cleanup()

    def setUp(self):
        self.inventory_path.write_text(json.dumps(self.fixture))
        self.config_path.unlink(missing_ok=True)

    def request(self, path, method='GET', body=None, key=None):
        headers = {'Content-Type': 'application/json'}
        if key is not None: headers['X-Inventory-Write-Key'] = key
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try: response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error: response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None

    def selection(self, uuids=None):
        si, inv = self.request('/api/inventory')
        sc, conf = self.request('/api/cameras')
        self.assertEqual((si, sc), (200, 200))
        return {'cameraUuids': [A] if uuids is None else uuids,
                'configurationRevision': conf['revision'], 'inventoryVersion': inv['version']}

    def save(self, request):
        return self.request('/api/cameras', 'PUT', request, self.key)

    def test_inventory_capabilities_and_unknown_are_distinct(self):
        status, data = self.request('/api/inventory')
        self.assertEqual(status, 200)
        self.assertFalse(data['liveSsmConnected'])
        self.assertEqual(data['coverage'], 'operator-declared-complete')
        self.assertEqual(data['totalCount'], 3)
        self.assertEqual([c['getPosNormalize'] for c in data['cameras']], [True, False, None])
        self.assertTrue(data['cameras'][0]['absoluteZoom'])

    def test_uint64_precision_preserved(self):
        doc = copy.deepcopy(self.fixture)
        doc['cameras'][0]['ptzCap'] = '18446744073709551615'
        self.inventory_path.write_text(json.dumps(doc))
        status, data = self.save(self.selection())
        self.assertEqual(status, 200)
        self.assertEqual(data['configuration']['cameras'][0]['ptzCap'], '18446744073709551615')

    def test_invalid_inventories_rejected(self):
        variants = []
        for field, value in [('complete', False), ('totalCount', 4), ('schemaVersion', 2),
                             ('provenance', ''), ('capturedAt', None)]:
            doc = copy.deepcopy(self.fixture); doc[field] = value; variants.append(doc)
        for cap in ['-1', '18446744073709551616', 268435456, '1.5', '', ' 1', '0x10000000']:
            doc = copy.deepcopy(self.fixture); doc['cameras'][0]['ptzCap'] = cap; variants.append(doc)
        for uuid in [A, 'not-a-uuid', '00000000-0000-0000-0000-000000000000']:
            doc = copy.deepcopy(self.fixture); doc['cameras'][1]['uuid'] = uuid; variants.append(doc)
        doc = copy.deepcopy(self.fixture); doc['cameras'][0]['name'] = ''; variants.append(doc)
        doc = copy.deepcopy(self.fixture); doc['cameras'].append(None); doc['totalCount'] = 4; variants.append(doc)
        doc = copy.deepcopy(self.fixture); doc['guessedSsmField'] = 1; variants.append(doc)
        for i, doc in enumerate(variants):
            with self.subTest(variant=i):
                self.inventory_path.write_text(json.dumps(doc))
                self.assertEqual(self.request('/api/inventory')[0], 422)

    def test_selection_saved_and_persisted_on_restart(self):
        status, result = self.save(self.selection([A, C]))
        self.assertEqual(status, 200)
        saved = json.loads(self.config_path.read_text())
        self.assertEqual([c['uuid'] for c in saved['cameras']], [A, C])
        self.assertIsNone(saved['cameras'][0]['latitude'])
        self.assertIsNone(saved['cameras'][0]['headingOffsetDeg'])
        self.assertIsNone(saved['cameras'][1]['ptz']['getPosNormalize'])
        self.stop(); self.start()
        self.assertEqual(self.request('/api/cameras')[1], result)

    def test_metadata_preserved_when_name_changes(self):
        doc = {'customRoot': {'keep': True}, 'cameras': [
            {'uuid': A.upper(), 'name': 'old name', 'latitude': 37.25, 'parkId': 'test-park',
             'headingOffsetDeg': 17, 'model': 'existing-model', 'custom': [1, 2], 'ptz': {'custom': 'keep'}}]}
        self.config_path.write_text(json.dumps(doc))
        status, result = self.save(self.selection())
        self.assertEqual(status, 200)
        camera = result['configuration']['cameras'][0]
        self.assertEqual(camera['name'], self.fixture['cameras'][0]['name'])
        for field in ['latitude', 'parkId', 'headingOffsetDeg', 'model', 'custom']:
            self.assertEqual(camera[field], doc['cameras'][0][field])
        self.assertEqual(camera['ptz']['custom'], 'keep')
        self.assertEqual(result['configuration']['customRoot'], {'keep': True})

    def test_auth_required(self):
        request = self.selection()
        for key in [None, 'wrong']:
            self.assertEqual(self.request('/api/cameras', 'PUT', request, key)[0], 401)
        self.assertFalse(self.config_path.exists())

    def test_stale_configuration_conflict(self):
        request = self.selection()
        self.assertEqual(self.save(request)[0], 200)
        before = self.config_path.read_bytes()
        self.assertEqual(self.save(request)[0], 409)
        self.assertEqual(self.config_path.read_bytes(), before)

    def test_stale_inventory_conflict(self):
        request = self.selection()
        doc = copy.deepcopy(self.fixture); doc['cameras'][0]['name'] = 'renamed'
        self.inventory_path.write_text(json.dumps(doc))
        self.assertEqual(self.save(request)[0], 409)
        self.assertFalse(self.config_path.exists())

    def test_duplicate_empty_or_unknown_selection_rejected(self):
        for ids in [[A, A], ['00000000-0000-0000-0000-000000000000'],
                    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], None]:
            request = self.selection(); request['cameraUuids'] = ids
            self.assertEqual(self.save(request)[0], 400)
        self.assertFalse(self.config_path.exists())

    def test_empty_selection_is_explicit_supported_clear(self):
        self.assertEqual(self.save(self.selection())[0], 200)
        status, result = self.save(self.selection([]))
        self.assertEqual(status, 200)
        self.assertEqual(result['configuration']['cameras'], [])

    def test_malformed_existing_configuration_not_overwritten(self):
        request = self.selection()
        for raw in ['{', '{"cameras":[{"uuid":"bad"}]}', '{"cameras":null}',
                    json.dumps({'cameras': [{'uuid': A}, {'uuid': A}]})]:
            self.config_path.write_text(raw)
            self.assertEqual(self.save(request)[0], 422)
            self.assertEqual(self.config_path.read_text(), raw)

    def test_parallel_save_has_one_winner(self):
        request = self.selection()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self.save(request)[0], range(2)))
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(len(json.loads(self.config_path.read_text())['cameras']), 1)
        self.assertEqual(list(self.work.glob('*.tmp')), [])

    def test_missing_file_is_failure_not_empty_inventory(self):
        self.inventory_path.unlink()
        self.assertEqual(self.request('/api/inventory')[0], 503)

    def test_large_inventory_rejected(self):
        self.inventory_path.write_bytes(b' ' * (10 * 1024 * 1024 + 1))
        self.assertEqual(self.request('/api/inventory')[0], 422)

    def test_no_ptz_endpoints_and_health_is_honest(self):
        status, health = self.request('/health')
        self.assertEqual(status, 200)
        self.assertFalse(health['liveSsmConnected'])
        self.assertFalse(health['ptzCommandsEnabled'])
        for path in ['/api/ptz', '/api/ptz/move', '/ws/ptz']:
            self.assertEqual(self.request(path)[0], 404)

    def test_unconfigured_modes_fail_closed(self):
        request = self.selection()
        self.stop(); self.start(write_key=False)
        try:
            self.assertEqual(self.save(request)[0], 503)
            self.assertFalse(self.config_path.exists())
        finally:
            self.stop(); self.start(inventory=False, configuration=False)
        try:
            self.assertEqual(self.request('/api/inventory')[0], 503)
            self.assertEqual(self.request('/api/cameras')[0], 503)
        finally:
            self.stop(); self.start()


if __name__ == '__main__':
    unittest.main(verbosity=2)
