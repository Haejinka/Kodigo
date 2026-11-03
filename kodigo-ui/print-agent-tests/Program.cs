using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Kodigo.PrintAgent;

var allowedOrigins = new HashSet<string>(["https://kodigo-blue.vercel.app", "http://localhost:5173"], StringComparer.OrdinalIgnoreCase);
if (!AgentOriginPolicy.IsAllowed("https://kodigo-blue.vercel.app", allowedOrigins)) throw new Exception("The production Kodigo origin was rejected.");
if (AgentOriginPolicy.IsAllowed("https://kodigo-blue.vercel.app.attacker.test", allowedOrigins)) throw new Exception("A lookalike domain was allowed to pair.");
if (AgentOriginPolicy.IsAllowed("", allowedOrigins)) throw new Exception("A request without a browser origin was allowed to pair.");

const string saleId = "71d3baf1-b2f3-4e3d-bbb3-7cab9348b541";
var fixture = $$"""
{
  "version": 2,
  "sale": { "id": "{{saleId}}", "receipt_number": "INV-TEST-0001", "created_at": "2026-11-03T02:00:00.000Z", "payment_method": "cash" },
  "store": { "id": "store-01", "name": "Kodigo Store", "businessName": "Kodigo Store", "registeredName": "Kodigo Store Inc.", "address": "Cebu City", "vatStatus": "non_vat", "documentLabel": "Sales Invoice" },
  "cashier": { "name": "Test Cashier" },
  "customer": { "name": "" },
  "items": [
    { "product_name": "Coke\u001b@ Regular 330 ml", "selling_option_label": "Bottle", "quantity": 2, "unit_price": 75, "line_total": 150, "item_discount_amount": 5 },
    { "product_name": "Very long item name with many words that must wrap across multiple lines on narrow thermal receipt paper", "quantity": 1, "unit_price": 1200, "line_total": 1200 }
  ],
  "payment": { "method": "cash" },
  "totals": { "subtotal": 1355, "discount": 5, "discountCategory": "regular", "vatableSales": 0, "vatAmount": 0, "vatExemptSales": 0, "zeroRatedSales": 0, "nonVatSales": 1350, "total": 1350, "amountTendered": 1400, "change": 50 }
}
""";

using var receipt = JsonDocument.Parse(fixture);
var saleGuid = Guid.Parse(saleId);
if (!ReceiptFormatter.MatchesSale(receipt.RootElement, saleGuid)) throw new Exception("The formatter did not accept the matching sale ID.");
if (ReceiptFormatter.MatchesSale(receipt.RootElement, Guid.NewGuid())) throw new Exception("The formatter accepted a mismatched sale ID.");

var bytes = ReceiptFormatter.Format(receipt.RootElement);
var rawText = Encoding.ASCII.GetString(bytes);
if (!rawText.Contains("PHP 1,200.00", StringComparison.Ordinal)) throw new Exception("The receipt omitted a PHP amount.");
if (!rawText.Contains("THIS DOCUMENT IS NOT VALID", StringComparison.Ordinal)
    || !rawText.Contains("CLAIM OF INPUT TAX.", StringComparison.Ordinal))
{
    throw new Exception("The non-VAT legal receipt notice was omitted.");
}
if (!rawText.Contains("Coke@ Regular 330 ml", StringComparison.Ordinal)) throw new Exception("Receipt text was not sanitized as expected.");
if (Regex.Matches(rawText, "\\x1b@", RegexOptions.CultureInvariant).Count != 1) throw new Exception("Receipt content was able to inject an ESC/POS initialize command.");

var printableText = Regex.Replace(rawText, "\\x1b(?:@|t.|a.|E.)", "", RegexOptions.CultureInvariant);
foreach (var line in printableText.Split('\n', StringSplitOptions.RemoveEmptyEntries))
{
    if (line.Length > 32) throw new Exception($"A thermal receipt line exceeds 32 columns: {line}");
}

Console.WriteLine("Print agent receipt formatting checks passed.");
