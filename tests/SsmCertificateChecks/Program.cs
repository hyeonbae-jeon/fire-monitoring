using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using SsmConnectionTest;

using var rsa = RSA.Create(2048);
var request = new CertificateRequest("CN=synthetic", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
var now = DateTimeOffset.UtcNow;
using var expired = request.CreateSelfSigned(now.AddDays(-2), now.AddDays(-1));
using var future = request.CreateSelfSigned(now.AddDays(1), now.AddDays(2));
using var valid = request.CreateSelfSigned(now.AddDays(-1), now.AddDays(1));
var errors = SslPolicyErrors.RemoteCertificateChainErrors | SslPolicyErrors.RemoteCertificateNameMismatch;
void Reject(X509Certificate2 certificate, DateTimeOffset time)
{
    if (SsmClient.CertificateMatches(certificate, errors, certificate.GetCertHash(HashAlgorithmName.SHA256), time))
        throw new Exception("Unusable certificate accepted despite matching fingerprint.");
}
Reject(expired, now);
Reject(future, now);
if (SsmClient.CertificateMatches(valid, SslPolicyErrors.RemoteCertificateNotAvailable, valid.GetCertHash(HashAlgorithmName.SHA256), now))
    throw new Exception("Unavailable certificate accepted.");
if (!SsmClient.CertificateMatches(valid, errors, valid.GetCertHash(HashAlgorithmName.SHA256), now))
    throw new Exception("Explicit valid pin rejected.");
Console.WriteLine("Certificate checks passed: expired, future, unavailable rejected; explicit valid pin accepted (4).");
