using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Kodigo.PrintAgent;

internal static class ReceiptFormatter
{
    private const int LineWidth = 32;
    private const int MaximumItems = 100;
    private static readonly CultureInfo NumberCulture = CultureInfo.InvariantCulture;

    public static bool MatchesSale(JsonElement receipt, Guid saleId)
    {
        if (!receipt.TryGetProperty("sale", out var sale)
            || sale.ValueKind != JsonValueKind.Object
            || !sale.TryGetProperty("id", out var id)
            || id.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        return Guid.TryParse(id.GetString(), out var receiptSaleId) && receiptSaleId == saleId;
    }

    public static byte[] Format(JsonElement receipt)
    {
        if (!receipt.TryGetProperty("version", out var version)
            || !version.TryGetInt32(out var versionNumber)
            || versionNumber != 2)
        {
            throw new ArgumentException("This receipt format is not supported by the local print agent.");
        }

        var store = RequiredObject(receipt, "store");
        var sale = RequiredObject(receipt, "sale");
        var cashier = RequiredObject(receipt, "cashier");
        var customer = OptionalObject(receipt, "customer");
        var payment = OptionalObject(receipt, "payment");
        var totals = RequiredObject(receipt, "totals");
        if (!receipt.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > MaximumItems)
        {
            throw new ArgumentException("A receipt must contain between 0 and 100 items.");
        }

        using var output = new MemoryStream();
        output.Write([0x1B, 0x40, 0x1B, 0x74, 0x00]); // ESC @, select PC437.

        void Command(params byte[] bytes) => output.Write(bytes);
        void Line(string value = "")
        {
            var safe = Normalize(value);
            output.Write(Encoding.ASCII.GetBytes(safe));
            output.WriteByte(0x0A);
        }
        void Wrapped(string value, bool bold = false)
        {
            var safe = Normalize(value);
            if (safe.Length == 0) return;
            if (bold) Command(0x1B, 0x45, 0x01);
            foreach (var line in Wrap(safe, LineWidth)) Line(line);
            if (bold) Command(0x1B, 0x45, 0x00);
        }
        void Centered(string value, bool bold = false)
        {
            Command(0x1B, 0x61, 0x01);
            Wrapped(value, bold);
            Command(0x1B, 0x61, 0x00);
        }
        void Rule() => Line(new string('-', LineWidth));
        void Pair(string label, string value, bool bold = false)
        {
            var safeLabel = Normalize(label);
            var safeValue = Normalize(value);
            var valueLines = Wrap(safeValue, LineWidth - 9).ToArray();
            if (valueLines.Length == 0) valueLines = [""];
            var availableLabelWidth = Math.Max(8, LineWidth - valueLines[0].Length - 1);
            var labelLines = Wrap(safeLabel, availableLabelWidth).ToArray();
            if (bold) Command(0x1B, 0x45, 0x01);
            for (var index = 0; index < labelLines.Length; index++)
            {
                var line = index == labelLines.Length - 1
                    ? labelLines[index].PadRight(LineWidth - valueLines[0].Length) + valueLines[0]
                    : labelLines[index];
                Line(line);
            }
            foreach (var line in valueLines.Skip(1)) Line(line.PadLeft(LineWidth));
            if (bold) Command(0x1B, 0x45, 0x00);
        }

        var businessName = Text(store, "businessName", Text(store, "name", "Store"));
        Centered(businessName, bold: true);
        Centered(Text(store, "registeredName", businessName));
        Centered(Text(store, "address"));
        var phone = Text(store, "phone");
        if (phone.Length > 0) Centered(phone);
        var tin = Text(store, "tin", "Not configured");
        var branch = Text(store, "branchCode");
        Centered($"TIN: {tin}{(branch.Length > 0 ? $"  Branch: {branch}" : "")}");
        var isVat = Text(store, "vatStatus") == "vat";
        Centered(isVat ? "VAT Registered" : "Non-VAT Registered");
        Centered(Text(store, "documentLabel", "Sales Invoice"), bold: true);
        Rule();

        Pair("Invoice No.", Text(sale, "receipt_number", Text(sale, "id")));
        Pair("Date / Time", FormatDate(Text(sale, "created_at")));
        Pair("Cashier", Text(cashier, "name", "Unknown"));
        var terminal = Text(store, "terminalIdentifier");
        if (terminal.Length > 0) Pair("Terminal", terminal);

        if (Text(customer, "name").Length + Text(customer, "tin").Length + Text(customer, "address").Length > 0)
        {
            Rule();
            Wrapped("Customer", bold: true);
            Wrapped(Text(customer, "name"));
            var customerTin = Text(customer, "tin");
            if (customerTin.Length > 0) Wrapped($"TIN: {customerTin}");
            Wrapped(Text(customer, "address"));
        }

        Rule();
        Pair("Item", "Amount", bold: true);
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            Wrapped(Text(item, "product_name"), bold: true);
            Wrapped(Text(item, "selling_option_label"));
            var baseQuantity = Number(item, "base_unit_quantity");
            if (baseQuantity > 0)
            {
                var unit = Text(item, "base_unit_label", Text(item, "unit_label", "unit"));
                Wrapped(QuantityWithUnit(baseQuantity, unit));
            }
            var itemDiscount = Number(item, "item_discount_amount");
            if (itemDiscount > 0) Wrapped($"Item discount: -{Money(itemDiscount)}");
            Pair($"{DisplayNumber(Number(item, "quantity"))} x {Money(Number(item, "unit_price"))}", Money(Number(item, "line_total")));
        }

        Rule();
        Pair("Subtotal", Money(Number(totals, "subtotal")));
        var discountCategory = Text(totals, "discountCategory");
        Pair(discountCategory.Length > 0 && discountCategory != "regular" ? $"Discount ({discountCategory.ToUpperInvariant()})" : "Discount", $"-{Money(Number(totals, "discount"))}");
        if (isVat)
        {
            Pair("VATable Sales", Money(Number(totals, "vatableSales")));
            Pair("VAT Amount", Money(Number(totals, "vatAmount")));
            Pair("VAT-Exempt Sales", Money(Number(totals, "vatExemptSales")));
            Pair("Zero-Rated Sales", Money(Number(totals, "zeroRatedSales")));
        }
        else
        {
            Pair("Non-VAT Sales", Money(Number(totals, "nonVatSales")));
        }
        Pair("TOTAL AMOUNT DUE", Money(Number(totals, "total")), bold: true);
        Pair("Payment Method", Text(payment, "method", Text(sale, "payment_method", "cash")));
        Pair("Amount Tendered", Money(Number(totals, "amountTendered")));
        Pair("Change", Money(Number(totals, "change")));
        var reference = Text(payment, "reference_number", Text(sale, "payment_reference"));
        if (reference.Length > 0) Pair("Reference No.", reference);
        if (!isVat)
        {
            Rule();
            Centered("THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.", bold: true);
        }

        Rule();
        Centered(Text(store, "birRegistrationInfo"));
        Centered(Text(store, "accreditationInfo"));
        Centered(Text(store, "permitInfo"));
        Centered("Thank you for your purchase.");
        Line();
        Line();
        Line();
        Command(0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00);
        return output.ToArray();
    }

    private static JsonElement RequiredObject(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException($"Receipt field '{name}' is missing or invalid.");
        }
        return value;
    }

    private static JsonElement OptionalObject(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : default;

    private static string Text(JsonElement parent, string name, string fallback = "")
    {
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return fallback;
        }
        var raw = value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();
        if (raw.Length > 512) throw new ArgumentException($"Receipt field '{name}' is too long.");
        return string.IsNullOrWhiteSpace(raw) ? fallback : raw;
    }

    private static decimal Number(JsonElement parent, string name)
    {
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(name, out var value)) return 0;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)) return number;
        return decimal.TryParse(value.ToString(), NumberStyles.Number, NumberCulture, out number) ? number : 0;
    }

    private static string Money(decimal amount) => $"PHP {amount.ToString("N2", NumberCulture)}";
    private static string DisplayNumber(decimal value) => value.ToString("0.##", NumberCulture);

    private static string FormatDate(string value)
    {
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)) return Normalize(value);
        return date.ToOffset(TimeSpan.FromHours(8)).ToString("MMM d, yyyy h:mm tt", CultureInfo.GetCultureInfo("en-US"));
    }

    private static string QuantityWithUnit(decimal quantity, string unit)
    {
        var normalizedUnit = Normalize(unit.Length == 0 ? "unit" : unit);
        if (quantity != 1 && !normalizedUnit.EndsWith('s')) normalizedUnit += "s";
        return $"{DisplayNumber(quantity)} {normalizedUnit}";
    }

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
                if (line.Length == 0)
                {
                    line.Append(remaining);
                }
                else if (line.Length + 1 + remaining.Length <= width)
                {
                    line.Append(' ').Append(remaining);
                }
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
}
