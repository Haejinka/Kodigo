namespace Kodigo.PrintAgent;

internal static class AgentOriginPolicy
{
    public static bool IsAllowed(string? origin, IReadOnlySet<string> allowedOrigins) =>
        !string.IsNullOrWhiteSpace(origin) && allowedOrigins.Contains(origin);
}
