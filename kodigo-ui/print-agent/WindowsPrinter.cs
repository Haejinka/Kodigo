using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Kodigo.PrintAgent;

internal static class WindowsPrinter
{
    private const uint PrinterEnumLocal = 0x00000002;
    private const uint PrinterEnumConnections = 0x00000004;
    private const uint PrinterInfoLevelStatus = 6;
    private const uint PrinterStatusPaused = 0x00000001;
    private const uint PrinterStatusOffline = 0x00000080;
    private const uint PrinterStatusNotAvailable = 0x00001000;

    public static IReadOnlyList<string> GetInstalledPrinters()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();

        _ = EnumPrinters(PrinterEnumLocal | PrinterEnumConnections, null, 4, IntPtr.Zero, 0, out var bytesNeeded, out _);
        if (bytesNeeded == 0) return [];

        var buffer = Marshal.AllocHGlobal(checked((int)bytesNeeded));
        try
        {
            if (!EnumPrinters(PrinterEnumLocal | PrinterEnumConnections, null, 4, buffer, bytesNeeded, out _, out var returned))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var infoSize = Marshal.SizeOf<PrinterInfo4>();
            var printers = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < returned; index++)
            {
                var info = Marshal.PtrToStructure<PrinterInfo4>(IntPtr.Add(buffer, checked((int)index * infoSize)));
                var name = Marshal.PtrToStringUni(info.PrinterName);
                if (!string.IsNullOrWhiteSpace(name)) printers.Add(name);
            }

            return printers.ToArray();
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static bool IsUnavailable(string printerName)
    {
        return TryGetPrinterStatus(printerName, out var status) && IsUnavailableStatus(status);
    }

    public static void EnsureAvailable(string printerName)
    {
        if (!TryGetPrinterStatus(printerName, out var status)) return;

        if ((status & PrinterStatusOffline) != 0)
        {
            throw new PrinterUnavailableException(
                $"Windows reports {printerName} is offline. Check its USB cable or port and the Windows print queue, then reconnect this computer in Kodigo Settings. No new print or drawer job was submitted.");
        }

        if ((status & (PrinterStatusPaused | PrinterStatusNotAvailable)) != 0)
        {
            throw new PrinterUnavailableException(
                $"Windows reports {printerName} is paused or unavailable. Check the Windows print queue, then reconnect this computer in Kodigo Settings. No new print or drawer job was submitted.");
        }
    }

    private static bool TryGetPrinterStatus(string printerName, out uint status)
    {
        status = 0;
        if (!OperatingSystem.IsWindows() || !OpenPrinter(printerName, out var printer, IntPtr.Zero)) return false;

        try
        {
            var bufferSize = checked((uint)Marshal.SizeOf<PrinterInfo6>());
            var buffer = Marshal.AllocHGlobal(checked((int)bufferSize));
            try
            {
                if (!GetPrinter(printer, PrinterInfoLevelStatus, buffer, bufferSize, out _)) return false;
                status = Marshal.PtrToStructure<PrinterInfo6>(buffer).Status;
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            _ = ClosePrinter(printer);
        }
    }

    private static bool IsUnavailableStatus(uint status)
    {
        return (status & (PrinterStatusOffline | PrinterStatusPaused | PrinterStatusNotAvailable)) != 0;
    }

    public static void SendRaw(string printerName, byte[] data, string documentName = "Kodigo cash drawer pulse")
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (data.Length == 0) throw new ArgumentException("Printer data cannot be empty.", nameof(data));
        if (!OpenPrinter(printerName, out var printer, IntPtr.Zero))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var documentStarted = false;
        var pageStarted = false;
        try
        {
            var document = new DocInfo1(documentName, null, "RAW");
            if (StartDocPrinter(printer, 1, ref document) == 0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            documentStarted = true;

            if (!StartPagePrinter(printer)) throw new Win32Exception(Marshal.GetLastWin32Error());
            pageStarted = true;

            if (!WritePrinter(printer, data, checked((uint)data.Length), out var written))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            if (written != data.Length) throw new IOException("Windows accepted only part of the drawer pulse.");

            if (!EndPagePrinter(printer)) throw new Win32Exception(Marshal.GetLastWin32Error());
            pageStarted = false;
            if (!EndDocPrinter(printer)) throw new Win32Exception(Marshal.GetLastWin32Error());
            documentStarted = false;
        }
        finally
        {
            if (pageStarted) _ = EndPagePrinter(printer);
            if (documentStarted) _ = EndDocPrinter(printer);
            _ = ClosePrinter(printer);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PrinterInfo4
    {
        public IntPtr PrinterName;
        public IntPtr ServerName;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PrinterInfo6
    {
        public uint Status;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo1(string documentName, string? outputFile, string dataType)
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName = documentName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? OutputFile = outputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType = dataType;
    }

    [DllImport("winspool.drv", EntryPoint = "EnumPrintersW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr printerEnum, uint bufferSize, out uint bytesNeeded, out uint printersReturned);

    [DllImport("winspool.drv", EntryPoint = "GetPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPrinter(IntPtr printer, uint level, IntPtr printerInfo, uint bufferSize, out uint bytesNeeded);

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint StartDocPrinter(IntPtr printer, uint level, ref DocInfo1 documentInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WritePrinter(IntPtr printer, byte[] buffer, uint bytes, out uint written);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinter(IntPtr printer);
}

internal sealed class PrinterUnavailableException(string message) : IOException(message);
