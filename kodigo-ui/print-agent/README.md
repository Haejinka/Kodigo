# Kodigo Print Agent (Windows)

This small local companion API lets Kodigo list Windows printers, print 58 mm thermal receipts and shopping lists on 58 mm or 80 mm paper, and send an ESC/POS cash-drawer pulse without QZ Tray. It binds only to `127.0.0.1`; Vercel continues to host the web app, while each checkout computer runs its own agent.

Thermal receipts are formatted by the agent and submitted directly to the selected Windows printer, without opening the browser print preview. Standard page receipts and PDF downloads remain available through the browser flow.

## Build the one-click Windows setup

From the `kodigo-ui` directory, publish and package a self-contained Windows x64 build:

```powershell
npm run publish:print-agent
```

The command creates `print-agent/Kodigo-Print-Setup-win-x64.exe`.

## Install and pair a POS computer

1. Install the Xprinter driver in Windows and print a Windows test page.
2. Double-click `Kodigo-Print-Setup-win-x64.exe`. It installs under the current Windows account, starts at sign-in, and opens Kodigo. Administrator access and PowerShell are not required.
3. When you are signed in as a store admin, Kodigo connects automatically. It selects the XP-58 when detected; otherwise choose the printer connected to the receipt paper and drawer. If the browser asks for local network access, choose Allow.
4. Connect the cash drawer to the printer's drawer port, then click **Test drawer**. A test pulse can open the drawer.

The browser receives a random pairing token from the local agent after the user clicks **Connect this computer**. The agent stores only its SHA-256 hash under the Windows user's Local AppData folder. Pairing requests require the exact Kodigo website origin; all printer commands also require the token. By default, the agent allows `https://kodigo-blue.vercel.app` and local Vite development origins.

If the browser pairing is forgotten, click **Connect this computer** again. The agent creates a new token and invalidates the previous one.

## API

All endpoints only accept the configured website origins. Pairing is the sole endpoint that does not require a token; it returns one after a user starts setup from the Kodigo website. All device actions require `Authorization: Bearer <pairing-token>`:

- `POST http://127.0.0.1:17831/v1/pair` returns `{ "token": "..." }` for the exact approved website origin.
- `GET http://127.0.0.1:17831/v1/health`
- `GET http://127.0.0.1:17831/v1/printers`
- `GET http://127.0.0.1:17831/v1/capabilities` returns supported document types, paper profiles, and the shopping-list item limit (50).
- `POST http://127.0.0.1:17831/v1/receipts/print` with `{ "printerName": "Xprinter XP-58", "saleId": "<sale uuid>", "reprint": false, "receipt": { ...saved receipt snapshot... } }`
- `POST http://127.0.0.1:17831/v1/documents/shopping-list/print` with `{ "printerName": "Xprinter XP-58", "document_id": "<document uuid>", "attempt_id": "<attempt uuid>", "document_hash": "<sha256>", "profile": "58mm", "reprint": false, "show_prices": true, "shopping_list": { ...version 1 shopping-list snapshot... } }`
- `POST http://127.0.0.1:17831/v1/drawer/pulse` with `{ "printerName": "Xprinter XP-58", "saleId": "<sale uuid>" }`
- `POST http://127.0.0.1:17831/v1/drawer/test` with `{ "printerName": "Xprinter XP-58" }`

Automatic receipt jobs and drawer pulses are idempotent per sale ID on that computer. Shopping lists use their own bounded local document/attempt history; the same attempt cannot spool twice, changed content cannot reuse a document ID, and another copy requires an explicit reprint with a new attempt ID. The API validates the selected Windows printer and profile, recomputes the shopping-list SHA-256, and formats only known snapshot fields into fixed ESC/POS commands; callers cannot submit arbitrary printer bytes. Shopping lists never issue a drawer pulse or modify receipt history. Currency prints as `PHP 1,234.50` for broad thermal-printer code-page compatibility. Windows acceptance confirms spool submission only, not physical output.

## Limits

- Windows x64 only for this first version.
- The agent checks Windows printer status before submitting jobs and reports printers marked offline, paused, or unavailable. A successful spooler response means Windows accepted the print job; it cannot prove that the receipt physically printed or that the cash drawer opened.
- The selected printer driver must accept RAW spool jobs for direct thermal printing. Check paper width before choosing a shopping-list profile. If it does not, use browser printing or adjust the Windows driver/printer configuration.
- If the drawer needs pin 5, a nonstandard pulse duration, or the printer driver does not accept RAW spool data, the printer/drawer model's documentation is needed to adjust the fixed command safely.
- Public websites connecting to loopback may trigger a browser Local Network Access permission prompt. That browser permission is separate from the agent's pairing token.
