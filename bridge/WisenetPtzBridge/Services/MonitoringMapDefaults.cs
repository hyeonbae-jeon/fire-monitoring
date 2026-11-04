using System.Text.Json;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public static class MonitoringMapDefaults
{
    public static string ReadText()
    {
        using var stream = typeof(MonitoringMapDefaults).Assembly.GetManifestResourceStream("WisenetPtzBridge.MonitoringMapDefaults.json")
            ?? throw new InvalidOperationException("프로그램 기본 지도 설정을 찾지 못했습니다.");
        using var reader = new StreamReader(stream);
        var text = reader.ReadToEnd();
        var map = JsonSerializer.Deserialize<MapDocument>(text, FileCameraInventorySource.Json) ?? throw new JsonException();
        MapConfiguration.Validate(map);
        if (map.Positions.Count != 9 || map.Positions.Any(p => p.NativeTracking is null)) throw new JsonException();
        return text;
    }
}
