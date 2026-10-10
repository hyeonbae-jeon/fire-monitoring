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
                    !Range(point.X, 0, 1) || !Range(point.Y, 0, 1) || !points.Add((point.X, point.Y))) throw new JsonException();
        }
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
