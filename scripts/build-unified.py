#!/usr/bin/env python3
"""Build ONE user-facing installer/update artifact from a clean portable payload."""
from pathlib import Path
import hashlib
import shutil
import zipfile
ROOT = Path(__file__).resolve().parent.parent
payload = ROOT / 'artifacts/Wisenet-Camera-Inventory-Demo-win-x64.zip'
output = ROOT / 'artifacts/Fire-Monitor-Setup'
output.mkdir(parents=True, exist_ok=True)
# The payload must originate from build-portable.py's private-data/CRC guards.
with zipfile.ZipFile(payload) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        assert not name.endswith(('.protected', '.private.json'))
        assert '/data/' not in name or name.endswith('/')
        assert '..' not in Path(name).parts
shutil.copyfile(payload, output / 'payload.zip')
(output / 'payload.sha256').write_text(hashlib.file_digest(payload.open('rb'), 'sha256').hexdigest(), encoding='ascii')
for name in ['Setup.cmd', 'Install.ps1', 'Launcher.ps1', 'Receiver.vbs', '산불감시.cmd']:
    shutil.copyfile(ROOT / 'scripts/unified' / name, output / name)
(output / '사용방법.txt').write_text((ROOT / 'docs/unified-receiver.md').read_text(), encoding='utf-8-sig')
print('One installer/update artifact: Fire-Monitor-Setup. Extract once and run Setup.cmd.')
