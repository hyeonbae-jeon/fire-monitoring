"""Synthetic local raster conversion checks; optional rasterio/numpy dependencies."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/dem-to-json.py"


@unittest.skipUnless(importlib.util.find_spec("rasterio") and importlib.util.find_spec("numpy"), "Requires rasterio and numpy")
class DemConverterTests(unittest.TestCase):
    def test_node_positions_nodata_scale_and_offset(self):
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "test.tif", root / "result.json"
            with rasterio.open(source, "w", driver="GTiff", width=3, height=3, count=1,
                               dtype="float32", crs="EPSG:4326", nodata=-9999,
                               transform=from_origin(126.995,37.025,.01,.01)) as dataset:
                dataset.write(np.array([[10,20,30],[40,-9999,60],[70,80,90]],dtype="float32"),1)
                dataset.scales = (2,)
                dataset.offsets = (5,)
            subprocess.run([sys.executable,str(SCRIPT),str(source),str(output),"--source","synthetic",
                            "--bounds","127","37","127.02","37.02","--size","3"], check=True,capture_output=True)
            doc = json.loads(output.read_text())
            self.assertEqual(doc["west"],127)
            self.assertEqual(doc["north"],37.02)
            self.assertEqual(doc["elevations"][0],[25,45,65])
            self.assertEqual(doc["elevations"][1][1],None)
            self.assertEqual(doc["elevations"][-1],[145,165,185])

    def test_projected_input_is_reprojected(self):
        import numpy as np
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.warp import transform_bounds
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "projected.tif", root / "result.json"
            bounds = transform_bounds("EPSG:4326","EPSG:3857",127,37,127.02,37.02)
            with rasterio.open(source,"w",driver="GTiff",width=10,height=10,count=1,dtype="float32",crs="EPSG:3857",
                               transform=from_bounds(*bounds,10,10)) as dataset:
                dataset.write(np.full((10,10),100,dtype="float32"),1)
            subprocess.run([sys.executable,str(SCRIPT),str(source),str(output),"--source","synthetic","--size","5"],check=True,capture_output=True)
            doc = json.loads(output.read_text())
            self.assertAlmostEqual(doc["west"],127)
            self.assertAlmostEqual(doc["north"],37.02)
            self.assertEqual(doc["elevations"][2][2],100)

    def test_bad_size_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "result.json"
            result = subprocess.run([sys.executable,str(SCRIPT),str(root/"unused.tif"),str(output),"--source","synthetic","--size","1000"],capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
