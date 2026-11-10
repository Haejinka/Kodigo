using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
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

const string documentId = "c40ab5e6-8e6d-4538-b197-c86a9b8acb2f";
const string attemptId = "21a4b9c3-c9fc-44ed-9c31-8fce20b71fe7";
var shoppingListFixture = $$"""
{
  "version": 1,
  "documentId": "{{documentId}}",
  "createdAt": "2026-11-11T02:00:00.000Z",
  "storeId": "store-01",
  "storeName": "JP Store",
  "items": [
    { "productId": "product-01", "productName": "Cafe\u001b@ crackers with a very long name that wraps across the entire line width safely", "quantity": 2, "purchaseUnit": "case", "unitPrice": 25.25, "subtotal": 50.5, "isEstimated": true },
    { "productId": "product-02", "productName": "Noodles", "quantity": 1, "purchaseUnit": "box", "unitPrice": 140, "subtotal": 140, "isEstimated": false }
  ],
  "total": 190.5
}
""";

using var shoppingList = JsonDocument.Parse(shoppingListFixture);
var shoppingListElement = shoppingList.RootElement;
var shoppingListHash = ShoppingListFormatter.ComputeHash(shoppingListElement, "58mm", showPrices: true);
var expectedHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
    $"profile:58mm\nshow_prices:true\n{shoppingListElement.GetRawText()}"))).ToLowerInvariant();
if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(shoppingListHash), Convert.FromHexString(expectedHash)))
{
    throw new Exception("The shopping-list attempt hash did not cover the selected profile and serialized snapshot.");
}

foreach (var (profile, width) in new[] { ("58mm", 32), ("80mm", 48) })
{
    var formatted = ShoppingListFormatter.Format(shoppingListElement, profile, showPrices: true);
    var text = Encoding.ASCII.GetString(formatted);
    if (!text.Contains("SHOPPING LIST", StringComparison.Ordinal)
        || !text.Contains("NOT A SALES RECEIPT", StringComparison.Ordinal)
        || !text.Contains("PHP 190.50", StringComparison.Ordinal))
    {
        throw new Exception($"The {profile} shopping list omitted its nonfiscal label or total.");
    }
    if (text.Contains("Invoice No.", StringComparison.Ordinal)
        || text.Contains("Payment Method", StringComparison.Ordinal)
        || text.Contains("VAT Amount", StringComparison.Ordinal))
    {
        throw new Exception("Shopping-list output included a fiscal receipt field.");
    }
    if (Regex.Matches(text, "\\x1b(?:@|t.|a.|E.|p.)", RegexOptions.CultureInvariant).Count < 2)
    {
        throw new Exception("Shopping-list output omitted its safe printer initialization controls.");
    }
    if (text.Contains("\x1bp", StringComparison.Ordinal))
    {
        throw new Exception("Shopping-list output attempted a cash-drawer pulse.");
    }
    var shoppingListPrintableText = Regex.Replace(text, "\\x1b(?:@|t.|a.|E.|p.)", "", RegexOptions.CultureInvariant);
    foreach (var line in shoppingListPrintableText.Split('\n', StringSplitOptions.RemoveEmptyEntries))
    {
        if (line.Length > width) throw new Exception($"A {profile} shopping-list line exceeds {width} columns: {line}");
    }
}

var noPriceText = Encoding.ASCII.GetString(ShoppingListFormatter.Format(shoppingListElement, "80mm", showPrices: false));
if (noPriceText.Contains("PHP", StringComparison.Ordinal) || noPriceText.Contains("TOTAL:", StringComparison.Ordinal))
{
    throw new Exception("The no-prices profile still contained price fields.");
}

var ledgerFolder = Path.Combine(Path.GetTempPath(), $"kodigo-print-agent-tests-{Guid.NewGuid():N}");
Directory.CreateDirectory(ledgerFolder);
try
{
    var ledgerPath = Path.Combine(ledgerFolder, "attempts.json");
    var ledger = new ShoppingListAttemptLedger(ledgerPath, maximumDocuments: 5, maximumAttempts: 5);
    var firstClaim = await ledger.TryClaimAsync(Guid.Parse(documentId), Guid.Parse(attemptId), shoppingListHash, reprint: false);
    if (firstClaim.Status != DocumentPrintClaimStatus.Claimed) throw new Exception("The first shopping-list print attempt was not claimed.");
    var repeatedClaim = await ledger.TryClaimAsync(Guid.Parse(documentId), Guid.Parse(attemptId), shoppingListHash, reprint: false);
    if (repeatedClaim.Status != DocumentPrintClaimStatus.Duplicate) throw new Exception("The repeated attempt ID was not marked duplicate.");
    var changedContent = await ledger.TryClaimAsync(Guid.Parse(documentId), Guid.Parse(attemptId), new string('b', 64), reprint: true);
    if (changedContent.Status != DocumentPrintClaimStatus.Conflict) throw new Exception("Changed content reused an existing document ID.");
    var implicitReprint = await ledger.TryClaimAsync(Guid.Parse(documentId), Guid.NewGuid(), shoppingListHash, reprint: false);
    if (implicitReprint.Status != DocumentPrintClaimStatus.Duplicate) throw new Exception("A document was printed again without explicit reprint.");
    var explicitReprint = await ledger.TryClaimAsync(Guid.Parse(documentId), Guid.NewGuid(), shoppingListHash, reprint: true);
    if (explicitReprint.Status != DocumentPrintClaimStatus.Claimed) throw new Exception("An explicit reprint with a new attempt ID was rejected.");
    var recoveredLedger = new ShoppingListAttemptLedger(ledgerPath, maximumDocuments: 5, maximumAttempts: 5);
    var recoveredAttempt = await recoveredLedger.TryClaimAsync(Guid.Parse(documentId), Guid.Parse(attemptId), shoppingListHash, reprint: true);
    if (recoveredAttempt.Status != DocumentPrintClaimStatus.Duplicate) throw new Exception("The persisted print attempt was not recovered.");

    var corruptPath = Path.Combine(ledgerFolder, "corrupt.json");
    await File.WriteAllTextAsync(corruptPath, "{corrupt");
    var corruptLedger = new ShoppingListAttemptLedger(corruptPath);
    var corruptionRejected = false;
    try
    {
        await corruptLedger.TryClaimAsync(Guid.NewGuid(), Guid.NewGuid(), shoppingListHash, reprint: false);
    }
    catch (InvalidDataException) { corruptionRejected = true; }
    if (!corruptionRejected || await File.ReadAllTextAsync(corruptPath) != "{corrupt")
    {
        throw new Exception("A corrupt document ledger was overwritten or accepted.");
    }
}
finally
{
    Directory.Delete(ledgerFolder, recursive: true);
}

Console.WriteLine("Print agent shopping-list formatting and deduplication checks passed.");
