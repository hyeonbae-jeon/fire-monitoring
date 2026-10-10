"""Build a self-contained Windows x64 demo ZIP; no SSM requests or credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT / 'artifacts')
args = parser.parse_args()
dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
if not dotnet:
    raise SystemExit('Set DOTNET_EXECUTABLE or put dotnet on PATH.')
npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
if not npm:
    raise SystemExit('npm is required on the BUILD machine only.')
if not (ROOT / 'web/node_modules').exists():
    raise SystemExit('Run npm ci in web before packaging.')
subprocess.run([npm, 'run', 'build', '--', '--outDir', '../bridge/WisenetPtzBridge/wwwroot', '--emptyOutDir'],
               cwd=ROOT / 'web', check=True)
args.output.mkdir(parents=True, exist_ok=True)
zip_path = args.output.resolve() / 'Wisenet-Camera-Inventory-Demo-win-x64.zip'
with tempfile.TemporaryDirectory() as temporary:
    package = Path(temporary) / 'Wisenet-Camera-Inventory-Demo'
    subprocess.run([dotnet, 'publish', str(ROOT / 'bridge/WisenetPtzBridge'), '-c', 'Release',
                    '-r', 'win-x64', '--self-contained', 'true', '-p:PublishTrimmed=false',
                    '-o', str(package), '--nologo'], cwd=ROOT, check=True)
    if not (package / 'WisenetPtzBridge.exe').is_file() or not (package / 'wwwroot/index.html').is_file():
        raise RuntimeError('Missing Windows executable or bundled web app.')
    (package / 'demo').mkdir()
    (package / 'data').mkdir()
    shutil.copyfile(ROOT / 'config/inventory.example.json', package / 'demo/inventory.json')
    (package / 'portable-demo.json').write_text(json.dumps({'mode': 'synthetic-demo'}), encoding='utf-8')
    (package / '사용방법.txt').write_text((ROOT / 'docs/windows-demo.md').read_text(encoding='utf-8'), encoding='utf-8-sig')
    (package / 'docs').mkdir()
    for name in ['vworld-monitoring.md', 'terrain-calibration.md', 'video-direction-feasibility.md', 'ssm-report-import.md']:
        shutil.copyfile(ROOT / 'docs' / name, package / 'docs' / name)
    (package / '문제진단.cmd').write_bytes(b'@echo off\r\ncd /d "%~dp0"\r\nWisenetPtzBridge.exe --no-browser\r\npause\r\n')
    # Ship the runtime's notices and application dependency license information.
    shutil.copyfile(ROOT / 'web/package-lock.json', package / 'web-package-lock.json')
    notices = package / 'licenses'
    notices.mkdir()
    for name in ['react', 'react-dom', 'scheduler']:
        shutil.copyfile(ROOT / 'web/node_modules' / name / 'LICENSE', notices / (name + '-LICENSE.txt'))
    sdk_root = Path(shutil.which(dotnet) or dotnet).resolve().parent
    for name in ['LICENSE.txt', 'ThirdPartyNotices.txt']:
        if (sdk_root / name).exists():
            shutil.copyfile(sdk_root / name, notices / ('dotnet-' + name))
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(package.rglob('*')):
            archive.write(path, path.relative_to(package.parent))
    with zipfile.ZipFile(zip_path) as archive:
        bad = archive.testzip()
        if bad: raise RuntimeError('Corrupt archive entry: ' + bad)
        names = archive.namelist()
        if any('/data/' in name and not name.endswith('/') for name in names):
            raise RuntimeError('Do not package saved camera configuration.')
digest = hashlib.file_digest(zip_path.open('rb'), 'sha256').hexdigest()
zip_path.with_suffix('.zip.sha256').write_text(digest + '  ' + zip_path.name + '\n', encoding='ascii')
print('Windows demo archive: ' + str(zip_path))
print('SHA256: ' + digest)
