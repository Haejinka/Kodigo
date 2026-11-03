using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kodigo.PrintAgent;

if (args.Contains("--help", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine("Kodigo Print Agent");
    Console.WriteLine("  Kodigo-Print-Setup-win-x64.exe Install and start the agent for this Windows user.");
    Console.WriteLine("  --install               Install and start the agent for this Windows user.");
    Console.WriteLine("  --run                   Run the already-installed local API.");
    Console.WriteLine("  --pair                  Create a pairing token for this Windows account.");
    Console.WriteLine("  --rotate-pairing-token  Replace the current pairing token.");
    return;
}

if (args.Length == 0 || args.Contains("--install", StringComparer.OrdinalIgnoreCase))
{
    WindowsAgentInstaller.InstallAndOpenKodigo();
    return;
}

if (args.Contains("--pair", StringComparer.OrdinalIgnoreCase)
    || args.Contains("--rotate-pairing-token", StringComparer.OrdinalIgnoreCase))
{
    var rotate = args.Contains("--rotate-pairing-token", StringComparer.OrdinalIgnoreCase);
    if (!rotate && PairingTokenStore.Exists)
    {
        Console.Error.WriteLine("This computer already has a pairing token. Use --rotate-pairing-token to replace it.");
        Environment.ExitCode = 1;
        return;
    }

    Console.WriteLine(rotate
        ? "Pairing token (the previous token is now invalid):"
        : "Pairing token (copy it into Kodigo on this computer):");
    Console.WriteLine(PairingTokenStore.Create());
    Console.WriteLine("Keep this token private. It is saved only as a hash on this computer.");
    return;
}

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Kodigo Print Agent currently supports Windows POS computers only.");
    Environment.ExitCode = 1;
    return;
}

using var instanceMutex = new Mutex(initiallyOwned: true, name: "Local\\KodigoPrintAgent", createdNew: out var isFirstInstance);
if (!isFirstInstance)
{
    Console.WriteLine("Kodigo Print Agent is already running for this Windows session.");
    return;
}

var allowedOrigins = AgentConfiguration.GetAllowedOrigins();
var builder = WebApplication.CreateBuilder([]);
builder.WebHost.ConfigureKestrel(server =>
{
    server.Limits.MaxRequestBodySize = 128 * 1024;
    server.Listen(IPAddress.Loopback, AgentConfiguration.Port);
});
builder.Logging.ClearProviders();
builder.Logging.AddConsole();

var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";

    var origin = context.Request.Headers["Origin"].ToString();
    var isPairingRequest = string.Equals(context.Request.Path.Value, "/v1/pair", StringComparison.OrdinalIgnoreCase)
        && HttpMethods.IsPost(context.Request.Method);
    if (isPairingRequest && !AgentOriginPolicy.IsAllowed(origin, allowedOrigins))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ApiError("Pair this computer from the Kodigo website."));
        return;
    }

    if (!string.IsNullOrWhiteSpace(origin))
    {
        if (!AgentOriginPolicy.IsAllowed(origin, allowedOrigins))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new ApiError("This website is not allowed to use this computer's print agent."));
            return;
        }

        context.Response.Headers["Access-Control-Allow-Origin"] = origin;
        context.Response.Headers["Vary"] = "Origin";
        context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        context.Response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        context.Response.Headers["Access-Control-Max-Age"] = "600";
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    if (isPairingRequest)
    {
        await next();
        return;
    }

    if (!PairingTokenStore.IsValid(context.Request.Headers["Authorization"].ToString()))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new ApiError("Pair this computer with Kodigo before using its printers."));
        return;
    }

    await next();
});

app.MapGet("/v1/health", () => Results.Ok(new { ok = true, name = "Kodigo Print Agent", version = "1.0.0" }));

app.MapPost("/v1/pair", () => Results.Ok(new { token = PairingTokenStore.Create() }));

app.MapGet("/v1/printers", () =>
{
    try
    {
        return Results.Ok(new { printers = WindowsPrinter.GetInstalledPrinters() });
    }
    catch (Exception)
    {
        return Results.Problem("Windows could not list the printers installed on this computer.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapPost("/v1/receipts/print", async (HttpContext context) =>
{
    var request = await ReadJson<ReceiptPrintRequest>(context);
    if (request is null
        || string.IsNullOrWhiteSpace(request.PrinterName)
        || request.PrinterName.Length > 256
        || !Guid.TryParse(request.SaleId, out var saleId)
        || request.Receipt.ValueKind != JsonValueKind.Object
        || !ReceiptFormatter.MatchesSale(request.Receipt, saleId))
    {
        return Results.BadRequest(new ApiError("A valid printer, sale ID, and matching saved receipt are required."));
    }

    var printerName = request.PrinterName.Trim();
    byte[] receiptData;
    try
    {
        receiptData = ReceiptFormatter.Format(request.Receipt);
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new ApiError(exception.Message));
    }

    try
    {
        var printers = WindowsPrinter.GetInstalledPrinters();
        if (!printers.Contains(printerName, StringComparer.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiError("That printer is not installed on this computer. Find printers again and choose an installed printer."));
        }

        var alreadyAttempted = !request.Reprint && await ReceiptPrintLedger.TryClaimAsync(saleId);
        if (alreadyAttempted)
        {
            return Results.Ok(new { submitted = false, duplicate = true, message = "This sale already has a receipt print job." });
        }

        await PrinterCommandGate.WaitAsync(context.RequestAborted);
        try
        {
            WindowsPrinter.SendRaw(printerName, receiptData, "Kodigo thermal receipt");
        }
        finally
        {
            PrinterCommandGate.Release();
        }

        return Results.Ok(new { submitted = true, duplicate = false, message = "Windows accepted the receipt job. Check the printer for output." });
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(StatusCodes.Status408RequestTimeout);
    }
    catch (Exception)
    {
        return Results.Problem("Windows could not submit the receipt. Check that the printer is online and its driver accepts RAW thermal jobs.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapPost("/v1/drawer/pulse", async (HttpContext context) =>
{
    var request = await ReadJson<DrawerRequest>(context);
    if (request is null
        || string.IsNullOrWhiteSpace(request.PrinterName)
        || request.PrinterName.Length > 256
        || !Guid.TryParse(request.SaleId, out var saleId))
    {
        return Results.BadRequest(new ApiError("A valid printer name and completed sale ID are required."));
    }

    var printerName = request.PrinterName.Trim();
    try
    {
        var printers = WindowsPrinter.GetInstalledPrinters();
        if (!printers.Contains(printerName, StringComparer.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiError("That printer is not installed on this computer. Find printers again and choose an installed printer."));
        }

        var alreadyAttempted = await DrawerPulseLedger.TryClaimAsync(saleId);
        if (alreadyAttempted)
        {
            return Results.Ok(new { opened = false, duplicate = true, message = "This sale already triggered a drawer pulse." });
        }

        await PrinterCommandGate.WaitAsync(context.RequestAborted);
        try
        {
            WindowsPrinter.SendRaw(printerName, EscPosDrawerPulse.Command);
        }
        finally
        {
            PrinterCommandGate.Release();
        }

        return Results.Ok(new { opened = true, duplicate = false, message = "Drawer pulse sent to the printer." });
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(StatusCodes.Status408RequestTimeout);
    }
    catch (Exception)
    {
        return Results.Problem("Windows could not send the drawer pulse. Check the printer, driver, cable, and drawer connection.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapPost("/v1/drawer/test", async (HttpContext context) =>
{
    var request = await ReadJson<DrawerTestRequest>(context);
    if (request is null || string.IsNullOrWhiteSpace(request.PrinterName) || request.PrinterName.Length > 256)
    {
        return Results.BadRequest(new ApiError("Choose an installed printer before testing the drawer."));
    }

    var printerName = request.PrinterName.Trim();
    try
    {
        var printers = WindowsPrinter.GetInstalledPrinters();
        if (!printers.Contains(printerName, StringComparer.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiError("That printer is not installed on this computer."));
        }

        await PrinterCommandGate.WaitAsync(context.RequestAborted);
        try
        {
            WindowsPrinter.SendRaw(printerName, EscPosDrawerPulse.Command);
        }
        finally
        {
            PrinterCommandGate.Release();
        }

        return Results.Ok(new { opened = true, message = "Drawer test pulse sent to the printer." });
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(StatusCodes.Status408RequestTimeout);
    }
    catch (Exception)
    {
        return Results.Problem("Windows could not send the drawer pulse. Check the printer, driver, cable, and drawer connection.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapFallback(() => Results.NotFound(new ApiError("Unknown print-agent endpoint.")));

Console.WriteLine($"Kodigo Print Agent listening on http://127.0.0.1:{AgentConfiguration.Port}");
Console.WriteLine("The API is available only to this computer. Keep this process running while the POS is in use.");
await app.RunAsync();

static async Task<T?> ReadJson<T>(HttpContext context) where T : class
{
    if (context.Request.ContentLength is > 128 * 1024) return null;
    try
    {
        return await context.Request.ReadFromJsonAsync<T>(new JsonSerializerOptions(JsonSerializerDefaults.Web), context.RequestAborted);
    }
    catch (JsonException)
    {
        return null;
    }
}

static class PrinterCommandGate
{
    public static readonly SemaphoreSlim Semaphore = new(1, 1);
    public static Task WaitAsync(CancellationToken cancellationToken) => Semaphore.WaitAsync(cancellationToken);
    public static void Release() => Semaphore.Release();
}

sealed record ApiError(string Error);
sealed record DrawerRequest(string PrinterName, string SaleId);
sealed record DrawerTestRequest(string PrinterName);
sealed record ReceiptPrintRequest(string PrinterName, string SaleId, bool Reprint, JsonElement Receipt);

static class AgentConfiguration
{
    public const int Port = 17831;
    private static readonly string[] DefaultOrigins =
    [
        "https://kodigo-blue.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ];

    public static HashSet<string> GetAllowedOrigins()
    {
        var configured = Environment.GetEnvironmentVariable("KODIGO_PRINT_ALLOWED_ORIGINS");
        var origins = string.IsNullOrWhiteSpace(configured)
            ? DefaultOrigins
            : configured.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return new HashSet<string>(origins, StringComparer.OrdinalIgnoreCase);
    }
}

static class PairingTokenStore
{
    private static readonly string HashPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Kodigo",
        "PrintAgent",
        "pairing-token.sha256");

    public static bool Exists => File.Exists(HashPath);

    public static string Create()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        var tokenHash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        Directory.CreateDirectory(Path.GetDirectoryName(HashPath)!);
        File.WriteAllText(HashPath, Convert.ToHexString(tokenHash));
        return token;
    }

    public static bool IsValid(string authorizationHeader)
    {
        if (!authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
        var token = authorizationHeader[7..].Trim();
        if (token.Length is < 40 or > 64) return false;

        byte[] expectedHash;
        try
        {
            expectedHash = Convert.FromHexString(File.ReadAllText(HashPath).Trim());
        }
        catch
        {
            return false;
        }

        var candidateHash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return expectedHash.Length == candidateHash.Length
            && CryptographicOperations.FixedTimeEquals(expectedHash, candidateHash);
    }
}

static class DrawerPulseLedger
{
    private const int MaximumEntries = 5000;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string LedgerPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Kodigo",
        "PrintAgent",
        "drawer-pulses.json");
    private static HashSet<string>? _attemptedSales;
    private static List<string>? _order;

    public static async Task<bool> TryClaimAsync(Guid saleId)
    {
        await Gate.WaitAsync();
        try
        {
            await LoadAsync();
            var normalizedId = saleId.ToString("D");
            if (_attemptedSales!.Contains(normalizedId)) return true;

            _attemptedSales.Add(normalizedId);
            _order!.Add(normalizedId);
            if (_order.Count > MaximumEntries)
            {
                var expired = _order.Take(_order.Count - MaximumEntries).ToArray();
                foreach (var id in expired) _attemptedSales.Remove(id);
                _order.RemoveRange(0, expired.Length);
            }

            var directory = Path.GetDirectoryName(LedgerPath)!;
            Directory.CreateDirectory(directory);
            var tempPath = LedgerPath + ".tmp";
            await File.WriteAllTextAsync(tempPath, JsonSerializer.Serialize(_order));
            File.Move(tempPath, LedgerPath, overwrite: true);
            return false;
        }
        finally
        {
            Gate.Release();
        }
    }

    private static async Task LoadAsync()
    {
        if (_attemptedSales is not null) return;
        try
        {
            List<string> entries;
            if (File.Exists(LedgerPath))
            {
                await using var stream = File.OpenRead(LedgerPath);
                entries = await JsonSerializer.DeserializeAsync<List<string>>(stream) ?? [];
            }
            else
            {
                entries = [];
            }
            _order = entries.TakeLast(MaximumEntries).ToList();
            _attemptedSales = new HashSet<string>(_order, StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            _order = [];
            _attemptedSales = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }
}

static class ReceiptPrintLedger
{
    private const int MaximumEntries = 5000;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string LedgerPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Kodigo",
        "PrintAgent",
        "receipt-print-jobs.json");
    private static HashSet<string>? _attemptedSales;
    private static List<string>? _order;

    public static async Task<bool> TryClaimAsync(Guid saleId)
    {
        await Gate.WaitAsync();
        try
        {
            await LoadAsync();
            var normalizedId = saleId.ToString("D");
            if (_attemptedSales!.Contains(normalizedId)) return true;

            _attemptedSales.Add(normalizedId);
            _order!.Add(normalizedId);
            if (_order.Count > MaximumEntries)
            {
                var expired = _order.Take(_order.Count - MaximumEntries).ToArray();
                foreach (var id in expired) _attemptedSales.Remove(id);
                _order.RemoveRange(0, expired.Length);
            }

            var directory = Path.GetDirectoryName(LedgerPath)!;
            Directory.CreateDirectory(directory);
            var tempPath = LedgerPath + ".tmp";
            await File.WriteAllTextAsync(tempPath, JsonSerializer.Serialize(_order));
            File.Move(tempPath, LedgerPath, overwrite: true);
            return false;
        }
        finally
        {
            Gate.Release();
        }
    }

    private static async Task LoadAsync()
    {
        if (_attemptedSales is not null) return;
        try
        {
            List<string> entries;
            if (File.Exists(LedgerPath))
            {
                await using var stream = File.OpenRead(LedgerPath);
                entries = await JsonSerializer.DeserializeAsync<List<string>>(stream) ?? [];
            }
            else
            {
                entries = [];
            }
            _order = entries.TakeLast(MaximumEntries).ToList();
            _attemptedSales = new HashSet<string>(_order, StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            _order = [];
            _attemptedSales = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }
}

static class EscPosDrawerPulse
{
    // ESC/POS ESC p m t1 t2. This standard pulse selects drawer pin 2.
    public static readonly byte[] Command = [0x1B, 0x70, 0x00, 0x19, 0xFA];
}
