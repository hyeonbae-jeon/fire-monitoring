using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public sealed record ConfigurationSnapshot(string Revision, JsonObject Configuration);

public sealed class CameraConfiguration(IConfiguration config, ICameraInventorySource inventory)
{
    private readonly SemaphoreSlim gate = FileCameraInventorySource.MutationGate;
    private string ConfigPath
    {
        get
        {
            var path = config["CAMERA_CONFIG_FILE"];
            if (string.IsNullOrWhiteSpace(path))
                throw new InventoryException(503, "CAMERA_CONFIG_FILE is not configured.");
            try { return Path.GetFullPath(path); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException)
            {
                throw new InventoryException(503, "CAMERA_CONFIG_FILE is not a valid path.");
            }
        }
    }

    public async Task<ConfigurationSnapshot> ReadAsync(CancellationToken ct)
    {
        var path = ConfigPath;
        try
        {
            var bytes = await FileCameraInventorySource.ReadLimitedAsync(path, ct);
            var doc = JsonNode.Parse(bytes) as JsonObject ?? throw new JsonException();
            _ = Index(doc);
            return new(Convert.ToHexString(SHA256.HashData(bytes)), doc);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return new("none", new JsonObject { ["cameras"] = new JsonArray() });
        }
        catch (JsonException)
        {
            throw new InventoryException(422, "Existing camera configuration is invalid; refusing to overwrite it.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new InventoryException(503, "Camera configuration cannot be read. Check Bridge account permissions.");
        }
    }

    private static Dictionary<Guid, JsonObject> Index(JsonObject doc)
    {
        if (doc["cameras"] is not JsonArray cameras) throw new JsonException();
        var indexed = new Dictionary<Guid, JsonObject>();
        foreach (var node in cameras)
        {
            if (node is not JsonObject obj || obj["uuid"] is not JsonValue id ||
                !id.TryGetValue<string>(out var text) || !Guid.TryParse(text, out var uuid) ||
                uuid == Guid.Empty || !indexed.TryAdd(uuid, obj)) throw new JsonException();
        }
        return indexed;
    }

    public async Task<ConfigurationSnapshot> SaveAsync(SelectionRequest request, CancellationToken ct)
    {
        if (request.CameraUuids is null || request.CameraUuids.Count != request.CameraUuids.Distinct().Count() ||
            request.CameraUuids.Contains(Guid.Empty) || string.IsNullOrEmpty(request.ConfigurationRevision) ||
            string.IsNullOrEmpty(request.InventoryVersion))
            throw new InventoryException(400, "Supply unique cameraUuids, configurationRevision and inventoryVersion.");
        await gate.WaitAsync(ct);
        string? temporary = null;
        try
        {
            var path = ConfigPath;
            if (string.Equals(path, Path.GetFullPath(config["INVENTORY_FILE"] ?? "inventory-unconfigured"),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                throw new InventoryException(503, "Inventory and camera configuration must use separate files.");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var fileLock = new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var current = await ReadAsync(ct);
            if (current.Revision != request.ConfigurationRevision)
                throw new InventoryException(409, "Configuration changed. Reload before saving.");
            var snapshot = await inventory.ReadAsync(ct);
            if (snapshot.Version != request.InventoryVersion)
                throw new InventoryException(409, "Inventory changed. Reload before saving.");
            var available = snapshot.Cameras.ToDictionary(c => c.Uuid);
            if (request.CameraUuids.Any(id => !available.ContainsKey(id)))
                throw new InventoryException(400, "A selected UUID is absent from the current inventory.");
            var existing = Index(current.Configuration);
            var selected = new JsonArray();
            foreach (var id in request.CameraUuids)
            {
                var observed = available[id];
                var camera = existing.TryGetValue(id, out var old) ? (JsonObject)old.DeepClone() : new JsonObject
                {
                    ["parkId"] = null, ["latitude"] = null, ["longitude"] = null,
                    ["groundElevationM"] = null, ["cameraHeightM"] = null,
                    ["headingOffsetDeg"] = null, ["tiltOffsetDeg"] = null
                };
                camera["uuid"] = id.ToString();
                camera["name"] = observed.Name;
                camera["channel"] = observed.Channel;
                camera["device"] = observed.Device;
                camera["ptzCap"] = observed.PtzCap;
                if (observed.Model is not null) camera["model"] = observed.Model;
                camera["reportedPtzSupported"] = observed.ReportedPtzSupported;
                camera["enabled"] = true;
                if (camera["ptz"] is not null && camera["ptz"] is not JsonObject)
                    throw new InventoryException(422, "Existing ptz metadata is invalid; refusing to overwrite it.");
                var ptz = camera["ptz"] as JsonObject ?? new JsonObject();
                ptz["getPosNormalize"] = observed.GetPosNormalize;
                ptz["absoluteZoom"] = observed.AbsoluteZoom;
                if (camera["ptz"] is null) camera["ptz"] = ptz;
                selected.Add(camera);
            }
            current.Configuration["cameras"] = selected;
            current.Configuration["inventoryVersion"] = snapshot.Version;
            current.Configuration["inventoryCapturedAt"] = snapshot.CapturedAt;
            current.Configuration["inventorySource"] = snapshot.Source;
            var bytes = JsonSerializer.SerializeToUtf8Bytes(current.Configuration, FileCameraInventorySource.Json);
            temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            await using (var output = new FileStream(temporary, options))
            {
                await output.WriteAsync(bytes, ct);
                await output.FlushAsync(ct);
                output.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
            temporary = null;
            return new(Convert.ToHexString(SHA256.HashData(bytes)), current.Configuration);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new InventoryException(503, "Cannot save configuration or another Bridge is writing. Previous configuration is retained; retry after checking permissions.");
        }
        finally
        {
            try { if (temporary is not null) File.Delete(temporary); }
            finally { gate.Release(); }
        }
    }
}
