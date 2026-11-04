using System.Globalization;
using System.Text.Json.Serialization;

namespace WisenetPtzBridge.Models;

// Bridge-owned import contract, NOT a discovered SSM response schema.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record InventoryDocument(int SchemaVersion, bool Complete, int TotalCount,
    DateTimeOffset CapturedAt, string Provenance, List<InventoryCamera> Cameras);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record InventoryCamera(Guid Uuid, string Name, string? Channel, string? Device, string? PtzCap,
    string? Model = null, bool? ReportedPtzSupported = null)
{
    // uint64 masks cross the JSON boundary as decimal strings, never JS numbers.
    [JsonIgnore] public ulong? Capability => PtzCap is null ? null : ulong.Parse(PtzCap, CultureInfo.InvariantCulture);
    public bool? GetPosNormalize => Capability is { } cap ? (cap & 268435456UL) != 0 : null;
    public bool? AbsoluteZoom => Capability is { } cap ? (cap & 17179869184UL) != 0 : null;
}

public sealed record InventorySnapshot(string Version, string Source, bool LiveSsmConnected,
    string Coverage, DateTimeOffset CapturedAt, string Provenance, int TotalCount,
    IReadOnlyList<InventoryCamera> Cameras);
public sealed record SelectionRequest(List<Guid> CameraUuids, string ConfigurationRevision, string InventoryVersion);
public sealed class InventoryException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed record InventoryImportRequest(InventoryDocument Document, string? InventoryVersion);
