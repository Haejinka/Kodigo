import { useEffect, useRef } from 'react';

interface BarcodeInputProps {
  onScan: (barcode: string) => void;
  /** Called as soon as rapid scanner input is detected (2nd rapid char).
   *  Use this to reset any pending quantity so barcode digits don't inflate it. */
  onScanStart?: () => void;
  disabled?: boolean;
}

/**
 * Hidden input that captures USB/Bluetooth barcode scanner keystrokes.
 * Scanners typically fire rapid keydown events followed by Enter.
 * We collect characters and fire onScan when Enter is received.
 *
 * Registered in the CAPTURE phase so it intercepts keys before they reach
 * focused <input> elements. From the 2nd rapid char onwards, events are
 * stopped so the barcode doesn't pollute the search field or qty counter.
 */
export function BarcodeInput({ onScan, onScanStart, disabled }: BarcodeInputProps) {
  const bufferRef = useRef('');
  const lastKeyTime = useRef(0);
  const scanStartFiredRef = useRef(false);
  const SCANNER_THRESHOLD_MS = 50; // scanners fire chars < 50ms apart

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeSinceLast = now - lastKeyTime.current;
      const hasBuffer = bufferRef.current.length > 0;
      const isRapid = hasBuffer && timeSinceLast < SCANNER_THRESHOLD_MS;

      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) {
          // Remove any barcode chars that leaked into a focused input before we
          // started blocking (only the very first char can leak through).
          const active = document.activeElement as HTMLInputElement | null;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            const val = active.value ?? '';
            const buf = bufferRef.current;
            for (let i = Math.min(buf.length, val.length); i >= 1; i--) {
              if (val.endsWith(buf.slice(0, i))) {
                const newVal = val.slice(0, val.length - i);
                // Use the native setter so React's onChange fires correctly.
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                )?.set;
                nativeSetter?.call(active, newVal);
                active.dispatchEvent(new Event('input', { bubbles: true }));
                break;
              }
            }
          }
          onScan(bufferRef.current);
          e.preventDefault();
        }
        bufferRef.current = '';
        lastKeyTime.current = 0;
        scanStartFiredRef.current = false;
        return;
      }

      if (e.key.length === 1) {
        // Reset buffer when the gap is too long — it's manual typing, not a scanner
        if (timeSinceLast > 300 && hasBuffer) {
          bufferRef.current = '';
          scanStartFiredRef.current = false;
        }
        bufferRef.current += e.key;
        lastKeyTime.current = now;

        if (isRapid) {
          // First time we confirm scanner speed: notify parent to clear pending qty
          // so the leading barcode digit that already reached the qty listener
          // gets wiped before addItem is called.
          if (!scanStartFiredRef.current) {
            scanStartFiredRef.current = true;
            onScanStart?.();
          }
          // Block this char from reaching focused inputs and other key listeners.
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Capture phase — fires before the event reaches any focused <input>.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onScan, onScanStart, disabled]);

  return null; // Hidden component — no UI
}
