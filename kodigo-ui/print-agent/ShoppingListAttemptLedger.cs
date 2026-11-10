using System.Security.Cryptography;
using System.Text.Json;

namespace Kodigo.PrintAgent;

internal enum DocumentPrintClaimStatus
{
    Claimed,
    Duplicate,
    Conflict,
}

internal sealed record DocumentPrintClaim(DocumentPrintClaimStatus Status, string Message);

/// <summary>Durable, bounded idempotency ledger for local non-sale document print attempts.</summary>
internal sealed class ShoppingListAttemptLedger(string ledgerPath, int maximumDocuments = 5000, int maximumAttempts = 5000)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private LedgerState? _state;

    public async Task<DocumentPrintClaim> TryClaimAsync(
        Guid documentId,
        Guid attemptId,
        string documentHash,
        bool reprint,
        CancellationToken cancellationToken = default)
    {
        if (!IsSha256(documentHash)) throw new ArgumentException("The shopping-list document hash is invalid.");
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _state ??= await LoadAsync(cancellationToken);
            var normalizedDocumentId = documentId.ToString("D");
            var normalizedAttemptId = attemptId.ToString("D");

            var knownDocument = _state.Documents.LastOrDefault(entry => entry.DocumentId == normalizedDocumentId);
            if (knownDocument is not null && !FixedEquals(knownDocument.DocumentHash, documentHash))
            {
                return new DocumentPrintClaim(DocumentPrintClaimStatus.Conflict, "This document ID was already used with different shopping-list content.");
            }

            var knownAttempt = _state.Attempts.LastOrDefault(entry => entry.AttemptId == normalizedAttemptId);
            if (knownAttempt is not null)
            {
                if (knownAttempt.DocumentId != normalizedDocumentId || !FixedEquals(knownAttempt.DocumentHash, documentHash))
                {
                    return new DocumentPrintClaim(DocumentPrintClaimStatus.Conflict, "This print-attempt ID was already used for a different document or content.");
                }
                return new DocumentPrintClaim(DocumentPrintClaimStatus.Duplicate, "This print attempt was already submitted. Choose explicit reprint to create another attempt.");
            }

            var duplicateDocument = knownDocument is not null && !reprint;
            var next = _state.Clone();
            if (knownDocument is null)
            {
                next.Documents.Add(new DocumentEntry { DocumentId = normalizedDocumentId, DocumentHash = documentHash });
            }
            next.Attempts.Add(new AttemptEntry
            {
                AttemptId = normalizedAttemptId,
                DocumentId = normalizedDocumentId,
                DocumentHash = documentHash,
                Reprint = reprint,
            });
            Trim(next);
            await SaveAsync(next, cancellationToken);
            _state = next;

            return duplicateDocument
                ? new DocumentPrintClaim(DocumentPrintClaimStatus.Duplicate, "This shopping list already has a print attempt. Choose explicit reprint to submit another job.")
                : new DocumentPrintClaim(DocumentPrintClaimStatus.Claimed, "The shopping-list print attempt was claimed.");
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<LedgerState> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(ledgerPath)) return new LedgerState();

        try
        {
            await using var stream = File.OpenRead(ledgerPath);
            var state = await JsonSerializer.DeserializeAsync<LedgerState>(stream, cancellationToken: cancellationToken);
            if (state is null || state.Version != 1 || state.Documents is null || state.Attempts is null)
            {
                throw new InvalidDataException();
            }
            if (state.Documents.Count > maximumDocuments || state.Attempts.Count > maximumAttempts
                || state.Documents.Any(entry => !Guid.TryParse(entry.DocumentId, out _) || !IsSha256(entry.DocumentHash))
                || state.Attempts.Any(entry => !Guid.TryParse(entry.AttemptId, out _)
                    || !Guid.TryParse(entry.DocumentId, out _)
                    || !IsSha256(entry.DocumentHash)))
            {
                throw new InvalidDataException();
            }
            return state;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception)
        {
            throw new InvalidDataException("The local shopping-list print history is unreadable; it was preserved and no print was submitted.", exception);
        }
    }

    private async Task SaveAsync(LedgerState state, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(ledgerPath);
        if (string.IsNullOrEmpty(directory)) throw new IOException("The local shopping-list print history path is invalid.");
        Directory.CreateDirectory(directory);
        var temporaryPath = ledgerPath + ".tmp";
        await using (var stream = new FileStream(temporaryPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, state, cancellationToken: cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temporaryPath, ledgerPath, overwrite: true);
    }

    private void Trim(LedgerState state)
    {
        if (state.Documents.Count > maximumDocuments)
        {
            var expiredIds = state.Documents.Take(state.Documents.Count - maximumDocuments)
                .Select(entry => entry.DocumentId)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            state.Documents.RemoveAll(entry => expiredIds.Contains(entry.DocumentId));
            state.Attempts.RemoveAll(entry => expiredIds.Contains(entry.DocumentId));
        }
        if (state.Attempts.Count > maximumAttempts)
        {
            state.Attempts.RemoveRange(0, state.Attempts.Count - maximumAttempts);
        }
    }

    private static bool IsSha256(string value) => value.Length == 64
        && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F');

    private static bool FixedEquals(string first, string second)
    {
        try
        {
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(first), Convert.FromHexString(second));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private sealed class DocumentEntry
    {
        public DocumentEntry() { }
        public string DocumentId { get; init; } = string.Empty;
        public string DocumentHash { get; init; } = string.Empty;
    }

    private sealed class AttemptEntry
    {
        public AttemptEntry() { }
        public string AttemptId { get; init; } = string.Empty;
        public string DocumentId { get; init; } = string.Empty;
        public string DocumentHash { get; init; } = string.Empty;
        public bool Reprint { get; init; }
    }

    private sealed class LedgerState
    {
        public LedgerState() { }

        public int Version { get; init; } = 1;
        public List<DocumentEntry> Documents { get; init; } = [];
        public List<AttemptEntry> Attempts { get; init; } = [];

        public LedgerState Clone() => new()
        {
            Version = Version,
            Documents = [.. Documents],
            Attempts = [.. Attempts],
        };
    }
}
