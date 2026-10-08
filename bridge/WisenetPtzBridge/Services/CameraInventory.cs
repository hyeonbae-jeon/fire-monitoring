using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public interface ICameraInventorySource
{
    Task<InventorySnapshot> ReadAsync(CancellationToken ct);
}

public sealed class FileCameraInventorySource(IConfiguration config) : ICameraInventorySource
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false, WriteIndented = true
    };

    public async Task<InventorySnapshot> ReadAsync(CancellationToken ct)
    {
        var path = config["INVENTORY_FILE"];
        if (string.IsNullOrWhiteSpace(path))
            throw new InventoryException(503, "INVENTORY_FILE is not configured. Live SSM inventory is not implemented; its interface remains UNKNOWN.");
        try
        {
            var bytes = await ReadLimitedAsync(path, ct);
            var doc = JsonSerializer.Deserialize<InventoryDocument>(bytes, Json) ?? throw new JsonException();
            if (doc.SchemaVersion != 1 || !doc.Complete || doc.Cameras is null ||
                doc.TotalCount != doc.Cameras.Count || doc.CapturedAt == default ||
                string.IsNullOrWhiteSpace(doc.Provenance)) throw new JsonException();
            var ids = new HashSet<Guid>();
            foreach (var camera in doc.Cameras)
            {
                if (camera is null || camera.Uuid == Guid.Empty || !ids.Add(camera.Uuid) ||
                    string.IsNullOrWhiteSpace(camera.Name)) throw new JsonException();
                if (camera.PtzCap is { } cap &&
                    (cap.Length == 0 || cap.Any(c => c < '0' || c > '9') ||
                     !ulong.TryParse(cap, NumberStyles.None, CultureInfo.InvariantCulture, out _)))
                    throw new JsonException();
            }
            return new(Convert.ToHexString(SHA256.HashData(bytes)), "file-import", false,
                "operator-declared-complete", doc.CapturedAt, doc.Provenance, doc.TotalCount, doc.Cameras);
        }
        catch (JsonException)
        {
            throw new InventoryException(422, "Invalid inventory: require schemaVersion=1, complete=true, matching totalCount, capturedAt, provenance, unique nonempty UUIDs, names, and nullable uint64 decimal-string ptzCap.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new InventoryException(503, "Inventory file cannot be read. Check the configured path and Bridge account permissions.");
        }
    }

    internal static async Task<byte[]> ReadLimitedAsync(string path, CancellationToken ct)
    {
        const int limit = 10 * 1024 * 1024;
        await using var stream = File.OpenRead(path);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + count > limit) throw new InventoryException(422, "JSON file exceeds 10 MiB.");
            buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }
}
