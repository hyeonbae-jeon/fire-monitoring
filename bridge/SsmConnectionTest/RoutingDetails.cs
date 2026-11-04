using System.Text.Json;

namespace SsmConnectionTest;

public sealed record ConfiguredRoutingRow(string source, string? uuid, string? parentUuid, long? type,
    string? domainUuid, string? currentDomainUuid, string? serverUuid, string? componentUuid,
    string? siteUuid, string? serverVersion, bool? useDdns, bool? useSSL, string[] issues);

public sealed record ConfiguredRoutingEvidence(ConfiguredRoutingRow camera, ConfiguredRoutingRow component,
    ConfiguredRoutingRow server, string? mediaGatewayCandidateUuid, bool? cameraComponentMatches,
    bool? componentServerMatches, bool liveControlValidated = false);

// Verified Stub fields only. Keep query ancestry separate from explicit references.
// A Recorder/component UUID must never replace the MediaGateway/server UUID.
public static class RoutingDetails
{
    public static ConfiguredRoutingEvidence Read(JsonElement camera, JsonElement component, JsonElement server)
    {
        var c = Row(camera, "channel");
        var r = Row(component, "component");
        var s = Row(server, "server");
        static bool? Same(string? left, string? right) => left is null || right is null ? null : left == right;
        // CHANNEL_TYPE.MEDIA_GATEWAY=4097 and ObjConverter.convert(ServerStubModel).
        // This identifies a configured candidate, not an authenticated/live route.
        return new(c, r, s, s.type == 4097 ? s.uuid : null,
            Same(c.componentUuid, r.uuid), Same(r.serverUuid, s.uuid));
    }

    private static ConfiguredRoutingRow Row(JsonElement row, string source)
    {
        var issues = new List<string>();
        JsonElement? Field(string key) => row.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;
        string? Uuid(string key)
        {
            var value = Field(key);
            if (value is null) return null;
            if (value.Value.ValueKind == JsonValueKind.String)
            {
                string text = value.Value.GetString()!.Trim();
                if (text.Length == 0) return null;
                if (Guid.TryParse(text, out var id)) return id.ToString("D");
            }
            issues.Add(key.ToUpperInvariant() + "_UUID_INVALID"); return null;
        }
        long? Type()
        {
            var value = Field("type");
            if (value is null) return null;
            if (value.Value.ValueKind == JsonValueKind.Number && value.Value.TryGetInt64(out long number) && number >= 0) return number;
            issues.Add("TYPE_INVALID"); return null;
        }
        bool? Boolean(string key)
        {
            var value = Field(key);
            if (value is null) return null;
            if (value.Value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.Value.GetBoolean();
            issues.Add(key.ToUpperInvariant() + "_BOOLEAN_INVALID"); return null;
        }
        string? Version()
        {
            var value = Field("serverVersion");
            if (value is null) return null;
            if (value.Value.ValueKind == JsonValueKind.String)
            {
                string text = value.Value.GetString()!.Trim();
                if (text.Length == 0) return null;
                if (text.Length <= 64 && char.IsAsciiDigit(text[0]) && text.All(c => char.IsAsciiDigit(c) || c is '.' or '_' or '-')) return text;
            }
            issues.Add("SERVERVERSION_INVALID"); return null;
        }
        return new(source, Uuid("guid"), Uuid("parentGuid"), Type(),
            source != "channel" ? Uuid("domainGuid") : null,
            source != "channel" ? Uuid("currentDomainGuid") : null,
            source != "channel" ? Uuid("serverGuid") : null,
            source == "channel" ? Uuid("componentGuid") : null,
            source == "channel" ? Uuid("siteGuid") : null,
            source == "server" ? Version() : null,
            source == "server" ? Boolean("useDdns") : null,
            source == "server" ? Boolean("useSSL") : null, issues.ToArray());
    }
}
