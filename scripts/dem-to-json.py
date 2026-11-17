#!/usr/bin/env python3
"""Convert a local metre-elevation GeoTIFF to WGS84 DEM node JSON.

Requires: python -m pip install rasterio numpy
This does not download terrain. Use a cropped, licensed DEM covering all sight lines.
"""
import argparse
import json
import math
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", required=True, help="DEM provider, date, resolution and vertical datum")
    parser.add_argument("--size", type=int, default=128, help="Output node count per axis, 2..256")
    parser.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    args = parser.parse_args()
    if not 2 <= args.size <= 256:
        parser.error("--size must be 2..256")
    try:
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from rasterio.warp import reproject, Resampling, transform_bounds
    except ImportError:
        parser.error("Install dependencies first: python -m pip install rasterio numpy")

    with rasterio.open(args.input) as src:
        if src.crs is None:
            parser.error("Input DEM must declare its coordinate reference system")
        west, south, east, north = args.bounds or transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
        if not all(math.isfinite(v) for v in (west,south,east,north)) or not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
            parser.error("Invalid WGS84 bounds")
        if east-west > 1 or north-south > 1:
            parser.error("Choose regional --bounds no wider/higher than 1 degree")
        dx, dy = (east-west)/(args.size-1), (north-south)/(args.size-1)
        # Node endpoints are exactly the declared bounds; raster pixels are centred on nodes.
        transform = from_origin(west-dx/2, north+dy/2, dx, dy)
        data = src.read(1, masked=True).astype("float32").filled(np.nan)
        data = data * src.scales[0] + src.offsets[0]
        result = np.full((args.size,args.size), np.nan, dtype="float32")
        reproject(data, result, src_transform=src.transform, src_crs=src.crs,
                  src_nodata=np.nan, dst_transform=transform, dst_crs="EPSG:4326",
                  dst_nodata=np.nan, resampling=Resampling.bilinear)
        finite = result[np.isfinite(result)]
        if not finite.size:
            parser.error("No terrain data in requested bounds")
        if float(finite.min()) < -500 or float(finite.max()) > 9000:
            parser.error("Elevations must be metres in -500..9000. Check units and scale/offset")
        elevations = [[round(float(v),3) if math.isfinite(float(v)) else None for v in row] for row in result]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(source=args.source,west=west,south=south,east=east,north=north,elevations=elevations),ensure_ascii=False,allow_nan=False)+"\n",encoding="utf-8")
    print(f"Wrote {args.size}x{args.size} nodes to {args.output}; no-data nodes remain null.")


if __name__ == "__main__":
    main()
