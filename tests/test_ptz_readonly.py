"""Exercise the actual executable against a synthetic ONVIF device, never a CCTV."""
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DOTNET = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
DLL = ROOT / 'bridge/PtzReadOnlyTest/bin/Release/net8.0/PtzReadOnlyTest.dll'
SOAP = 'http://www.w3.org/2003/05/soap-envelope'
DEVICE = 'http://www.onvif.org/ver10/device/wsdl'
MEDIA = 'http://www.onvif.org/ver10/media/wsdl'
PTZ = 'http://www.onvif.org/ver20/ptz/wsdl'
TT = 'http://www.onvif.org/ver10/schema'
SEC = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
UTIL = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
USER = 'PRIVATE_ONVIF_USER'
PASSWORD = 'PRIVATE_ONVIF_PASSWORD<&>'
TOKEN = 'channel<&>1'
SERIAL = 'PRIVATE_SERIAL_NUMBER'
ALLOWED = ['GetDeviceInformation', 'GetCapabilities', 'GetProfiles', 'GetStatus']


class Device(http.server.ThreadingHTTPServer):
    def __init__(self, mode='normal', secure=False, certificate=None, key=None):
        super().__init__(('127.0.0.1', 0), Handler)
        self.mode = mode
        self.operations = []
        self.errors = []
        self.nonces = set()
        self.digestChallenges = 0
        self.digestResponses = 0
        self.scheme = 'https' if secure else 'http'
        if secure:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certificate, key)
            self.socket = context.wrap_socket(self.socket, server_side=True)
        self.origin = f'{self.scheme}://127.0.0.1:{self.server_port}'


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        try:
            body = self.rfile.read(int(self.headers['Content-Length']))
            root = ET.fromstring(body)
            request = list(root.find(f'{{{SOAP}}}Body'))[0]
            name = request.tag.rsplit('}', 1)[-1]
            if self.server.mode.startswith('digest_'):
                algorithm = 'SHA-256' if self.server.mode == 'digest_sha256' else 'MD5'
                auth = self.headers.get('Authorization', '')
                if not auth:
                    self.server.digestChallenges += 1
                    self.send_response(401)
                    self.send_header('WWW-Authenticate', f'Digest realm="synthetic-onvif", nonce="test-nonce", algorithm={algorithm}, qop="auth"')
                    self.end_headers()
                    return
                fields = {k: (v or bare) for k, v, bare in re.findall(r'(\w+)=(?:"([^"]*)"|([^, ]+))', auth)}
                hashfn = hashlib.sha256 if algorithm == 'SHA-256' else hashlib.md5
                def h(value):
                    return hashfn(value.encode()).hexdigest()
                expected = h(h(USER + ':synthetic-onvif:' + PASSWORD) + ':test-nonce:' + fields['nc'] + ':' + fields['cnonce'] + ':auth:' + h('POST:' + self.path))
                if not auth.startswith('Digest ') or fields['username'] != USER or fields['uri'] != self.path or fields['response'] != expected:
                    raise AssertionError('Bad independent HTTP Digest authentication')
                self.server.digestResponses += 1
            self.server.operations.append(name)
            if name not in ALLOWED:
                raise AssertionError('Non-read operation sent')
            if self.headers['Content-Type'].find(request.tag[1:].replace('}', '/') + '"') < 0:
                raise AssertionError('Wrong SOAP action')
            if PASSWORD.encode() in body or self.headers.get('Authorization', '').startswith('Basic'):
                raise AssertionError('Plain password or Basic authentication')
            token = root.find(f'.//{{{SEC}}}UsernameToken')
            if token.find(f'{{{SEC}}}Username').text != USER:
                raise AssertionError('Wrong user')
            nonce = token.find(f'{{{SEC}}}Nonce').text
            if nonce in self.server.nonces:
                raise AssertionError('Repeated nonce')
            self.server.nonces.add(nonce)
            created = token.find(f'{{{UTIL}}}Created').text
            digest = base64.b64encode(hashlib.sha1(base64.b64decode(nonce) + created.encode() + PASSWORD.encode()).digest()).decode()
            if token.find(f'{{{SEC}}}Password').text != digest:
                raise AssertionError('Bad independent WS-Security digest')
            status = 200
            if self.server.mode == 'unauthorized':
                self.send_response(401)
                self.end_headers()
                return
            if self.server.mode == 'basic_only':
                self.send_response(401)
                self.send_header('WWW-Authenticate', 'Basic realm="test"')
                self.end_headers()
                return
            if self.server.mode == 'redirect':
                self.send_response(302)
                self.send_header('Location', self.server.origin + '/should-not-follow')
                self.end_headers()
                return
            if self.server.mode == 'dtd':
                self.reply(200, b'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x>&secret;</x>')
                return
            if self.server.mode == 'oversize':
                self.send_response(200)
                self.send_header('Content-Length', '3000000')
                self.end_headers()
                return
            if name == 'GetDeviceInformation':
                content = f'<d:Manufacturer>Hanwha-test</d:Manufacturer><d:Model>SYNTHETIC</d:Model><d:FirmwareVersion>test</d:FirmwareVersion><d:SerialNumber>{SERIAL}</d:SerialNumber><d:HardwareId>test</d:HardwareId>'
                prefix = 'd'
            elif name == 'GetCapabilities':
                addr = self.server.origin
                if self.server.mode == 'cross_origin':
                    addr = 'https://credential-leak.invalid'
                ptz = '' if self.server.mode == 'no_ptz_service' else f'<tt:PTZ><tt:XAddr>{addr}/ptz</tt:XAddr></tt:PTZ>'
                content = f'<d:Capabilities><tt:Media><tt:XAddr>{addr}/media</tt:XAddr></tt:Media>{ptz}</d:Capabilities>'
                prefix = 'd'
            elif name == 'GetProfiles':
                ptz = '' if self.server.mode == 'no_ptz_profile' else '<tt:PTZConfiguration token="ptz"/>'
                profile = '<m:Profiles token="channel&lt;&amp;&gt;1"><tt:Name>Test camera profile</tt:Name>' + ptz + '<tt:VideoSourceConfiguration token="video"><tt:SourceToken>source1</tt:SourceToken></tt:VideoSourceConfiguration></m:Profiles>'
                content = profile * (2 if self.server.mode == 'duplicate_profile' else 1)
                prefix = 'm'
            else:
                if request.find(f'{{{PTZ}}}ProfileToken').text != TOKEN:
                    raise AssertionError('Wrong target profile/escaping')
                position = '<tt:Position><tt:PanTilt x="0" y="-0.25" space="http://www.onvif.org/ver10/tptz/PanTiltSpaces/PositionGenericSpace"/><tt:Zoom x="0.5" space="http://www.onvif.org/ver10/tptz/ZoomSpaces/PositionGenericSpace"/></tt:Position>'
                if self.server.mode == 'no_position':
                    position = ''
                elif self.server.mode == 'partial_position':
                    position = '<tt:Position><tt:Zoom x="0"/></tt:Position>'
                elif self.server.mode == 'nan':
                    position = position.replace('x="0"', 'x="NaN"')
                elif self.server.mode == 'duplicate_status':
                    position = ''
                if self.server.mode == 'soap_fault':
                    status = 500
                    content = '<s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code><s:Reason><s:Text>PRIVATE_ONVIF_PASSWORD secret raw fault</s:Text></s:Reason></s:Fault>'
                    self.reply(status, self.envelope(content))
                    return
                content = f'<p:PTZStatus>{position}<tt:UtcTime>2026-10-10T12:00:00Z</tt:UtcTime></p:PTZStatus>'
                if self.server.mode == 'duplicate_status':
                    content *= 2
                prefix = 'p'
            self.reply(status, self.envelope(f'<{prefix}:{name}Response>{content}</{prefix}:{name}Response>'))
        except Exception as e:
            self.server.errors.append(str(e))
            self.reply(500, b'test-server-failed')

    def envelope(self, body):
        return f'<s:Envelope xmlns:s="{SOAP}" xmlns:d="{DEVICE}" xmlns:m="{MEDIA}" xmlns:p="{PTZ}" xmlns:tt="{TT}"><s:Body>{body}</s:Body></s:Envelope>'.encode()

    def reply(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/soap+xml')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ReadOnlyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DOTNET or not DLL.exists():
            raise RuntimeError('Build PtzReadOnlyTest Release before running tests')
        cls.certdir = tempfile.TemporaryDirectory()
        cls.cert = Path(cls.certdir.name) / 'cert.pem'
        cls.key = Path(cls.certdir.name) / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1', '-subj', '/CN=synthetic-device'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        der = subprocess.check_output(['openssl', 'x509', '-in', str(cls.cert), '-outform', 'DER'])
        cls.pin = hashlib.sha256(der).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.certdir.cleanup()

    def run_probe(self, mode='normal', secure=False, pin=None, profile='1', expected=None):
        with tempfile.TemporaryDirectory() as temp:
            server = Device(mode, secure, self.cert, self.key)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            command = [DOTNET, str(DLL), '--device-service', server.origin + '/device', '--output', temp]
            if not secure:
                command += ['--allow-http']
            else:
                command += ['--pin', self.pin if pin is None else pin]
            inputs = 'test-location\n\n' + USER + '\n' + PASSWORD + '\n' + profile + '\n'
            try:
                result = subprocess.run(command, input=inputs, text=True, capture_output=True, timeout=30)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
            reports = list(Path(temp).rglob('ptz-check-report.json'))
            self.assertEqual(len(reports), 1, result.stdout + result.stderr)
            report = json.loads(reports[0].read_text())
            private = list(Path(temp).rglob('ptz-status.private.json'))
            payload = json.loads(private[0].read_text()) if private else None
            self.assertFalse(server.errors, server.errors)
            self.assertEqual(server.operations, ALLOWED[:len(server.operations)])
            for marker in [USER, PASSWORD, SERIAL, server.origin, TOKEN]:
                self.assertNotIn(marker, reports[0].read_text())
            for marker in [USER, PASSWORD, SERIAL, TOKEN]:
                self.assertNotIn(marker, result.stdout + result.stderr)
            if payload:
                self.assertNotIn(USER, private[0].read_text())
                self.assertNotIn(PASSWORD, private[0].read_text())
            if expected:
                self.assertEqual(report['error'], expected, report)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
            else:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return report, payload, server.operations

    def test_zero_pan_and_normalized_spaces(self):
        report, payload, operations = self.run_probe()
        self.assertEqual(operations, ALLOWED)
        self.assertEqual(report['result'], 'ptz-position-received')
        self.assertEqual(payload['sample']['pan'], 0)
        self.assertEqual(payload['sample']['tilt'], -0.25)
        self.assertEqual(payload['sample']['zoom'], 0.5)
        self.assertTrue(payload['sample']['panTiltSpace'].endswith('PositionGenericSpace'))
        self.assertFalse(report['mappingVerified'])
        self.assertFalse(report['northCalibrationVerified'])
        self.assertFalse(report['liveUpdateVerified'])

    def test_exact_https_pin_with_name_mismatch(self):
        report, _, _ = self.run_probe(secure=True)
        self.assertTrue(report['certificatePinned'])

    def test_http_digest_md5_handshake(self):
        self.run_probe('digest_md5')

    def test_http_digest_sha256_handshake(self):
        self.run_probe('digest_sha256')

    def test_wrong_pin_rejected_before_authenticated_soap(self):
        report, _, operations = self.run_probe(secure=True, pin='00' * 32, expected='DEVICE_CERTIFICATE_REJECTED')
        self.assertEqual(operations, [])
        self.assertTrue(report['certificateRejected'])

    def test_untrusted_cert_without_pin_rejected(self):
        self.run_probe(secure=True, pin='', expected='DEVICE_CERTIFICATE_REJECTED')

    def test_cross_origin_services_blocked_before_profile_request(self):
        _, _, operations = self.run_probe('cross_origin', expected='SERVICE_ORIGIN_MISMATCH')
        self.assertEqual(operations, ALLOWED[:2])

    def test_no_ptz_service(self):
        self.run_probe('no_ptz_service', expected='PTZ_SERVICE_NOT_ADVERTISED')

    def test_no_ptz_profile_no_status_request(self):
        _, _, operations = self.run_probe('no_ptz_profile', expected='PTZ_PROFILE_NOT_FOUND')
        self.assertEqual(operations, ALLOWED[:3])

    def test_operator_must_select_profile(self):
        self.run_probe(profile='', expected='EXPLICIT_PTZ_PROFILE_REQUIRED')

    def test_invalid_profile_not_guessed(self):
        self.run_probe(profile='2', expected='EXPLICIT_PTZ_PROFILE_REQUIRED')

    def test_duplicate_profile_not_guessed(self):
        self.run_probe('duplicate_profile', expected='PROFILE_TOKEN_INVALID_OR_DUPLICATE')

    def test_status_without_position_is_not_ptz_success(self):
        report, payload, _ = self.run_probe('no_position')
        self.assertEqual(report['result'], 'status-without-position')
        self.assertIsNone(payload['sample']['pan'])

    def test_partial_position_not_filled_with_zero(self):
        report, payload, _ = self.run_probe('partial_position')
        self.assertEqual(report['result'], 'partial-position-received')
        self.assertIsNone(payload['sample']['pan'])
        self.assertEqual(payload['sample']['zoom'], 0)

    def test_non_finite_position_rejected(self):
        self.run_probe('nan', expected='PTZ_POSITION_INVALID')

    def test_duplicate_status_rejected(self):
        self.run_probe('duplicate_status', expected='SOAP_STRUCTURE_INVALID')

    def test_fault_body_not_logged(self):
        self.run_probe('soap_fault', expected='SOAP_NOT_AUTHORIZED_OR_CLOCK_SKEW')

    def test_dtd_rejected(self):
        self.run_probe('dtd', expected='XML_RESPONSE_INVALID')

    def test_oversize_response_rejected(self):
        self.run_probe('oversize', expected='RESPONSE_TOO_LARGE')

    def test_no_redirect(self):
        _, _, operations = self.run_probe('redirect', expected='REDIRECT_REJECTED')
        self.assertEqual(operations, ALLOWED[:1])

    def test_unauthorized_does_not_retry_password(self):
        _, _, operations = self.run_probe('unauthorized', expected='AUTHENTICATION_OR_PERMISSION_REJECTED')
        self.assertEqual(operations, ALLOWED[:1])

    def test_basic_auth_not_sent(self):
        _, _, operations = self.run_probe('basic_only', expected='AUTHENTICATION_OR_PERMISSION_REJECTED')
        self.assertEqual(operations, ALLOWED[:1])


if __name__ == '__main__':
    unittest.main(verbosity=2)
