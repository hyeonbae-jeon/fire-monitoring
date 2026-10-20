using System.Text.Json.Serialization;

namespace WisenetPtzBridge.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MapDocument([property: JsonRequired] int SchemaVersion,
    [property: JsonRequired] string Crs, [property: JsonRequired] List<MapPosition> Positions);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MapPosition([property: JsonRequired] string Id, [property: JsonRequired] string Name,
    [property: JsonRequired] double Lat, [property: JsonRequired] double Lon,
    [property: JsonRequired] Guid? SsmUuid, [property: JsonRequired] string PositionSource,
    [property: JsonRequired] ManualOrientation? Orientation);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CalibrationPosition([property: JsonRequired] double Lat, [property: JsonRequired] double Lon);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CalibrationReference([property: JsonRequired] string Sha256,
    [property: JsonRequired] DateTimeOffset CapturedAt, [property: JsonRequired] int Width,
    [property: JsonRequired] int Height);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CalibrationLandmark([property: JsonRequired] string Label,
    [property: JsonRequired] double X, [property: JsonRequired] double Y,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] MapControlPoint? MapPoint = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? UseForValidation = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MapControlPoint([property: JsonRequired] double Lat, [property: JsonRequired] double Lon,
    [property: JsonRequired] double HeightM, [property: JsonRequired] string Source);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record GeographicFit([property: JsonRequired] string Method,
    [property: JsonRequired] double FitRmsPx, [property: JsonRequired] double ValidationRmsPx,
    [property: JsonRequired] double MaxErrorPx, [property: JsonRequired] double ConditionNumber);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ManualOrientation([property: JsonRequired] string Source,
    [property: JsonRequired] string Status, [property: JsonRequired] string Confidence,
    [property: JsonRequired] double HeadingDeg, [property: JsonRequired] double PitchDeg,
    [property: JsonRequired] double HorizontalFovDeg, [property: JsonRequired] double CameraHeightM,
    [property: JsonRequired] double GroundElevationM, [property: JsonRequired] string GroundElevationSource,
    [property: JsonRequired] CalibrationPosition PositionAtCalibration,
    [property: JsonRequired] DateTimeOffset CalibratedAt,
    [property: JsonRequired] CalibrationReference Reference,
    [property: JsonRequired] List<CalibrationLandmark> Landmarks,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] GeographicFit? GeographicFit = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MapSaveRequest([property: JsonRequired] string ConfigurationRevision,
    [property: JsonRequired] MapDocument Configuration);

public sealed record MapSnapshot(string Revision, MapDocument Configuration);
