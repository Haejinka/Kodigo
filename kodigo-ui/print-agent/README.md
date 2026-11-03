# Kodigo Print Agent (Windows)

This small local companion API lets the Kodigo POS list Windows printers, print 58 mm thermal receipts, and send an ESC/POS cash-drawer pulse without QZ Tray. It binds only to `127.0.0.1`; Vercel continues to host the web app, while each checkout computer runs its own agent.

Thermal receipts are formatted by the agent and submitted directly to the selected Windows printer, without opening the browser print preview. Standard page receipts and PDF downloads remain available through the browser flow.

## Build a Windows package

From the `kodigo-ui` directory, publish and package a self-contained Windows x64 build:

```powershell
npm run publish:print-agent
```

The command creates `print-agent/Kodigo-Print-Agent-win-x64.zip`.

## Install and pair a POS computer

1. Install the Xprinter driver in Windows and print a Windows test page.
2. Connect the cash drawer to the printer's drawer port. The drawer and printer must support the standard ESC/POS drawer pulse on pin 2.
3. Extract the package to a stable folder, such as `C:\KodigoPrintAgent`.
4. Right-click `Install-Agent.ps1` and run it with PowerShell. It creates a random one-time display token, installs a per-user startup shortcut, and starts the agent hidden.
5. In Kodigo, open **Settings → POS hardware**, enter the token printed by the install script, and connect this computer. In Chromium-based browsers, allow the site's local network access prompt when asked.
6. Find the XP-58, save it on this computer, and use **Test drawer**. A test pulse can open the drawer.

The pairing token is stored in Kodigo's local browser storage. The agent stores only its SHA-256 hash under the signed-in Windows user's Local AppData folder. The agent accepts browser requests only from `https://kodigo-blue.vercel.app` and the local Vite development origins by default. To use another trusted origin, set `KODIGO_PRINT_ALLOWED_ORIGINS` to a comma-separated exact-origin list before starting the agent.

To replace a lost or compromised pairing token, run `Kodigo.PrintAgent.exe --rotate-pairing-token` from the extracted folder and enter the newly displayed token in Kodigo. The previous token stops working immediately.

## API

All endpoints require `Authorization: Bearer <pairing-token>` and only accept the configured website origins:

- `GET http://127.0.0.1:17831/v1/health`
- `GET http://127.0.0.1:17831/v1/printers`
- `POST http://127.0.0.1:17831/v1/receipts/print` with `{ "printerName": "Xprinter XP-58", "saleId": "<sale uuid>", "reprint": false, "receipt": { ...saved receipt snapshot... } }`
- `POST http://127.0.0.1:17831/v1/drawer/pulse` with `{ "printerName": "Xprinter XP-58", "saleId": "<sale uuid>" }`
- `POST http://127.0.0.1:17831/v1/drawer/test` with `{ "printerName": "Xprinter XP-58" }`

Automatic receipt jobs and drawer pulses are idempotent per sale ID on that computer. Explicit receipt reprints are allowed. The API validates the selected Windows printer, confirms the receipt sale ID matches the request, and formats only known receipt fields into fixed ESC/POS commands; callers cannot submit arbitrary printer bytes. Currency prints as `PHP 1,234.50` for broad thermal-printer code-page compatibility.

## Limits

- Windows x64 only for this first version.
- A successful spooler response means Windows accepted the print job; it cannot prove that the receipt physically printed. Check the first job at the printer.
- The XP-58 driver must accept RAW spool jobs for direct thermal printing. If it does not, use the browser's standard print flow or adjust the Windows driver/printer configuration.
- If the drawer needs pin 5, a nonstandard pulse duration, or the printer driver does not accept RAW spool data, the printer/drawer model's documentation is needed to adjust the fixed command safely.
- Public websites connecting to loopback may trigger a browser Local Network Access permission prompt. That browser permission is separate from the agent's pairing token.
