using System.Text;
using System.Security.Cryptography;
using WisenetPtzBridge.Services;

var password = "synthetic-monitor-password";
var hash = MonitoringServerSecurity.HashPassword(password);
if (!MonitoringServerSecurity.ValidHash(hash) || !MonitoringServerSecurity.VerifyPassword(password, hash) ||
    MonitoringServerSecurity.VerifyPassword("incorrect-password", hash) ||
    MonitoringServerSecurity.ValidHash("pbkdf2-sha256$600000$bad$bad") ||
    MonitoringServerSecurity.VerifyPassword(password, "pbkdf2-sha256$600000$bad$bad")) throw new Exception("Login hash validation failed.");
if (OperatingSystem.IsWindows())
{
    var plain = Encoding.UTF8.GetBytes("synthetic-camera-secret-do-not-publish");
    var encrypted = MonitoringServerSetup.Protect(plain, true);
    if (encrypted.AsSpan().IndexOf(plain) >= 0 || !MonitoringServerSetup.Protect(encrypted, false).SequenceEqual(plain))
        throw new Exception("Windows current-user protection failed.");
    encrypted[0] ^= 255;
    try { MonitoringServerSetup.Protect(encrypted, false); throw new Exception("Corrupt protected settings accepted."); }
    catch (CryptographicException) { }
    Console.WriteLine("Windows DPAPI round trip, tamper rejection and login password checks passed.");
}
else Console.WriteLine("Login password checks passed; Windows DPAPI checks run on Windows CI.");
