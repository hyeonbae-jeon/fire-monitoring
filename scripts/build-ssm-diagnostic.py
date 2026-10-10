"""Package the independent SSM diagnostic; no credentials, real hosts or SSM DLLs."""
import argparse
import hashlib
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
    raise SystemExit('Set DOTNET_EXECUTABLE or put dotnet on PATH on the BUILD machine.')
args.output.mkdir(parents=True, exist_ok=True)
zip_path = args.output.resolve() / 'SSM-Connection-Test-win-x64.zip'
with tempfile.TemporaryDirectory() as temporary:
    package = Path(temporary) / 'SSM-Connection-Test'
    subprocess.run([dotnet, 'publish', str(ROOT / 'bridge/SsmConnectionTest'), '-c', 'Release',
                    '-r', 'win-x64', '--self-contained', 'true', '-p:PublishTrimmed=false',
                    '-o', str(package), '--nologo'], cwd=ROOT, check=True)
    if not (package / 'SsmConnectionTest.exe').is_file():
        raise RuntimeError('Missing Windows executable.')
    (package / '사용방법.txt').write_text((ROOT / 'docs/ssm-connection-test.md').read_text(), encoding='utf-8-sig')
    sdk = Path(shutil.which(dotnet) or dotnet).resolve().parent
    for name in ['LICENSE.txt', 'ThirdPartyNotices.txt']:
        if (sdk / name).exists():
            shutil.copyfile(sdk / name, package / name)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(package.rglob('*')):
            archive.write(path, path.relative_to(package.parent))
    with zipfile.ZipFile(zip_path) as archive:
        if archive.testzip():
            raise RuntimeError('ZIP integrity failure.')
        if any('/diagnostics/' in p or p.endswith('.private.json') for p in archive.namelist()):
            raise RuntimeError('Do not package operational diagnostics.')
with zip_path.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
zip_path.with_suffix('.zip.sha256').write_text(digest + '  ' + zip_path.name + '\n', encoding='ascii')
print('Windows diagnostic archive: ' + str(zip_path))
print('SHA256: ' + digest)
