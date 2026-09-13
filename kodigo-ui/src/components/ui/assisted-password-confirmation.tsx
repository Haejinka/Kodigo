import { motion } from 'framer-motion';
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { cn } from '@/lib/utils';

interface AssistedPasswordConfirmationProps {
  password: string;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function AssistedPasswordConfirmation({
  password,
  confirmPassword,
  onConfirmPasswordChange,
  id,
  label = 'Confirm password',
  disabled = false,
  className,
}: AssistedPasswordConfirmationProps) {
  const generatedId = useId();
  const inputId = id ?? `password-confirmation-${generatedId}`;
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!shake) return undefined;
    const timer = window.setTimeout(() => setShake(false), 500);
    return () => window.clearTimeout(timer);
  }, [shake]);

  const handleConfirmPasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (confirmPassword.length >= password.length && nextValue.length > confirmPassword.length) {
      setShake(true);
      return;
    }
    onConfirmPasswordChange(nextValue);
  };

  const getLetterStatus = (index: number) => {
    if (!confirmPassword[index]) return '';
    return confirmPassword[index] === password[index]
      ? 'bg-[var(--success-soft)]'
      : 'bg-[var(--destructive-soft)]';
  };

  const passwordsMatch = Boolean(password) && password === confirmPassword;
  const hasPassword = password.length > 0;
  const statusText = passwordsMatch
    ? 'Passwords match.'
    : confirmPassword.length > 0
      ? 'Keep typing until the confirmation matches.'
      : 'Your confirmation will be checked as you type.';

  const bounceAnimation = {
    x: shake ? [-10, 10, -10, 10, 0] : 0,
    transition: { duration: 0.5 },
  };

  const matchAnimation = {
    scale: passwordsMatch ? [1, 1.02, 1] : 1,
    transition: { duration: 0.3 },
  };

  const borderAnimation = {
    borderColor: passwordsMatch ? 'var(--success)' : 'var(--border)',
    transition: { duration: 0.3 },
  };

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={inputId} className="block text-sm font-medium text-[var(--foreground)]">
        {label}
      </label>

      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2"
        aria-label="Password confirmation preview"
        aria-hidden="true"
      >
        <div className="flex min-h-5 items-center gap-1 overflow-hidden">
          {hasPassword ? password.split('').map((_, index) => (
            <motion.span
              key={index}
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--border)] transition-colors',
                getLetterStatus(index),
              )}
              animate={{ scale: confirmPassword[index] ? [1, 1.15, 1] : 1 }}
              transition={{ duration: 0.2 }}
            />
          )) : (
            <span className="text-xs text-[var(--muted-foreground)]">Enter a password above to see the match preview.</span>
          )}
        </div>
      </div>

      <motion.div
        className="overflow-hidden rounded-xl border-2 bg-[var(--background)]"
        animate={{ ...bounceAnimation, ...matchAnimation, ...borderAnimation }}
      >
        <PasswordInput
          id={inputId}
          value={confirmPassword}
          onChange={handleConfirmPasswordChange}
          visibilityLabel={label.toLowerCase()}
          autoComplete="new-password"
          disabled={disabled}
          required
          aria-describedby={`${inputId}-hint`}
          className="h-12 border-0 bg-transparent px-3.5 py-3 pr-12 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0"
          placeholder="Re-enter your password"
        />
      </motion.div>

      <p id={`${inputId}-hint`} className={cn('text-xs', passwordsMatch ? 'text-[var(--success-foreground)]' : 'text-[var(--muted-foreground)]')}>
        {statusText}
      </p>
    </div>
  );
}
