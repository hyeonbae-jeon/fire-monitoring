#!/usr/bin/env python3
"""Reproject local GPKG data with GDAL; emit a browser-only map bundle."""
import argparse
import datetime
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile


def convert(path, expected_geometry, kind, name_column, date, temporary):
    # Read only: the originals are never altered. Do not treat attributes as code.
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('SELECT table_name, geometry_type_name, srs_id FROM gpkg_geometry_columns').fetchall()
        if len(rows) != 1 or rows[0][1].upper() != expected_geometry:
            raise ValueError(f'{kind}: expected a single {expected_geometry} layer')
        table, _, srid = rows[0]
        crs = db.execute('SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id=?', (srid,)).fetchone()
        if not crs or crs[0].upper() != 'EPSG' or crs[1] != 5181:
            raise ValueError(f'{kind}: verify CRS before converting (expected EPSG:5181)')
    destination = temporary / (kind + '.geojson')
    subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-dim', 'XY',
                    '-lco', 'RFC7946=YES', '-lco', 'COORDINATE_PRECISION=7',
                    '-select', name_column, str(destination), str(path), table], check=True)
    geojson = json.loads(destination.read_text(encoding='utf-8'))
    features = []
    for i, feature in enumerate(geojson['features']):
        label = feature.get('properties', {}).get(name_column)
        features.append({'type': 'Feature', 'id': f'{kind}-{i+1}',
                         'properties': {'name': label if isinstance(label, str) and label.strip() else ('북한산 공원경계' if kind == 'boundary' else '북한산 탐방로')},
                         'geometry': feature['geometry']})
    return {'id': kind, 'name': '북한산 공원경계' if kind == 'boundary' else '북한산 탐방로',
            'kind': kind, 'sourceCrs': 'EPSG:5181', 'sourceDate': date,
            'geojson': {'type': 'FeatureCollection', 'features': features}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['boundary', 'trails', 'positions', 'output']:
        parser.add_argument('--' + flag, type=Path, required=True)
    parser.add_argument('--source-date', required=True, help='YYYY-MM-DD (confirmed date or date in supplied filename)')
    args = parser.parse_args()
    datetime.date.fromisoformat(args.source_date)
    original = json.loads(args.positions.read_text(encoding='utf-8'))
    if original.get('schemaVersion') != 1 or original.get('crs') != 'EPSG:4326':
        raise ValueError('Position coordinates must be verified EPSG:4326')
    positions = []
    for i, p in enumerate(original['positions']):
        if not isinstance(p['name'], str) or not p['name'].strip() or len(p['name']) > 200:
            raise ValueError('Missing or invalid camera name')
        if not all(isinstance(p[k], (float, int)) and not isinstance(p[k], bool) and math.isfinite(p[k]) and -limit <= p[k] <= limit for k, limit in [('lat', 90), ('lon', 180)]):
            raise ValueError('Invalid camera coordinate')
        if p.get('positionSource') != 'operator':
            raise ValueError('Expected operator-supplied installation positions')
        # Drop device UUIDs, network addresses and earlier orientation estimates.
        positions.append({'id': f'bukhansan-camera-{i+1}', 'name': p['name'],
                          'lat': p['lat'], 'lon': p['lon'], 'ssmUuid': None,
                          'positionSource': 'operator', 'orientation': None})
    with tempfile.TemporaryDirectory(prefix='cctv-map-') as folder:
        temporary = Path(folder)
        layers = [convert(args.boundary, 'MULTIPOLYGON', 'boundary', 'NLPRK_NM', args.source_date, temporary),
                  convert(args.trails, 'MULTILINESTRING', 'trails', 'SCTN_NM', args.source_date, temporary)]
    bundle = {'schemaVersion': 1, 'crs': 'EPSG:4326', 'positions': positions, 'layers': layers}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents silently replacing a user-maintained file.
    with args.output.open('x', encoding='utf-8') as output:
        os.chmod(args.output, 0o600)
        json.dump(bundle, output, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'positions': len(positions), 'boundaryFeatures': len(layers[0]['geojson']['features']),
                      'trailFeatures': len(layers[1]['geojson']['features']), 'outputBytes': args.output.stat().st_size}))


if __name__ == '__main__':
    main()
