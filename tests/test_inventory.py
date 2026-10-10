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
        cls.map_path = cls.work / 'map.json'
        cls.key = secrets.token_urlsafe(32)
        cls.fixture = json.loads((ROOT / 'config/inventory.example.json').read_text())
        cls.dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        if not cls.dotnet:
            raise RuntimeError('Set DOTNET_EXECUTABLE or put .NET 8 SDK on PATH.')
        if not DLL.exists():
            raise RuntimeError('Build the Bridge in Release before running tests.')
        cls.start()

    @classmethod
    def start(cls, *, write_key=True, inventory=True, configuration=True, map_configuration=True, map_alias=None):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = os.environ.copy()
        for name in ['INVENTORY_FILE', 'CAMERA_CONFIG_FILE', 'MAP_CONFIG_FILE', 'INVENTORY_WRITE_KEY']:
            env.pop(name, None)
        env['ASPNETCORE_URLS'] = cls.base
        env['ASPNETCORE_ENVIRONMENT'] = 'Production'
        if inventory: env['INVENTORY_FILE'] = str(cls.inventory_path)
        if configuration: env['CAMERA_CONFIG_FILE'] = str(cls.config_path)
        if map_configuration: env['MAP_CONFIG_FILE'] = str(map_alias or cls.map_path)
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
        self.map_path.unlink(missing_ok=True)

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

    def test_report_import_auth_revision_validation_and_metadata(self):
        import_body = {'document': copy.deepcopy(self.fixture), 'inventoryVersion': self.request('/api/inventory')[1]['version']}
        camera = import_body['document']['cameras'][0]
        camera.update(ptzCap=None, model='SYNTHETIC-MODEL', reportedPtzSupported=True)
        original = self.inventory_path.read_bytes()
        self.assertEqual(self.request('/api/inventory', 'POST', import_body)[0], 401)
        invalid = copy.deepcopy(import_body)
        invalid['document']['complete'] = False
        self.assertEqual(self.request('/api/inventory', 'POST', invalid, self.key)[0], 422)
        invalid = copy.deepcopy(import_body)
        invalid['document']['cameras'].append(copy.deepcopy(camera))
        invalid['document']['totalCount'] += 1
        self.assertEqual(self.request('/api/inventory', 'POST', invalid, self.key)[0], 422)
        self.assertEqual(self.inventory_path.read_bytes(), original)
        status, result = self.request('/api/inventory', 'POST', import_body, self.key)
        self.assertEqual(status, 200)
        self.assertIsNone(result['cameras'][0]['getPosNormalize'])
        self.assertTrue(result['cameras'][0]['reportedPtzSupported'])
        self.assertFalse(result['liveSsmConnected'])
        self.assertEqual(self.request('/api/inventory', 'POST', import_body, self.key)[0], 409)
        self.assertEqual(self.request('/api/cameras', 'PUT', self.selection(), self.key)[0], 200)
        selected = self.request('/api/cameras')[1]['configuration']['cameras'][0]
        self.assertEqual(selected['model'], 'SYNTHETIC-MODEL')
        self.assertTrue(selected['reportedPtzSupported'])
        self.assertIsNone(selected['ptz']['getPosNormalize'])

    def test_report_import_initial_missing_file_preserves_configuration(self):
        self.inventory_path.unlink()
        body = {'document': copy.deepcopy(self.fixture), 'inventoryVersion': None}
        self.assertEqual(self.request('/api/inventory', 'POST', body, self.key)[0], 200)
        self.assertEqual(self.request('/api/inventory')[1]['totalCount'], 3)
        selection = self.selection()
        self.assertEqual(self.request('/api/cameras', 'PUT', selection, self.key)[0], 200)
        previous = self.config_path.read_bytes()
        body['inventoryVersion'] = self.request('/api/inventory')[1]['version']
        self.assertEqual(self.request('/api/inventory', 'POST', body, self.key)[0], 200)
        self.assertEqual(self.config_path.read_bytes(), previous)


    def map_document(self, orientation=False):
        doc = {'schemaVersion': 1, 'crs': 'EPSG:4326', 'positions': [
            {'id': 'test-position', 'name': 'synthetic installation', 'lat': 37.5, 'lon': 127.1,
             'ssmUuid': A, 'positionSource': 'operator', 'orientation': None}]}
        if orientation:
            doc['positions'][0]['orientation'] = {
                'source': 'manual-calibration', 'status': 'estimate', 'confidence': 'unvalidated',
                'headingDeg': 0, 'pitchDeg': 0, 'horizontalFovDeg': 60, 'cameraHeightM': 5,
                'groundElevationM': 0, 'groundElevationSource': 'map-terrain',
                'positionAtCalibration': {'lat': 37.5, 'lon': 127.1},
                'calibratedAt': '2026-10-10T10:00:00Z',
                'reference': {'sha256': 'a' * 64, 'capturedAt': '2026-10-10T09:00:00Z', 'width': 1920, 'height': 1080},
                'landmarks': [{'label': 'test ridge', 'x': .25, 'y': .4}, {'label': 'test peak', 'x': .75, 'y': .3}]}
        return doc

    def save_map(self, doc, revision='none', key=None):
        return self.request('/api/map-configuration', 'PUT',
            {'configurationRevision': revision, 'configuration': doc}, self.key if key is None else key)

    def test_map_shared_storage_and_estimate_persist_on_restart(self):
        status, empty = self.request('/api/map-configuration')
        self.assertEqual(status, 200)
        self.assertEqual(empty['configuration']['positions'], [])
        doc = self.map_document(orientation=True)
        status, saved = self.save_map(doc)
        self.assertEqual(status, 200)
        # DateTimeOffset serializes UTC as +00:00; the instant and evidence are unchanged.
        doc['positions'][0]['orientation']['calibratedAt'] = '2026-10-10T10:00:00+00:00'
        doc['positions'][0]['orientation']['reference']['capturedAt'] = '2026-10-10T09:00:00+00:00'
        self.assertEqual(saved['configuration'], doc)
        self.assertEqual(self.request('/api/map-configuration')[1], saved)
        self.assertFalse(self.config_path.exists())
        self.assertEqual(json.loads(self.inventory_path.read_text()), self.fixture)
        self.stop(); self.start()
        self.assertEqual(self.request('/api/map-configuration')[1], saved)

    def test_map_write_key_required(self):
        body = {'configurationRevision': 'none', 'configuration': self.map_document()}
        for key in [None, 'wrong']:
            self.assertEqual(self.request('/api/map-configuration', 'PUT', body, key)[0], 401)
        self.assertFalse(self.map_path.exists())

    def test_map_concurrent_edit_conflict_preserves_winner(self):
        docs = [self.map_document(), self.map_document(orientation=True)]
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results = list(pool.map(self.save_map, docs))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        winner = next(saved for status, saved in results if status == 200)
        self.assertEqual(self.request('/api/map-configuration')[1], winner)
        self.assertEqual(list(self.work.glob('map.json.*.tmp')), [])

    def test_map_stale_orientation_explicit_and_unknown_distinct_from_zero(self):
        doc = self.map_document(orientation=True)
        doc['positions'][0]['orientation']['status'] = 'stale'
        status, stale = self.save_map(doc)
        self.assertEqual(status, 200)
        o = stale['configuration']['positions'][0]['orientation']
        self.assertEqual((o['status'], o['headingDeg'], o['groundElevationM']), ('stale', 0, 0))
        doc['positions'][0]['orientation'] = None
        status, unknown = self.save_map(doc, stale['revision'])
        self.assertEqual(status, 200)
        self.assertIsNone(unknown['configuration']['positions'][0]['orientation'])

    def test_map_invalid_evidence_cannot_overwrite_previous_file(self):
        _, saved = self.save_map(self.map_document())
        before = self.map_path.read_bytes()
        variants = []
        for key, value in [('source', 'ssm'), ('confidence', 'verified'), ('status', 'live'), ('headingDeg', -1),
                           ('pitchDeg', 81), ('horizontalFovDeg', 0), ('cameraHeightM', 0),
                           ('groundElevationM', 10000), ('groundElevationSource', 'guessed'),
                           ('landmarks', [{'label': 'one', 'x': .5, 'y': .5}]),
                           ('positionAtCalibration', {'lat': 37.6, 'lon': 127.1})]:
            doc = self.map_document(orientation=True); doc['positions'][0]['orientation'][key] = value; variants.append(doc)
        doc = self.map_document(orientation=True); doc['positions'][0]['positionSource'] = 'synthetic'; variants.append(doc)
        doc = self.map_document(); doc['positions'][0]['lat'] = 91; variants.append(doc)
        doc = self.map_document(); doc['positions'].append(copy.deepcopy(doc['positions'][0])); variants.append(doc)
        doc = self.map_document(orientation=True); doc['positions'][0]['orientation']['reference']['sha256'] = 'not-hash'; variants.append(doc)
        doc = self.map_document(orientation=True); doc['positions'][0]['orientation']['reference']['capturedAt'] = None; variants.append(doc)
        doc = self.map_document(orientation=True); doc['positions'][0]['orientation']['landmarks'][0]['x'] = 1.1; variants.append(doc)
        for index, doc in enumerate(variants):
            with self.subTest(index=index):
                self.assertIn(self.save_map(doc, saved['revision'])[0], [400, 422])
                self.assertEqual(self.map_path.read_bytes(), before)

    def test_map_missing_fields_or_image_credentials_never_persist(self):
        variants = []
        doc = self.map_document(); del doc['positions'][0]['lat']; variants.append(doc)
        doc = self.map_document(orientation=True); del doc['positions'][0]['orientation']['headingDeg']; variants.append(doc)
        doc = self.map_document(); doc['apiKey'] = 'SECRET-TEST-KEY'; variants.append(doc)
        doc = self.map_document(orientation=True); doc['positions'][0]['orientation']['reference']['imageData'] = 'data:image/png;base64,FAKE'; variants.append(doc)
        for doc in variants:
            self.assertEqual(self.save_map(doc)[0], 400)
            self.assertFalse(self.map_path.exists())

    def test_map_corrupt_configuration_not_silently_reset(self):
        self.map_path.write_text('{"broken":true}')
        before = self.map_path.read_bytes()
        self.assertEqual(self.request('/api/map-configuration')[0], 422)
        self.assertEqual(self.save_map(self.map_document())[0], 422)
        self.assertEqual(self.map_path.read_bytes(), before)

    def test_map_alias_with_inventory_or_selection_blocked(self):
        self.config_path.write_text('{"cameras":[]}')
        for path in [self.inventory_path, self.config_path]:
            before = path.read_bytes()
            self.stop(); self.start(map_alias=path)
            try:
                self.assertEqual(self.request('/api/map-configuration')[0], 503)
                self.assertEqual(self.save_map(self.map_document())[0], 503)
                self.assertEqual(path.read_bytes(), before)
            finally:
                self.stop(); self.start()

    def test_map_unconfigured_or_key_disabled_fails_closed(self):
        self.stop(); self.start(map_configuration=False)
        try:
            self.assertEqual(self.request('/api/map-configuration')[0], 503)
            self.assertEqual(self.save_map(self.map_document())[0], 503)
        finally:
            self.stop(); self.start(write_key=False)
        try:
            self.assertEqual(self.save_map(self.map_document())[0], 503)
            self.assertFalse(self.map_path.exists())
        finally:
            self.stop(); self.start()

if __name__ == '__main__':
    unittest.main(verbosity=2)
