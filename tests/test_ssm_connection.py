"""Run the real diagnostic against synthetic HTTPS SSM servers, never operational CCTV."""
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / 'bridge/SsmConnectionTest/bin/Release/net8.0/SsmConnectionTest.dll'
SERVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
COMPONENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
CAMERA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
PASSWORD = 'fake-password-한글'
SESSION = 'fake-session-123'


def openssl(*args, data=None):
    return subprocess.run(['openssl', *args], input=data, capture_output=True, check=True).stdout


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        cls.dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
        if not cls.dotnet or not DLL.exists():
            raise RuntimeError('Build SsmConnectionTest Release and set DOTNET_EXECUTABLE first.')
        cls.key = cls.folder / 'key.pem'
        cls.cert = cls.folder / 'cert.pem'
        openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(cls.key),
                '-out', str(cls.cert), '-days', '2', '-subj', '/CN=synthetic-ssm')
        cls.pin = hashlib.sha256(openssl('x509', '-in', str(cls.cert), '-outform', 'DER')).hexdigest()
        cls.public_key = base64.b64encode(openssl('pkey', '-in', str(cls.key), '-pubout', '-outform', 'DER')).decode()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_case(self, mode='ok', *, pin=None, endpoint_scheme='https', status_only=False, connection_target=None,
                 interactive_connection_target=None):
        seen = []
        auth_errors = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status=200, body=None, headers=None):
                encoded = json.dumps(body if body is not None else {}).encode()
                self.send_response(status)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def check_auth(self):
                timestamp = self.headers.get('x-ssm-date', '')
                signature = hmac.new(PASSWORD.encode(), (self.path + ':' + timestamp).encode(), hashlib.sha256).hexdigest()
                expected = 'TSM ' + base64.b64encode((SESSION + ':' + signature).encode()).decode()
                if self.headers.get('Authorization') != expected or self.headers.get('Cookie') != 'Session_ID=' + SESSION:
                    auth_errors.append('bad signature or cookie')
                    return False
                return True

            def do_GET(self):
                seen.append(('GET', self.path))
                if self.path == '/V1/report/status':
                    if mode == 'redirect':
                        return self.reply(302, headers={'Location': '/V1/Session/ForcedDisconnect'})
                    headers = {'serverstatus': 'START', 'ServerVersion': '2.21.00', 'sslport': '9991'}
                    if mode != 'missing-key':
                        headers['PublicKey'] = 'bad-key' if mode == 'invalid-key' else outer.public_key
                    if mode == 'wrong-version':
                        headers['ServerVersion'] = '2.22.00'
                    return self.reply(headers=headers)
                if not self.check_auth():
                    return self.reply(401)
                if self.path == '/v3/servers?type=all':
                    if mode == 'malformed-servers':
                        return self.reply(body={'content': []})
                    # Unexpected sensitive fields must never reach diagnostic output.
                    return self.reply(body=[{'guid': SERVER, 'ddnsPassword': 'SECRET-SERVER-FIELD',
                        'serverPort': 9999, 'serverSslPort': 9991,
                        'networkInfo': {'addressList': {'tcp': '192.0.2.10'}, 'portList': {'tcpPort': 8888},
                                        'id': 'SECRET-NETWORK-ID', 'password': 'SECRET-NETWORK-PASSWORD'}}])
                if self.path == f'/v3/servers/{SERVER}/components':
                    return self.reply(body=[{'guid': COMPONENT, 'networkInfo': {'addressType': 1,
                        'addressList': {'wan': 'recorder.example.test'}, 'portList': {'wanPort': 8080},
                        'id': 'SECRET-NETWORK-ID', 'password': 'SECRET-NETWORK-PASSWORD'}}])
                if self.path == f'/v3/components/{COMPONENT}/channels?serverGuid={SERVER}':
                    if mode == 'partial-failure':
                        return self.reply(403, {'password': 'SECRET-ERROR-BODY'})
                    rows = [{'guid': CAMERA, 'name': 'synthetic camera', 'type': 8192, 'ptzCap': 18446744073709551615,
                             'ip': 'SECRET-IP', 'password': 'SECRET-CAMERA-FIELD'},
                            {'guid': OTHER, 'name': 'unknown capability', 'type': 8192}]
                    if mode == 'zero-cap':
                        rows[0]['ptzCap'] = 0
                    if mode == 'invalid-cap':
                        rows[0]['ptzCap'] = -1
                    if mode == 'conflict':
                        rows.append(dict(rows[0], name='changed'))
                    if mode in ('metadata', 'invalid-metadata', 'metadata-conflict', 'ineligible-metadata'):
                        rows[0].update(capability='80', subType=4, installType=1,
                            extendedData=json.dumps({'latitude': '37.5', 'longitude': '127.1', 'heading': '0',
                                                     'password': 'SECRET-EXTENDED-DATA', 'ip': 'SECRET-EXTENDED-IP'}))
                    if mode == 'invalid-metadata':
                        rows[0].update(capability=128, subType='4', installType=-1,
                                       extendedData='invalid SECRET-EXTENDED-DATA')
                        rows[1]['extendedData'] = json.dumps({'latitude': 'NaN', 'longitude': '181',
                                                            'heading': 'SECRET-EXTENDED-DATA'})
                    if mode == 'metadata-conflict':
                        rows.append(dict(rows[0], extendedData=json.dumps({'heading': '90'})))
                    if mode == 'ineligible-metadata':
                        rows[0]['subType'] = 1
                    if mode in ('connection-details', 'invalid-connection', 'connection-conflict'):
                        rows[0]['networkInfo'] = {'addressType': 2, 'devProtocolType': 1, 'medProtocolType': 0,
                            'addressList': {'tcp': '192.0.2.20', 'wan': 'camera.example.test', 'http': '192.0.2.20',
                                            'https': '192.0.2.20', 'rtsp': ''},
                            'portList': {'tcpPort': 0, 'wanPort': 18080, 'httpPort': 80, 'httpsPort': 443, 'rtspPort': 554},
                            'id': 'SECRET-NETWORK-ID', 'password': 'SECRET-NETWORK-PASSWORD',
                            'ddnsID': 'SECRET-DDNS-ID', 'extra': 'SECRET-NETWORK-EXTRA'}
                    if mode == 'invalid-connection':
                        network = rows[0]['networkInfo']
                        network['addressList'].update(http='https://user:SECRET-URL-PASSWORD@camera.example.test/',
                                                      https='https://camera.example.test/?token=SECRET-URL-TOKEN',
                                                      tcp='camera.example.test/SECRET-PATH')
                        network['portList'].update(httpPort=65536, httpsPort=-1, rtspPort='554')
                    if mode == 'connection-conflict':
                        rows.append(dict(rows[0], networkInfo=dict(rows[0]['networkInfo'], portList={'httpPort': 8080})))
                    return self.reply(body=rows)
                return self.reply(404)

            def do_POST(self):
                seen.append(('POST', self.path))
                if self.path != '/V1/Session':
                    return self.reply(400)
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                for field, expected in [('id', 'fake-user'), ('password', PASSWORD)]:
                    decoded = openssl('pkeyutl', '-decrypt', '-inkey', str(outer.key),
                                      '-pkeyopt', 'rsa_padding_mode:pkcs1', data=base64.b64decode(body[field])).decode()
                    if decoded != expected:
                        auth_errors.append('bad RSA plaintext')
                if body['service'] != 12 or body['clientVersion'] != '2.21.00' or body['ip'] != '127.0.0.1':
                    auth_errors.append('bad login metadata')
                if mode == 'login-denied':
                    return self.reply(409, {'Token': 'SECRET-ERROR-BODY'})
                return self.reply(body={'SessionId': SESSION, 'Token': 'SECRET-TOKEN', 'secretKey': 'SECRET-KEY'})

            def do_DELETE(self):
                seen.append(('DELETE', self.path))
                if self.path != '/V1/Session' or not self.check_auth():
                    return self.reply(400)
                return self.reply()

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert, self.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as output:
                args = [self.dotnet, str(DLL), '--server', f'{endpoint_scheme}://127.0.0.1:{server.server_port}',
                        '--pin', pin or self.pin, '--output', output]
                if status_only:
                    args.append('--status-only')
                if connection_target is not None:
                    args += ['--connection-camera', connection_target]
                inputs = 'Y\nfake-user\n' + PASSWORD + '\n'
                if interactive_connection_target is not None:
                    inputs += 'Y\n' + interactive_connection_target + '\n'
                result = subprocess.run(args, input=inputs, text=True,
                                        capture_output=True, timeout=35)
                reports = list(Path(output).rglob('connection-report.json'))
                self.assertEqual(len(reports), 1, result.stdout + result.stderr)
                report = json.loads(reports[0].read_text())
                previews = list(Path(output).rglob('camera-preview.private.json'))
                preview = json.loads(previews[0].read_text()) if previews else None
                metadata = list(Path(output).rglob('camera-metadata.private.json'))
                self.last_metadata = json.loads(metadata[0].read_text()) if metadata else None
                details = list(Path(output).rglob('camera-connection.private.json'))
                self.last_connection = json.loads(details[0].read_text()) if details else None
                all_output = result.stdout + result.stderr + ''.join(p.read_text() for p in Path(output).rglob('*.json'))
                for secret in [PASSWORD, SESSION, 'SECRET-SERVER-FIELD', 'SECRET-TOKEN', 'SECRET-KEY', 'SECRET-IP',
                               'SECRET-CAMERA-FIELD', 'SECRET-ERROR-BODY', 'SECRET-EXTENDED-DATA', 'SECRET-EXTENDED-IP',
                               'SECRET-NETWORK-ID', 'SECRET-NETWORK-PASSWORD', 'SECRET-DDNS-ID', 'SECRET-NETWORK-EXTRA',
                               'SECRET-URL-PASSWORD', 'SECRET-URL-TOKEN', 'SECRET-PATH']:
                    self.assertNotIn(secret, all_output)
                for address in ['192.0.2.10', '192.0.2.20', 'camera.example.test', 'recorder.example.test']:
                    self.assertNotIn(address, result.stdout + result.stderr + reports[0].read_text())
                self.assertEqual(auth_errors, [])
                self.assertFalse(report['complete'])
                return result, report, preview, seen
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_pinned_self_signed_mismatched_name_login_inventory_logout(self):
        result, report, preview, seen = self.run_case()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['result'], 'inventory-preview-ok')
        self.assertTrue(report['certificateMatched'])
        self.assertEqual(report['logout'], 'ok')
        self.assertEqual(report['cameraCount'], 2)
        self.assertEqual(report['unknownPtzCapCount'], 1)
        self.assertFalse(preview['complete'])
        caps = {c['uuid']: c['ptzCap'] for c in preview['cameras']}
        self.assertEqual(caps[CAMERA], '18446744073709551615')
        self.assertIsNone(caps[OTHER])
        self.assertEqual([m for m, _ in seen], ['GET', 'POST', 'GET', 'GET', 'GET', 'DELETE'])

    def test_status_only_never_authenticates(self):
        result, report, preview, seen = self.run_case(status_only=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['result'], 'status-ok')
        self.assertIsNone(preview)
        self.assertEqual(seen, [('GET', '/V1/report/status')])

    def test_pin_mismatch_rejected_before_http_or_credentials(self):
        result, report, preview, seen = self.run_case(pin='0' * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report['error'], 'CERTIFICATE_PIN_OR_VALIDITY_REJECTED')
        self.assertEqual(seen, [])

    def test_http_endpoint_rejected_without_requests(self):
        result, report, preview, seen = self.run_case(endpoint_scheme='http')
        self.assertEqual(report['error'], 'HTTPS_ORIGIN_REQUIRED')
        self.assertEqual(seen, [])

    def test_redirect_not_followed(self):
        result, report, preview, seen = self.run_case('redirect')
        self.assertEqual(report['error'], 'HTTP_302')
        self.assertEqual(seen, [('GET', '/V1/report/status')])

    def test_missing_key_does_not_send_login(self):
        result, report, preview, seen = self.run_case('missing-key')
        self.assertEqual(report['error'], 'PUBLIC_KEY_MISSING')
        self.assertEqual(len(seen), 1)

    def test_invalid_key_does_not_send_login(self):
        result, report, preview, seen = self.run_case('invalid-key')
        self.assertEqual(report['error'], 'PUBLIC_KEY_INVALID')
        self.assertEqual(len(seen), 1)

    def test_unverified_version_does_not_send_login(self):
        result, report, preview, seen = self.run_case('wrong-version')
        self.assertEqual(report['error'], 'SERVER_CONTRACT_UNVERIFIED')
        self.assertEqual(len(seen), 1)

    def test_login_failure_no_retry_or_forced_login(self):
        result, report, preview, seen = self.run_case('login-denied')
        self.assertEqual(report['error'], 'HTTP_409')
        self.assertEqual(sum(m == 'POST' for m, _ in seen), 1)
        self.assertEqual(len(seen), 2)
        self.assertIsNone(preview)

    def test_partial_scope_failure_no_preview_and_logs_out(self):
        result, report, preview, seen = self.run_case('partial-failure')
        self.assertEqual(report['error'], 'HTTP_403')
        self.assertEqual(report['logout'], 'ok')
        self.assertIsNone(preview)

    def test_invalid_list_shape_no_preview_and_logs_out(self):
        result, report, preview, seen = self.run_case('malformed-servers')
        self.assertEqual(report['error'], 'ARRAY_RESPONSE_REQUIRED')
        self.assertEqual(report['logout'], 'ok')
        self.assertIsNone(preview)

    def test_invalid_capability_no_preview(self):
        result, report, preview, seen = self.run_case('invalid-cap')
        self.assertEqual(report['error'], 'PTZ_CAP_INVALID')
        self.assertIsNone(preview)

    def test_conflicting_uuid_no_preview(self):
        result, report, preview, seen = self.run_case('conflict')
        self.assertEqual(report['error'], 'CONFLICTING_CAMERA')
        self.assertIsNone(preview)

    def test_zero_capability_is_distinct_from_missing(self):
        result, report, preview, seen = self.run_case('zero-cap')
        caps = {c['uuid']: c['ptzCap'] for c in preview['cameras']}
        self.assertEqual(caps[CAMERA], '0')
        self.assertIsNone(caps[OTHER])

    def test_configured_metadata_not_current_ptz_and_hex_capability_gate(self):
        result, report, preview, seen = self.run_case('metadata')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['toolVersion'], '3')
        self.assertEqual(report['configuredHeadingCount'], 1)
        self.assertEqual(report['configuredCoordinateCount'], 1)
        self.assertEqual(report['xMapSubscriptionCandidateCount'], 1)
        self.assertEqual(report['unknownSubscriptionConditionsCount'], 1)
        self.assertEqual(report['metadataIssueCameraCount'], 0)
        rows = {c['uuid']: c for c in self.last_metadata['cameras']}
        self.assertEqual(rows[CAMERA]['entityCapability'], '128')
        self.assertEqual(rows[CAMERA]['configuredHeading'], '0')
        self.assertEqual(rows[CAMERA]['configuredLatitude'], '37.5')
        self.assertTrue(rows[CAMERA]['xMapSubscriptionConditions'])
        self.assertIsNone(rows[OTHER]['xMapSubscriptionConditions'])
        self.assertIsNone(rows[OTHER]['configuredHeading'])
        self.assertFalse(self.last_metadata['complete'])
        self.assertEqual([m for m, _ in seen], ['GET', 'POST', 'GET', 'GET', 'GET', 'DELETE'])

    def test_optional_invalid_metadata_is_unknown_with_explicit_issues(self):
        result, report, preview, seen = self.run_case('invalid-metadata')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['metadataIssueCameraCount'], 2)
        self.assertEqual(report['configuredHeadingCount'], 0)
        self.assertEqual(report['configuredCoordinateCount'], 0)
        self.assertEqual(report['xMapSubscriptionCandidateCount'], 0)
        rows = {c['uuid']: c for c in self.last_metadata['cameras']}
        self.assertIsNone(rows[CAMERA]['entityCapability'])
        self.assertIn('CAPABILITY_FORMAT_INVALID', rows[CAMERA]['issues'])
        self.assertIn('EXTENDED_DATA_JSON_INVALID', rows[CAMERA]['issues'])
        self.assertIsNone(rows[OTHER]['configuredLatitude'])
        self.assertIsNone(rows[OTHER]['configuredHeading'])

    def test_duplicate_uuid_with_conflicting_metadata_rejected(self):
        result, report, preview, seen = self.run_case('metadata-conflict')
        self.assertEqual(report['error'], 'CONFLICTING_CAMERA_METADATA')
        self.assertIsNone(preview)
        self.assertIsNone(self.last_metadata)
        self.assertEqual(report['logout'], 'ok')

    def test_known_unsatisfied_subtype_does_not_become_position_candidate(self):
        result, report, preview, seen = self.run_case('ineligible-metadata')
        self.assertEqual(report['xMapSubscriptionCandidateCount'], 0)
        rows = {c['uuid']: c for c in self.last_metadata['cameras']}
        self.assertFalse(rows[CAMERA]['xMapSubscriptionConditions'])

    def test_connection_details_opt_in_only_and_no_extra_requests(self):
        result, report, _, seen = self.run_case('connection-details', connection_target='synthetic camera')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['connectionDetailCameraCount'], 1)
        self.assertEqual(report['connectionDetailIssueCount'], 0)
        payload = self.last_connection
        self.assertFalse(payload['routeVerified'])
        self.assertFalse(payload['complete'])
        c = payload['connection']
        self.assertEqual(c['uuid'], CAMERA)
        self.assertEqual(c['componentUuid'], COMPONENT)
        self.assertEqual(c['serverUuid'], SERVER)
        self.assertEqual(c['camera']['ports']['httpPort'], 80)
        self.assertIsNone(c['camera']['ports']['tcpPort'])
        self.assertEqual(c['component']['ports']['wanPort'], 8080)
        self.assertEqual(c['server']['serverSslPort'], 9991)
        self.assertEqual(c['camera']['addresses']['wan'], 'camera.example.test')
        self.assertIsNone(c['camera']['addresses']['rtsp'])
        self.assertEqual([m for m, _ in seen], ['GET', 'POST', 'GET', 'GET', 'GET', 'DELETE'])

    def test_connection_details_not_written_without_opt_in(self):
        result, report, _, _ = self.run_case('connection-details')
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(self.last_connection)
        self.assertEqual(report['connectionDetailCameraCount'], 0)

    def test_interactive_camera_selection_after_login(self):
        result, report, _, seen = self.run_case('connection-details', interactive_connection_target='synthetic camera')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['connectionDetailCameraCount'], 1)
        self.assertEqual(self.last_connection['connection']['uuid'], CAMERA)
        self.assertEqual([m for m, _ in seen], ['GET', 'POST', 'GET', 'GET', 'GET', 'DELETE'])

    def test_empty_interactive_selection_does_not_collect_other_cameras(self):
        result, report, _, seen = self.run_case('connection-details', interactive_connection_target='')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report['error'], 'CONNECTION_TARGET_REQUIRED')
        self.assertEqual(seen, [('GET', '/V1/report/status'), ('POST', '/V1/Session'), ('DELETE', '/V1/Session')])
        self.assertIsNone(self.last_connection)

    def test_connection_uuid_selection(self):
        result, _, _, _ = self.run_case('connection-details', connection_target=CAMERA.upper())
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.last_connection['connection']['uuid'], CAMERA)

    def test_absent_network_fields_not_guessed(self):
        result, _, _, _ = self.run_case(connection_target='synthetic camera')
        self.assertEqual(result.returncode, 0)
        c = self.last_connection['connection']['camera']
        self.assertFalse(c['networkInfoPresent'])
        self.assertTrue(all(value is None for value in c['ports'].values()))
        self.assertTrue(all(value is None for value in c['addresses'].values()))

    def test_invalid_ports_and_credential_urls_discarded(self):
        result, report, _, _ = self.run_case('invalid-connection', connection_target=CAMERA)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report['connectionDetailIssueCount'], 6)
        c = self.last_connection['connection']['camera']
        self.assertIsNone(c['ports']['httpPort'])
        self.assertIsNone(c['ports']['httpsPort'])
        self.assertIsNone(c['ports']['rtspPort'])
        self.assertIsNone(c['addresses']['http'])
        self.assertIsNone(c['addresses']['https'])
        self.assertIsNone(c['addresses']['tcp'])

    def test_ambiguous_connection_target_not_selected_automatically(self):
        result, report, preview, _ = self.run_case('connection-details', connection_target='a')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report['error'], 'CONNECTION_TARGET_AMBIGUOUS')
        self.assertEqual(report['logout'], 'ok')
        self.assertIsNone(preview)
        self.assertIsNone(self.last_connection)

    def test_missing_connection_target_no_file(self):
        result, report, _, _ = self.run_case(connection_target='no matching camera')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report['error'], 'CONNECTION_TARGET_NOT_FOUND')
        self.assertIsNone(self.last_connection)

    def test_conflicting_connection_details_rejected(self):
        result, report, _, _ = self.run_case('connection-conflict', connection_target=CAMERA)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report['error'], 'CONFLICTING_CONNECTION_DETAILS')
        self.assertIsNone(self.last_connection)
        self.assertEqual(report['logout'], 'ok')


if __name__ == '__main__':
    unittest.main(verbosity=2)
