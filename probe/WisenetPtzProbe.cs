using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using System.Linq;

class WisenetPtzProbe
{
    static string _user;
    static string _pass;

    static void Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine("Wisenet PTZ Probe - standalone C# / .NET Framework");
        Console.WriteLine("No PowerShell, no BAT, no external packages.\n");

        Console.Write("Device service URL (ex: http://192.168.0.10/onvif/device_service): ");
        string deviceUrl = (Console.ReadLine() ?? "").Trim();
        if (deviceUrl.Length == 0) return;

        Console.Write("Username: ");
        _user = (Console.ReadLine() ?? "").Trim();
        Console.Write("Password: ");
        _pass = ReadPassword();
        Console.WriteLine();

        ServicePointManager.Expect100Continue = false;

        try
        {
            Console.WriteLine("[1/3] GetCapabilities...");
            string capBody = "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>";
            string capXml = Soap(deviceUrl, "http://www.onvif.org/ver10/device/wsdl/GetCapabilities", capBody,
                "xmlns:tds=\"http://www.onvif.org/ver10/device/wsdl\"");
            XDocument capDoc = XDocument.Parse(capXml);

            string mediaUrl = FindXAddr(capDoc, "Media") ?? FindXAddr(capDoc, "Media2");
            string ptzUrl = FindXAddr(capDoc, "PTZ");

            Console.WriteLine("  Media XAddr: " + (mediaUrl ?? "NOT FOUND"));
            Console.WriteLine("  PTZ   XAddr: " + (ptzUrl ?? "NOT FOUND"));

            if (String.IsNullOrEmpty(mediaUrl))
                throw new Exception("Media XAddr not found in GetCapabilities response.");
            if (String.IsNullOrEmpty(ptzUrl))
                throw new Exception("PTZ XAddr not found. The selected NVR/camera may not expose PTZ via ONVIF.");

            Console.WriteLine("\n[2/3] GetProfiles...");
            string profilesXml = Soap(mediaUrl, "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
                "<trt:GetProfiles/>", "xmlns:trt=\"http://www.onvif.org/ver10/media/wsdl\"");
            XDocument profilesDoc = XDocument.Parse(profilesXml);

            XElement profile = profilesDoc.Descendants().FirstOrDefault(x =>
                x.Name.LocalName == "Profiles" && x.Descendants().Any(y => y.Name.LocalName == "PTZConfiguration"));
            if (profile == null)
                profile = profilesDoc.Descendants().FirstOrDefault(x => x.Name.LocalName == "Profiles");

            if (profile == null || profile.Attribute("token") == null)
                throw new Exception("No ONVIF media profile token found.");

            string token = profile.Attribute("token").Value;
            Console.WriteLine("  ProfileToken: " + token);
            Console.WriteLine("  PTZ config: " + (profile.Descendants().Any(y => y.Name.LocalName == "PTZConfiguration") ? "YES" : "NO/UNKNOWN"));

            Console.WriteLine("\n[3/3] GetStatus...");
            string statusBody = "<tptz:GetStatus><tptz:ProfileToken>" + XmlEscape(token) + "</tptz:ProfileToken></tptz:GetStatus>";
            string statusXml = Soap(ptzUrl, "http://www.onvif.org/ver20/ptz/wsdl/GetStatus", statusBody,
                "xmlns:tptz=\"http://www.onvif.org/ver20/ptz/wsdl\"");
            XDocument statusDoc = XDocument.Parse(statusXml);

            XElement panTilt = statusDoc.Descendants().FirstOrDefault(x => x.Name.LocalName == "PanTilt");
            XElement zoom = statusDoc.Descendants().FirstOrDefault(x => x.Name.LocalName == "Zoom");
            XElement moveStatus = statusDoc.Descendants().FirstOrDefault(x => x.Name.LocalName == "MoveStatus");

            Console.WriteLine("\n=== PTZ STATUS ===");
            if (panTilt != null)
            {
                Console.WriteLine("Pan  (x): " + Attr(panTilt, "x"));
                Console.WriteLine("Tilt (y): " + Attr(panTilt, "y"));
                Console.WriteLine("PanTilt space: " + Attr(panTilt, "space"));
            }
            else Console.WriteLine("Pan/Tilt: NOT PRESENT");

            if (zoom != null)
            {
                Console.WriteLine("Zoom (x): " + Attr(zoom, "x"));
                Console.WriteLine("Zoom space: " + Attr(zoom, "space"));
            }
            else Console.WriteLine("Zoom: NOT PRESENT");

            if (moveStatus != null)
                Console.WriteLine("MoveStatus: " + moveStatus.Value.Trim());

            Console.WriteLine("\nSUCCESS: ONVIF PTZ status was received.");
            Console.WriteLine("Note: ONVIF x/y/z may be normalized coordinates, not SSM degree values.");
        }
        catch (WebException ex)
        {
            Console.WriteLine("\nFAILED: " + ex.Message);
            if (ex.Response != null)
            {
                try
                {
                    Console.WriteLine("HTTP: " + ((HttpWebResponse)ex.Response).StatusCode);
                    using (var sr = new StreamReader(ex.Response.GetResponseStream()))
                    {
                        string s = sr.ReadToEnd();
                        Console.WriteLine(s.Length > 4000 ? s.Substring(0, 4000) : s);
                    }
                }
                catch { }
            }
            Console.WriteLine("\nCommon causes: wrong URL/port, ONVIF disabled, account lacks ONVIF permission, time mismatch, or NVR does not expose channel PTZ through this endpoint.");
        }
        catch (Exception ex)
        {
            Console.WriteLine("\nFAILED: " + ex.Message);
        }

        Console.WriteLine("\nPress Enter to close.");
        Console.ReadLine();
    }

    static string Soap(string url, string action, string body, string extraNs)
    {
        string security = BuildWsSecurity();
        string envelope =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
            "<s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\" " + extraNs +
            " xmlns:wsse=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\"" +
            " xmlns:wsu=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">" +
            "<s:Header>" + security + "</s:Header><s:Body>" + body + "</s:Body></s:Envelope>";

        byte[] data = Encoding.UTF8.GetBytes(envelope);
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.Timeout = 8000;
        req.ReadWriteTimeout = 8000;
        req.ContentType = "application/soap+xml; charset=utf-8; action=\"" + action + "\"";
        req.Accept = "application/soap+xml, application/xml, text/xml";
        req.ContentLength = data.Length;
        req.Credentials = new NetworkCredential(_user, _pass);
        req.PreAuthenticate = true;

        using (Stream st = req.GetRequestStream()) st.Write(data, 0, data.Length);
        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
        using (StreamReader sr = new StreamReader(resp.GetResponseStream()))
            return sr.ReadToEnd();
    }

    static string BuildWsSecurity()
    {
        byte[] nonce = new byte[16];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(nonce);
        string created = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

        byte[] createdBytes = Encoding.UTF8.GetBytes(created);
        byte[] passBytes = Encoding.UTF8.GetBytes(_pass ?? "");
        byte[] all = new byte[nonce.Length + createdBytes.Length + passBytes.Length];
        Buffer.BlockCopy(nonce, 0, all, 0, nonce.Length);
        Buffer.BlockCopy(createdBytes, 0, all, nonce.Length, createdBytes.Length);
        Buffer.BlockCopy(passBytes, 0, all, nonce.Length + createdBytes.Length, passBytes.Length);

        byte[] digest;
        using (SHA1 sha = SHA1.Create()) digest = sha.ComputeHash(all);

        return "<wsse:Security s:mustUnderstand=\"1\"><wsse:UsernameToken>" +
               "<wsse:Username>" + XmlEscape(_user) + "</wsse:Username>" +
               "<wsse:Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest\">" + Convert.ToBase64String(digest) + "</wsse:Password>" +
               "<wsse:Nonce EncodingType=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary\">" + Convert.ToBase64String(nonce) + "</wsse:Nonce>" +
               "<wsu:Created>" + created + "</wsu:Created></wsse:UsernameToken></wsse:Security>";
    }

    static string FindXAddr(XDocument doc, string capabilityName)
    {
        XElement node = doc.Descendants().FirstOrDefault(x => x.Name.LocalName == capabilityName);
        if (node == null) return null;
        XElement xaddr = node.Descendants().FirstOrDefault(x => x.Name.LocalName == "XAddr");
        return xaddr == null ? null : xaddr.Value.Trim();
    }

    static string Attr(XElement e, string name)
    {
        XAttribute a = e.Attribute(name);
        return a == null ? "" : a.Value;
    }

    static string XmlEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");
    }

    static string ReadPassword()
    {
        StringBuilder sb = new StringBuilder();
        while (true)
        {
            ConsoleKeyInfo key = Console.ReadKey(true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace)
            {
                if (sb.Length > 0) { sb.Length--; Console.Write("\b \b"); }
            }
            else if (!Char.IsControl(key.KeyChar))
            {
                sb.Append(key.KeyChar);
                Console.Write("*");
            }
        }
        return sb.ToString();
    }
}
