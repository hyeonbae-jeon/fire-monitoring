using System.Security.Cryptography;
using System.Text.Json;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public sealed class MapConfiguration(IConfiguration config)
{
    private string ConfigPath
    {
        get
        {
            if (string.IsNullOrWhiteSpace(config["MAP_CONFIG_FILE"]))
                throw new InventoryException(503, "Configure MAP_CONFIG_FILE to enable central map storage.");
            try
            {
                var path = Path.GetFullPath(config["MAP_CONFIG_FILE"]!);
                foreach (var key in new[] { "INVENTORY_FILE", "CAMERA_CONFIG_FILE" })
                    if (!string.IsNullOrWhiteSpace(config[key]) && string.Equals(path, Path.GetFullPath(config[key]!),
                        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                        throw new InventoryException(503, "Map, inventory and camera configuration must use separate files.");
                return path;
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException)
            { throw new InventoryException(503, "MAP_CONFIG_FILE is not a valid path."); }
        }
    }

    private static bool Range(double value, double low, double high) => double.IsFinite(value) && value >= low && value <= high;
    public static void Validate(MapDocument doc)
    {
        if (doc is null || doc.SchemaVersion != 1 || doc.Crs != "EPSG:4326" || doc.Positions is null || doc.Positions.Count > 1000)
            throw new JsonException();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var uuids = new HashSet<Guid>();
        foreach (var p in doc.Positions)
        {
            if (p is null || string.IsNullOrWhiteSpace(p.Id) || p.Id.Length > 100 || !ids.Add(p.Id) ||
                string.IsNullOrWhiteSpace(p.Name) || p.Name.Length > 200 || !Range(p.Lat, -90, 90) || !Range(p.Lon, -180, 180) ||
                p.PositionSource is not ("synthetic" or "operator") ||
                p.SsmUuid is { } uuid && (uuid == Guid.Empty || !uuids.Add(uuid))) throw new JsonException();
            if (p.Orientation is not { } o) continue;
            if (p.PositionSource != "operator" || o.Source != "manual-calibration" || o.Status is not ("estimate" or "stale") ||
                o.Confidence != "unvalidated" || !Range(o.HeadingDeg, 0, 359.999999) || !Range(o.PitchDeg, -80, 80) ||
                !Range(o.HorizontalFovDeg, 5, 120) || !Range(o.CameraHeightM, .5, 100) || !Range(o.GroundElevationM, -500, 9000) ||
                o.GroundElevationSource is not ("map-terrain" or "operator") ||
                o.PositionAtCalibration is null || o.PositionAtCalibration.Lat != p.Lat || o.PositionAtCalibration.Lon != p.Lon ||
                o.CalibratedAt == default || o.Reference is null || o.Reference.CapturedAt == default ||
                o.Reference.Sha256 is null || o.Reference.Sha256.Length != 64 || !o.Reference.Sha256.All(Uri.IsHexDigit) ||
                o.Reference.Width < 1 || o.Reference.Height < 1 || (long)o.Reference.Width * o.Reference.Height > 36_000_000 ||
                o.Landmarks is null || o.Landmarks.Count is < 2 or > 20) throw new JsonException();
            var points = new HashSet<(double, double)>();
            foreach (var point in o.Landmarks)
                if (point is null || string.IsNullOrWhiteSpace(point.Label) || point.Label.Length > 100 ||
                    !Range(point.X, 0, 1) || !Range(point.Y, 0, 1) || !points.Add((point.X, point.Y)) ||
                    point.MapPoint is { } map && (!Range(map.Lat, -90, 90) || !Range(map.Lon, -180, 180) ||
                        !Range(map.HeightM, -500, 9000) || map.Source != "map-surface")) throw new JsonException();
            if (o.GeographicFit is { } fit && (fit.Method != "geographic-control-points-v1" ||
                !Range(fit.FitRmsPx, 0, 5) || !Range(fit.ValidationRmsPx, 0, 10) || !Range(fit.MaxErrorPx, 0, 15) ||
                !Range(fit.ConditionNumber, 1, 1000) ||
                o.Landmarks.Count(m => m.MapPoint is not null && m.UseForValidation != true) < 3 ||
                !o.Landmarks.Any(m => m.MapPoint is not null && m.UseForValidation == true))) throw new JsonException();
            if (o.GeographicFit is not null && !MatchesGeographicEvidence(o)) throw new JsonException();
        }
    }

    private static bool MatchesGeographicEvidence(ManualOrientation o)
    {
        const double rad = Math.PI / 180;
        static (double X, double Y, double Z) Ecef(double lat, double lon, double height)
        {
            lat *= Math.PI / 180; lon *= Math.PI / 180;
            var n = 6378137 / Math.Sqrt(1 - .0066943799901413165 * Math.Pow(Math.Sin(lat), 2));
            return ((n + height) * Math.Cos(lat) * Math.Cos(lon), (n + height) * Math.Cos(lat) * Math.Sin(lon),
                (n * (1 - .0066943799901413165) + height) * Math.Sin(lat));
        }
        var lat = o.PositionAtCalibration.Lat * rad; var lon = o.PositionAtCalibration.Lon * rad;
        var eye = Ecef(o.PositionAtCalibration.Lat, o.PositionAtCalibration.Lon, o.GroundElevationM + o.CameraHeightM);
        var heading = o.HeadingDeg * rad; var pitch = o.PitchDeg * rad;
        double fitSum = 0, validationSum = 0, max = 0; int fitCount = 0, validationCount = 0;
        foreach (var m in o.Landmarks.Where(m => m.MapPoint is not null))
        {
            var point = m.MapPoint!; var p = Ecef(point.Lat, point.Lon, point.HeightM);
            var x = p.X - eye.X; var y = p.Y - eye.Y; var z = p.Z - eye.Z;
            var east = -Math.Sin(lon) * x + Math.Cos(lon) * y;
            var north = -Math.Sin(lat) * Math.Cos(lon) * x - Math.Sin(lat) * Math.Sin(lon) * y + Math.Cos(lat) * z;
            var up = Math.Cos(lat) * Math.Cos(lon) * x + Math.Cos(lat) * Math.Sin(lon) * y + Math.Sin(lat) * z;
            var forward = east * Math.Sin(heading) * Math.Cos(pitch) + north * Math.Cos(heading) * Math.Cos(pitch) + up * Math.Sin(pitch);
            if (forward <= Math.Sqrt(east * east + north * north + up * up) * .01) return false;
            var right = east * Math.Cos(heading) - north * Math.Sin(heading);
            var vertical = -east * Math.Sin(heading) * Math.Sin(pitch) - north * Math.Cos(heading) * Math.Sin(pitch) + up * Math.Cos(pitch);
            var tangent = Math.Tan(o.HorizontalFovDeg * rad / 2);
            var px = (.5 + right / (2 * forward * tangent) - m.X) * o.Reference.Width;
            var py = (.5 - vertical * o.Reference.Width / o.Reference.Height / (2 * forward * tangent) - m.Y) * o.Reference.Height;
            var squared = px * px + py * py;
            if (!double.IsFinite(squared)) return false;
            max = Math.Max(max, Math.Sqrt(squared));
            if (m.UseForValidation == true) { validationSum += squared; validationCount++; }
            else { fitSum += squared; fitCount++; }
        }
        var f = o.GeographicFit!;
        return fitCount >= 3 && validationCount >= 1 && Math.Abs(Math.Sqrt(fitSum / fitCount) - f.FitRmsPx) <= .1 &&
            Math.Abs(Math.Sqrt(validationSum / validationCount) - f.ValidationRmsPx) <= .1 && Math.Abs(max - f.MaxErrorPx) <= .1;
    }

    public async Task<MapSnapshot> ReadAsync(CancellationToken ct)
    {
        var path = ConfigPath;
        try
        {
            var bytes = await FileCameraInventorySource.ReadLimitedAsync(path, ct);
            if (bytes.Length > 1024 * 1024) throw new JsonException();
            var doc = JsonSerializer.Deserialize<MapDocument>(bytes, FileCameraInventorySource.Json) ?? throw new JsonException();
            Validate(doc);
            return new(Convert.ToHexString(SHA256.HashData(bytes)), doc);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        { return new("none", new(1, "EPSG:4326", [])); }
        catch (JsonException)
        { throw new InventoryException(422, "Stored map configuration is invalid; refusing to overwrite it."); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { throw new InventoryException(503, "Cannot read map configuration. Check Bridge permissions."); }
    }

    public async Task<MapSnapshot> SaveAsync(MapSaveRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.ConfigurationRevision)) throw new InventoryException(400, "Supply configurationRevision.");
        try { Validate(request.Configuration); }
        catch (JsonException) { throw new InventoryException(422, "Invalid map positions or manual calibration evidence."); }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(request.Configuration, FileCameraInventorySource.Json);
        if (bytes.Length > 1024 * 1024) throw new InventoryException(422, "Map configuration exceeds 1 MiB.");
        await FileCameraInventorySource.MutationGate.WaitAsync(ct);
        string? temporary = null;
        try
        {
            var path = ConfigPath;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var fileLock = new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if ((await ReadAsync(ct)).Revision != request.ConfigurationRevision)
                throw new InventoryException(409, "Map configuration changed. Reload before saving.");
            temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            await using (var output = new FileStream(temporary, options))
            { await output.WriteAsync(bytes, ct); await output.FlushAsync(ct); output.Flush(flushToDisk: true); }
            File.Move(temporary, path, overwrite: true);
            temporary = null;
            return new(Convert.ToHexString(SHA256.HashData(bytes)), request.Configuration);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { throw new InventoryException(503, "Cannot save map configuration; previous file retained."); }
        finally
        {
            try { if (temporary is not null) File.Delete(temporary); }
            finally { FileCameraInventorySource.MutationGate.Release(); }
        }
    }
}
