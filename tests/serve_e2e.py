"""Serve the built web app and real Bridge with isolated SYNTHETIC data only."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'bridge/WisenetPtzBridge'
dotnet = os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
if not dotnet:
    raise RuntimeError('Set DOTNET_EXECUTABLE or put dotnet on PATH.')
if not (PROJECT / 'wwwroot/index.html').exists():
    raise RuntimeError('Build web into bridge/WisenetPtzBridge/wwwroot first.')

with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    (work / 'inventory.json').write_text((ROOT / 'config/inventory.example.json').read_text())
    env = os.environ.copy()
    env.update(INVENTORY_FILE=str(work / 'inventory.json'), CAMERA_CONFIG_FILE=str(work / 'cameras.json'), MAP_CONFIG_FILE=str(work / 'map.json'),
               INVENTORY_WRITE_KEY='synthetic-e2e-config-key', ASPNETCORE_URLS='http://127.0.0.1:5081',
               ASPNETCORE_ENVIRONMENT='Production')
    process = subprocess.Popen([dotnet, str(PROJECT / 'bin/Release/net8.0/WisenetPtzBridge.dll')], cwd=PROJECT, env=env)
    def stop(signum, frame):
        process.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        code = process.wait()
        if code not in (0, -signal.SIGTERM): raise SystemExit(code)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
