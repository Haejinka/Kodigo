import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !loading) onCancel(); }}>
      <DialogContent onInteractOutside={(event) => { if (loading) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }}>
        <DialogHeader className="pr-8">
          {danger && (
            <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-[var(--destructive-border)] bg-[var(--destructive-soft)] text-[var(--destructive)]">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} type="button" onClick={onConfirm} loading={loading}>{loading ? 'Processing…' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
