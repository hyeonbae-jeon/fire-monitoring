using System.Net;
using System.Text.Json;

namespace SsmConnectionTest;

public sealed record ConfiguredAddresses(string? tcp, string? wan, string? http, string? https, string? rtsp);
public sealed record ConfiguredPorts(int? tcpPort, int? wanPort, int? httpPort, int? httpsPort, int? rtspPort);
public sealed record ConfiguredConnection(string source, bool networkInfoPresent, long? addressType,
    long? devProtocolType, long? medProtocolType, ConfiguredAddresses addresses, ConfiguredPorts ports,
    int? serverPort, int? serverSslPort, string[] issues);
public sealed record CameraConnectionDetail(string uuid, string name, string serverUuid, string componentUuid,
    ConfiguredConnection camera, ConfiguredConnection component, ConfiguredConnection server,
    ConfiguredRoutingEvidence routing);

// Read only the verified networkInfo fields. No ID/password, DDNS password, token,
// raw objects or guessed service URLs are persisted. These are configured values, not tested routes.
public static class ConnectionDetails
{
    public static ConfiguredConnection Read(JsonElement row, string source, bool isServer = false)
    {
        var issues = new List<string>();
        JsonElement? Object(JsonElement parent, string key)
        {
            if (!parent.TryGetProperty(key, out var obj) || obj.ValueKind == JsonValueKind.Null) return null;
            if (obj.ValueKind != JsonValueKind.Object) { issues.Add(key.ToUpperInvariant() + "_INVALID"); return null; }
            return obj;
        }
        long? Integer(JsonElement? parent, string key)
        {
            if (parent is null || !parent.Value.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out long number) || number < 0)
            { issues.Add(key.ToUpperInvariant() + "_INVALID"); return null; }
            return number;
        }
        int? Port(JsonElement? parent, string key)
        {
            long? number = Integer(parent, key);
            if (number is null or 0) return null;
            if (number > 65535) { issues.Add(key.ToUpperInvariant() + "_INVALID"); return null; }
            return (int)number.Value;
        }
        string? Address(JsonElement? parent, string key)
        {
            if (parent is null || !parent.Value.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
            if (value.ValueKind == JsonValueKind.String)
            {
                string raw = value.GetString()!.Trim();
                if (raw.Length == 0) return null;
                // Host/IP only: discard credential-bearing URLs, paths, queries and fragments.
                if (raw.Length <= 253 && !raw.Any(char.IsWhiteSpace) &&
                    (IPAddress.TryParse(raw, out _) || Uri.CheckHostName(raw) == UriHostNameType.Dns)) return raw;
            }
            issues.Add(key.ToUpperInvariant() + "_ADDRESS_INVALID"); return null;
        }
        var network = Object(row, "networkInfo");
        var addresses = network is null ? null : Object(network.Value, "addressList");
        var ports = network is null ? null : Object(network.Value, "portList");
        return new(source, network is not null, Integer(network, "addressType"), Integer(network, "devProtocolType"),
            Integer(network, "medProtocolType"),
            new(Address(addresses, "tcp"), Address(addresses, "wan"), Address(addresses, "http"), Address(addresses, "https"), Address(addresses, "rtsp")),
            new(Port(ports, "tcpPort"), Port(ports, "wanPort"), Port(ports, "httpPort"), Port(ports, "httpsPort"), Port(ports, "rtspPort")),
            isServer ? Port(row, "serverPort") : null, isServer ? Port(row, "serverSslPort") : null, issues.ToArray());
    }
}
