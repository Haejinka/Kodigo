using System.Diagnostics;
using Microsoft.Win32;

namespace Kodigo.PrintAgent;

internal static class WindowsAgentInstaller
{
    private const string AppFolderName = "Kodigo\\PrintAgent";
    private const string StartupValueName = "KodigoPrintAgent";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string KodigoSettingsUrl = "https://kodigo-blue.vercel.app/settings?setupPrinter=1";

    public static void InstallAndOpenKodigo()
    {
        if (!OperatingSystem.IsWindows())
        {
            ShowMessage("Kodigo Print Setup currently supports Windows POS computers.", "Kodigo Print Setup", error: true);
            return;
        }

        try
        {
            var sourcePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
            {
                throw new InvalidOperationException("Windows could not locate the Kodigo Print Setup file.");
            }

            var installDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppFolderName);
            var installedPath = Path.Combine(installDirectory, "Kodigo.PrintAgent.exe");
            Directory.CreateDirectory(installDirectory);
            StopExistingAgent(installedPath);

            if (!string.Equals(Path.GetFullPath(sourcePath), Path.GetFullPath(installedPath), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(sourcePath, installedPath, overwrite: true);
            }

            using (var runKey = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true))
            {
                runKey?.SetValue(StartupValueName, $"\"{installedPath}\" --run", RegistryValueKind.String);
            }

            _ = Process.Start(new ProcessStartInfo
            {
                FileName = installedPath,
                Arguments = "--run",
                WorkingDirectory = installDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });

            _ = Process.Start(new ProcessStartInfo(KodigoSettingsUrl) { UseShellExecute = true });
        }
        catch (Exception)
        {
            ShowMessage("Kodigo Print Setup could not install the printer helper. Try running the setup file again, or ask your administrator for help.", "Kodigo Print Setup", error: true);
        }
    }

    private static void StopExistingAgent(string installedPath)
    {
        foreach (var process in Process.GetProcessesByName("Kodigo.PrintAgent"))
        {
            try
            {
                if (string.Equals(process.MainModule?.FileName, installedPath, StringComparison.OrdinalIgnoreCase))
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(5000);
                }
            }
            catch
            {
                // Installation continues if a process belongs to a different Windows account.
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static void ShowMessage(string message, string title, bool error = false)
    {
        _ = MessageBox(IntPtr.Zero, message, title, error ? 0x00000010U : 0x00000040U);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBox(IntPtr window, string text, string caption, uint type);
}
