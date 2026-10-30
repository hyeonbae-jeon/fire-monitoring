using System.Text.Json;

namespace SsmConnectionTest;

public sealed record ConfiguredLocalDomain(string source, string? uuid, string? version,
    bool? sslUse, string[] issues);

public sealed record LocalDomainRoutingEvidence(string cameraUuid, ConfiguredLocalDomain localDomain,
    ConfiguredRoutingEvidence routing, bool? serverDomainMatchesLocal, bool? currentDomainMatchesLocal,
    bool? componentDomainMatchesLocal, bool? serverVersionMatchesLocal,
    bool? configuredLocalRoutingConsistent, string? loginDomainCandidateUuid,
    bool liveControlValidated = false);

// GET_DOMAIN -> converterManagementServer -> DEFAULT_MGMT_UID is a separate
// verified path. Do not infer the local login domain from server.domainGuid.
public static class LocalDomainDetails
{
    public static LocalDomainRoutingEvidence Read(JsonElement row, CameraConnectionDetail selected)
    {
        if (row.ValueKind != JsonValueKind.Object) throw new DiagnosticException("LOCAL_DOMAIN_ROW_INVALID");
        var issues = new List<string>();
        JsonElement? Field(string key) => row.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;
        string? uuid = null, version = null;
        bool? sslUse = null;
        if (Field("guid") is { } guid)
        {
            if (guid.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(guid.GetString())) { }
            else if (guid.ValueKind == JsonValueKind.String && Guid.TryParse(guid.GetString(), out var id) && id != Guid.Empty)
                uuid = id.ToString("D");
            else issues.Add("GUID_UUID_INVALID");
        }
        if (Field("version") is { } v)
        {
            if (v.ValueKind == JsonValueKind.String)
            {
                string text = v.GetString()!.Trim();
                if (text.Length == 0) { }
                else if (text.Length <= 64 && char.IsAsciiDigit(text[0]) && text.All(c => char.IsAsciiDigit(c) || c is '.' or '_' or '-'))
                    version = text;
                else issues.Add("VERSION_INVALID");
            }
            else issues.Add("VERSION_INVALID");
        }
        if (Field("sslUse") is { } ssl)
        {
            if (ssl.ValueKind is JsonValueKind.True or JsonValueKind.False) sslUse = ssl.GetBoolean();
            else issues.Add("SSLUSE_BOOLEAN_INVALID");
        }
        var local = new ConfiguredLocalDomain("GET /V1/Domain?type=local", uuid, version, sslUse, issues.ToArray());
        var r = selected.routing;
        static bool? Same(string? left, string? right) => left is null || right is null ? null : left == right;
        bool? serverMatch = Same(r.server.domainUuid, uuid);
        bool? currentMatch = Same(r.server.currentDomainUuid, uuid);
        bool? componentMatch = Same(r.component.domainUuid, uuid);
        bool? versionMatch = Same(r.server.serverVersion, version);
        // These configured checks never prove CONTROL authentication, TLS or PTZ.
        bool? gateway = r.server.type is null || r.mediaGatewayCandidateUuid is null ? null :
            Guid.TryParse(r.mediaGatewayCandidateUuid, out var gatewayId) && gatewayId != Guid.Empty;
        if (r.server.type is { } type && type != 4097) gateway = false;
        bool?[] checks = [r.cameraComponentMatches, r.componentServerMatches, gateway,
            serverMatch, currentMatch, componentMatch, versionMatch];
        bool? consistent = checks.Any(c => c == false) ? false : checks.All(c => c == true) ? true : null;
        return new(selected.uuid, local, r, serverMatch, currentMatch, componentMatch, versionMatch,
            consistent, consistent == true ? uuid : null);
    }
}
