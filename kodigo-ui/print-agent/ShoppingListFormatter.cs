using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Kodigo.PrintAgent;

internal static class ShoppingListFormatter
{
    private const int MaximumItems = 50;
    private const int MaximumTextLength = 192;
    private static readonly CultureInfo NumberCulture = CultureInfo.InvariantCulture;

    public static bool IsSupportedProfile(string profile) => profile is "58mm" or "80mm";

    public static string ComputeHash(JsonElement shoppingList, string profile, bool showPrices)
    {
        if (!IsSupportedProfile(profile)) throw new ArgumentException("Choose a supported shopping-list paper profile.");
        var hashInput = $"profile:{profile}\nshow_prices:{showPrices.ToString().ToLowerInvariant()}\n{shoppingList.GetRawText()}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(hashInput))).ToLowerInvariant();
    }

    public static byte[] Format(JsonElement shoppingList, string profile, bool showPrices)
    {
        if (!IsSupportedProfile(profile)) throw new ArgumentException("Choose a supported shopping-list paper profile.");
        var values = ReadSnapshot(shoppingList);
        var lineWidth = profile == "58mm" ? 32 : 48;
        using var output = new MemoryStream();
        output.Write([0x1B, 0x40, 0x1B, 0x74, 0x00]); // ESC @, select PC437.

        void Command(params byte[] bytes) => output.Write(bytes);
        void Line(string value = "")
        {
            output.Write(Encoding.ASCII.GetBytes(Normalize(value)));
            output.WriteByte(0x0A);
        }
        void Wrapped(string value, bool bold = false)
        {
            var safe = Normalize(value);
            if (safe.Length == 0) return;
            if (bold) Command(0x1B, 0x45, 0x01);
            foreach (var line in Wrap(safe, lineWidth)) Line(line);
            if (bold) Command(0x1B, 0x45, 0x00);
        }
        void Rule() => Line(new string('-', lineWidth));

        Wrapped("SHOPPING LIST", bold: true);
        Wrapped("NOT A SALES RECEIPT", bold: true);
        Wrapped(values.StoreName);
        Wrapped(FormatDate(values.CreatedAt));
        Rule();

        foreach (var item in values.Items)
        {
            Wrapped(item.ProductName, bold: true);
            Wrapped($"{DisplayNumber(item.Quantity)} {item.PurchaseUnit}");
            if (showPrices)
            {
                Wrapped($"{Money(item.UnitPrice)} / unit");
                Wrapped($"Subtotal: {Money(item.Subtotal)}");
                if (item.IsEstimated) Wrapped("Estimated cost");
            }
            Line();
        }

        if (showPrices)
        {
            Rule();
            Wrapped($"TOTAL: {Money(values.Total)}", bold: true);
        }
        Rule();
        Wrapped("For purchasing reference only.");
        Line();
        Line();
        Command(0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00);
        return output.ToArray();
    }

    private static Snapshot ReadSnapshot(JsonElement snapshot)
    {
        if (snapshot.ValueKind != JsonValueKind.Object
            || !TryNumber(snapshot, "version", out var version)
            || version != 1)
        {
            throw new ArgumentException("This shopping-list document version is not supported by the local print agent.");
        }

        var documentId = RequiredText(snapshot, "documentId");
        if (!Guid.TryParse(documentId, out _)) throw new ArgumentException("The shopping-list document ID is invalid.");
        _ = RequiredText(snapshot, "storeId");
        var storeName = RequiredText(snapshot, "storeName");
        var createdAtText = RequiredText(snapshot, "createdAt");
        if (!DateTimeOffset.TryParse(createdAtText, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var createdAt))
        {
            throw new ArgumentException("The shopping-list timestamp is invalid.");
        }
        if (!snapshot.TryGetProperty("items", out var items)
            || items.ValueKind != JsonValueKind.Array
            || items.GetArrayLength() is < 1 or > MaximumItems)
        {
            throw new ArgumentException($"A shopping list must contain between 1 and {MaximumItems} items.");
        }

        var parsedItems = new List<ShoppingListItem>(items.GetArrayLength());
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !TryNumber(item, "quantity", out var quantity)
                || !TryNumber(item, "unitPrice", out var unitPrice)
                || !TryNumber(item, "subtotal", out var subtotal)
                || quantity < 0 || unitPrice < 0 || subtotal < 0
                || !item.TryGetProperty("isEstimated", out var estimated)
                || estimated.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                throw new ArgumentException("A shopping-list item has invalid quantity or price values.");
            }

            parsedItems.Add(new ShoppingListItem(
                RequiredText(item, "productName"),
                quantity,
                RequiredText(item, "purchaseUnit"),
                unitPrice,
                subtotal,
                estimated.GetBoolean()));
        }

        if (!TryNumber(snapshot, "total", out var total) || total < 0)
        {
            throw new ArgumentException("The shopping-list total is invalid.");
        }

        return new Snapshot(storeName, createdAt, parsedItems, total);
    }

    private static string RequiredText(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new ArgumentException($"Shopping-list field '{name}' is missing or invalid.");
        }

        var text = value.GetString()?.Trim() ?? string.Empty;
        if (text.Length is 0 or > MaximumTextLength)
        {
            throw new ArgumentException($"Shopping-list field '{name}' must contain between 1 and {MaximumTextLength} characters.");
        }
        return text;
    }

    private static bool TryNumber(JsonElement parent, string name, out decimal value)
    {
        value = 0;
        return parent.TryGetProperty(name, out var element)
            && element.ValueKind == JsonValueKind.Number
            && element.TryGetDecimal(out value);
    }

    private static string Money(decimal amount) => $"PHP {amount.ToString("N2", NumberCulture)}";
    private static string DisplayNumber(decimal value) => value.ToString("0.####", NumberCulture);

    private static string FormatDate(DateTimeOffset value) => value
        .ToOffset(TimeSpan.FromHours(8))
        .ToString("MMM d, yyyy h:mm tt", CultureInfo.GetCultureInfo("en-US"));

    private static string Normalize(string value)
    {
        var expanded = value.Replace("₱", "PHP ", StringComparison.Ordinal);
        var normalized = expanded.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category == UnicodeCategory.NonSpacingMark) continue;
            if (character is '\r' or '\n' or '\t' || char.IsControl(character)) continue;
            builder.Append(character is >= ' ' and <= '~' ? character : '?');
        }
        return builder.ToString().Normalize(NormalizationForm.FormC).Trim();
    }

    private static IEnumerable<string> Wrap(string text, int width)
    {
        foreach (var paragraph in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var words = paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var line = new StringBuilder();
            foreach (var word in words)
            {
                var remaining = word;
                while (remaining.Length > width)
                {
                    if (line.Length > 0)
                    {
                        yield return line.ToString();
                        line.Clear();
                    }
                    yield return remaining[..width];
                    remaining = remaining[width..];
                }
                if (line.Length == 0) line.Append(remaining);
                else if (line.Length + 1 + remaining.Length <= width) line.Append(' ').Append(remaining);
                else
                {
                    yield return line.ToString();
                    line.Clear();
                    line.Append(remaining);
                }
            }
            if (line.Length > 0) yield return line.ToString();
        }
    }

    private sealed record ShoppingListItem(string ProductName, decimal Quantity, string PurchaseUnit, decimal UnitPrice, decimal Subtotal, bool IsEstimated);
    private sealed record Snapshot(string StoreName, DateTimeOffset CreatedAt, IReadOnlyList<ShoppingListItem> Items, decimal Total);
}
