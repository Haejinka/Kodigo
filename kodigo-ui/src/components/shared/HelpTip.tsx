import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

/** Small "?" button that opens a short explanation. Works with click, tap and keyboard. */
export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') setOpen(false); return; }
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-5 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <span role="tooltip" className="absolute right-0 top-6 z-30 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-left text-xs font-normal leading-5 text-[var(--foreground)] shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
