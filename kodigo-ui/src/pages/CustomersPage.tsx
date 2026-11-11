import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  LoaderCircle,
  Mail,
  Phone,
  Plus,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  archiveCustomer,
  buildArchiveCustomerCommand,
  buildCreateCustomerCommand,
  buildUpdateCustomerCommand,
  createCustomer,
  getCustomer,
  searchCustomers,
  updateCustomer,
} from '@/lib/customers';
import { useAuthStore } from '@/stores/authStore';
import type { CustomerOperationCommand, CustomerProfile, CustomerSummary } from '@/types/customers';

interface CustomerFormValues {
  displayName: string;
  phone: string;
  email: string;
}

const emptyForm: CustomerFormValues = { displayName: '', phone: '', email: '' };

function customerErrorMessage(error: unknown): string {
  const candidate = error as { code?: string; message?: string } | null;
  const message = candidate?.message ?? '';
  const code = candidate?.code ?? '';

  if (error instanceof TypeError) return error.message;
  if (code === '42501' || /MFA_REQUIRED|STORE_FORBIDDEN|CAPABILITY_REQUIRED/.test(message)) {
    return 'Your account is not allowed to manage customer profiles in this store, or your secure session needs refreshing.';
  }
  if (/VERSION_CONFLICT|OPERATION_CONFLICT/.test(message)) {
    return 'This profile changed in another session. Reload it and apply your update again.';
  }
  return 'The request could not be confirmed. Retry the same request before changing its details.';
}

function hasDefinitiveHttpResponse(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function formatProfileDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

export function CustomersPage() {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const storeId = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null;

  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerProfile | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [form, setForm] = useState<CustomerFormValues>(emptyForm);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const pendingProfileCommand = useRef<CustomerOperationCommand | null>(null);
  const pendingArchiveCommand = useRef<CustomerOperationCommand | null>(null);
  const [profileCommandUncertain, setProfileCommandUncertain] = useState(false);
  const [archiveCommandUncertain, setArchiveCommandUncertain] = useState(false);

  useEffect(() => {
    setQuery('');
    setCustomers([]);
    setSelectedId(null);
    setSelectedCustomer(null);
    setSearchError(null);
    setActionError(null);
    setSuccessMessage(null);
  }, [storeId]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    setSearchError(null);
    setCustomers([]);
    if (!storeId || normalizedQuery.length < 2) {
      setIsSearching(false);
      return undefined;
    }

    let current = true;
    setIsSearching(true);
    const timeout = window.setTimeout(() => {
      void searchCustomers(storeId, normalizedQuery, 20)
        .then((results) => {
          if (current) setCustomers(results);
        })
        .catch((error: unknown) => {
          if (current) setSearchError(customerErrorMessage(error));
        })
        .finally(() => {
          if (current) setIsSearching(false);
        });
    }, 250);

    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [query, refreshKey, storeId]);

  useEffect(() => {
    if (!storeId || !selectedId) {
      setSelectedCustomer(null);
      setIsLoadingProfile(false);
      return undefined;
    }

    let current = true;
    setSelectedCustomer(null);
    setIsLoadingProfile(true);
    setActionError(null);
    void getCustomer(storeId, selectedId)
      .then((profile) => {
        if (current) setSelectedCustomer(profile);
      })
      .catch((error: unknown) => {
        if (current) setActionError(customerErrorMessage(error));
      })
      .finally(() => {
        if (current) setIsLoadingProfile(false);
      });

    return () => {
      current = false;
    };
  }, [selectedId, storeId]);

  const openCreate = () => {
    setEditingCustomer(null);
    setForm(emptyForm);
    pendingProfileCommand.current = null;
    setProfileCommandUncertain(false);
    setActionError(null);
    setEditorOpen(true);
  };

  const openEdit = (customer: CustomerProfile) => {
    setEditingCustomer(customer);
    setForm({
      displayName: customer.display_name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
    });
    pendingProfileCommand.current = null;
    setProfileCommandUncertain(false);
    setActionError(null);
    setEditorOpen(true);
  };

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!storeId) return;
    setIsSaving(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const command = pendingProfileCommand.current ?? (editingCustomer
        ? buildUpdateCustomerCommand({
          storeId,
          customerId: editingCustomer.id,
          expectedVersion: editingCustomer.version,
          displayName: form.displayName,
          phone: form.phone || null,
          email: form.email || null,
        })
        : buildCreateCustomerCommand({
          storeId,
          displayName: form.displayName,
          phone: form.phone || null,
          email: form.email || null,
        }));
      pendingProfileCommand.current = command;

      const result = editingCustomer
        ? await updateCustomer(command)
        : await createCustomer(command);
      pendingProfileCommand.current = null;
      setProfileCommandUncertain(false);
      setEditorOpen(false);
      setQuery(form.displayName.trim());
      setSelectedId(result.aggregate_id);
      setRefreshKey((key) => key + 1);
      setSuccessMessage(editingCustomer ? 'Customer profile updated.' : 'Customer profile created.');
    } catch (error) {
      setActionError(customerErrorMessage(error));
      if (hasDefinitiveHttpResponse(error)) {
        pendingProfileCommand.current = null;
        setProfileCommandUncertain(false);
      } else {
        setProfileCommandUncertain(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const submitArchive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!storeId || !selectedCustomer) return;
    setIsArchiving(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const command = pendingArchiveCommand.current ?? buildArchiveCustomerCommand({
        storeId,
        customerId: selectedCustomer.id,
        expectedVersion: selectedCustomer.version,
        reason: archiveReason,
      });
      pendingArchiveCommand.current = command;
      await archiveCustomer(command);
      pendingArchiveCommand.current = null;
      setArchiveCommandUncertain(false);
      setArchiveOpen(false);
      setSelectedId(null);
      setSelectedCustomer(null);
      setRefreshKey((key) => key + 1);
      setSuccessMessage('Customer profile archived. Existing sales and receipts were not changed.');
    } catch (error) {
      setActionError(customerErrorMessage(error));
      if (hasDefinitiveHttpResponse(error)) {
        pendingArchiveCommand.current = null;
        setArchiveCommandUncertain(false);
      } else {
        setArchiveCommandUncertain(true);
      }
    } finally {
      setIsArchiving(false);
    }
  };

  const updateForm = (key: keyof CustomerFormValues, value: string) => {
    if (profileCommandUncertain) return;
    pendingProfileCommand.current = null;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateArchiveReason = (value: string) => {
    if (archiveCommandUncertain) return;
    pendingArchiveCommand.current = null;
    setArchiveReason(value);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <UsersRound className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
            Search this store’s customer profiles. Guest checkout remains available, and customer profiles do not rewrite past receipts.
          </p>
        </div>
        <Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={openCreate} disabled={!storeId}>
          Add customer
        </Button>
      </div>

      {successMessage && (
        <div role="status" className="rounded-lg border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          {successMessage}
        </div>
      )}
      {actionError && !editorOpen && !archiveOpen && (
        <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>
      )}

      {!storeId ? (
        <Card className="p-5">
          <EmptyState
            icon={UsersRound}
            title="Choose one store"
            description="Customer profiles belong to a single store. Select a store in the header to continue."
          />
        </Card>
      ) : (
        <>
          <Card className="p-4 sm:p-5">
            <Label htmlFor="customer-search">Find a customer</Label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden="true" />
              <Input
                id="customer-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId(null);
                  setSelectedCustomer(null);
                  setActionError(null);
                }}
                autoComplete="off"
                maxLength={80}
                placeholder="Search by customer name or exact phone number"
                className="pl-10"
              />
              {isSearching && <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[var(--muted-foreground)]" aria-label="Searching" />}
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Enter at least 2 characters. Search results show names only; contact details are available to authorized store managers.
            </p>
          </Card>

          {searchError && <Alert variant="destructive"><AlertDescription>{searchError}</AlertDescription></Alert>}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <Card className="min-h-80 overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--foreground)]">Search results</h2>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {isSearching ? 'Searching profiles…' : `${customers.length} ${customers.length === 1 ? 'match' : 'matches'}`}
                  </p>
                </div>
              </div>
              {query.trim().length < 2 ? (
                <EmptyState icon={Search} title="Start with a name or phone" description="Customer profiles stay scoped to the selected store." />
              ) : isSearching && customers.length === 0 ? (
                <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]" role="status">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Searching…
                </div>
              ) : customers.length === 0 && !searchError ? (
                <EmptyState icon={UsersRound} title="No matching customers" description="Try another search, or add a profile if the customer wants one." />
              ) : (
                <ul className="divide-y divide-[var(--border)]" aria-label="Customer search results">
                  {customers.map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        aria-current={selectedId === customer.id ? 'true' : undefined}
                        onClick={() => setSelectedId(customer.id)}
                        className={`flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--muted)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] ${selectedId === customer.id ? 'bg-[var(--primary-soft)]/35' : ''}`}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                          <UserRound className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">{customer.display_name}</span>
                        <span className="text-xs font-medium text-[var(--primary)]">View</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="min-h-80 p-5">
              {isLoadingProfile ? (
                <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]" role="status">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading authorized profile…
                </div>
              ) : selectedCustomer ? (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                        <UserRound className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-[var(--foreground)]">{selectedCustomer.display_name}</h2>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Customer profile · version {selectedCustomer.version}</p>
                      </div>
                    </div>
                    {selectedCustomer.active && (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Active</span>
                    )}
                  </div>

                  <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                    <div className="flex items-center gap-3 px-3 py-3">
                      <Phone className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <dt className="text-xs text-[var(--muted-foreground)]">Phone</dt>
                        <dd className="mt-0.5 break-words text-sm text-[var(--foreground)]">{selectedCustomer.phone || 'Not provided'}</dd>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-3 py-3">
                      <Mail className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <dt className="text-xs text-[var(--muted-foreground)]">Email</dt>
                        <dd className="mt-0.5 break-words text-sm text-[var(--foreground)]">{selectedCustomer.email || 'Not provided'}</dd>
                      </div>
                    </div>
                    <div className="px-3 py-3">
                      <dt className="text-xs text-[var(--muted-foreground)]">Last updated</dt>
                      <dd className="mt-0.5 text-sm text-[var(--foreground)]"><time dateTime={selectedCustomer.updated_at}>{formatProfileDate(selectedCustomer.updated_at)}</time></dd>
                    </div>
                  </dl>

                  <p className="text-xs leading-5 text-[var(--muted-foreground)]">
                    Save only contact details the customer chooses to share. Customer profiles do not add TIN or address data, and past receipts stay unchanged.
                  </p>

                  <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                    <Button variant="outline" onClick={() => openEdit(selectedCustomer)} disabled={!selectedCustomer.active}>Edit profile</Button>
                    {selectedCustomer.active && (
                      <Button variant="ghost" icon={<Archive className="size-4" aria-hidden="true" />} onClick={() => {
                        setArchiveReason('');
                        pendingArchiveCommand.current = null;
                        setArchiveCommandUncertain(false);
                        setActionError(null);
                        setArchiveOpen(true);
                      }}>
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={UsersRound}
                  title="Select a customer"
                  description="Profile contact details load only after you select a search result and the server authorizes access."
                />
              )}
            </Card>
          </div>
        </>
      )}

      <Dialog open={editorOpen} onOpenChange={(open) => {
        if (!profileCommandUncertain) setEditorOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Edit customer profile' : 'Add customer'}</DialogTitle>
            <DialogDescription>
              Profiles belong to this store. Adding or changing a profile never edits an existing sale or receipt.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submitProfile(event)}>
            {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
            {profileCommandUncertain && (
              <Alert><AlertDescription>Retry this exact request to check its result. The form is locked to prevent a second customer command.</AlertDescription></Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="customer-display-name">Customer name</Label>
              <Input id="customer-display-name" value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} maxLength={100} autoComplete="name" required disabled={isSaving || profileCommandUncertain} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customer-phone">Phone <span className="font-normal text-[var(--muted-foreground)]">· optional</span></Label>
                <Input id="customer-phone" type="tel" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} maxLength={40} autoComplete="tel" disabled={isSaving || profileCommandUncertain} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-email">Email <span className="font-normal text-[var(--muted-foreground)]">· optional</span></Label>
                <Input id="customer-email" type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} maxLength={254} autoComplete="email" disabled={isSaving || profileCommandUncertain} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={isSaving || profileCommandUncertain}>Cancel</Button>
              <Button type="submit" loading={isSaving} disabled={profileCommandUncertain && isSaving}>
                {editingCustomer ? 'Save changes' : 'Create profile'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={(open) => {
        if (!archiveCommandUncertain) setArchiveOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive customer profile?</DialogTitle>
            <DialogDescription>
              {selectedCustomer?.display_name} will no longer appear in active customer search. Sales, financial records, and receipts are kept as they are.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submitArchive(event)}>
            {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
            {archiveCommandUncertain && (
              <Alert><AlertDescription>Retry this same archive request to check its result. The reason is locked until the server confirms the outcome.</AlertDescription></Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="customer-archive-reason">Reason</Label>
              <Textarea id="customer-archive-reason" value={archiveReason} onChange={(event) => updateArchiveReason(event.target.value)} minLength={3} maxLength={500} required disabled={isArchiving || archiveCommandUncertain} placeholder="Why is this profile being archived?" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)} disabled={isArchiving || archiveCommandUncertain}>Keep active</Button>
              <Button type="submit" variant="danger" loading={isArchiving} disabled={!selectedCustomer || (archiveCommandUncertain && isArchiving)}>Archive profile</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
