import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleDollarSign, Clock3, Smartphone, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { createOperationId } from '@/lib/pos-operations';
import {
  buildManualDigitalServiceCommand,
  createDigitalProviderAccount,
  createDigitalServiceProduct,
  applyDigitalWalletAdjustment,
  decideDigitalWalletAdjustment,
  getDigitalServiceWorkspace,
  quoteDigitalService,
  recordManualDigitalService,
  resolveManualDigitalServiceOutcome,
  requestDigitalWalletAdjustment,
} from '@/lib/digital-services';
import type {
  DigitalCommand,
  DigitalFeePolicy,
  DigitalProviderKind,
  DigitalServiceKind,
  DigitalServiceQuote,
  DigitalServiceWorkspace,
} from '@/types/digital-services';

const serviceLabels: Record<DigitalServiceKind, string> = {
  digital_product: 'Digital product',
  eload: 'E-load',
  gcash_cash_in: 'GCash cash-in',
  gcash_cash_out: 'GCash cash-out',
};

const currency = (value: string | number | null | undefined) => `₱${Number(value ?? 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

function safeMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function localDateTimeNow() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function serviceDirection(kind: DigitalServiceKind, quote: DigitalServiceQuote | null) {
  if (!quote) return null;
  switch (kind) {
    case 'eload':
      return `Collect ${currency(quote.cash_delta)} cash. After manually confirming delivery, record a ${currency(Math.abs(Number(quote.wallet_delta)))} load-wallet decrease.`;
    case 'gcash_cash_in':
      return `Collect ${currency(quote.cash_delta)} cash. After manually confirming the wallet transfer, record a ${currency(Math.abs(Number(quote.wallet_delta)))} GCash-wallet decrease.`;
    case 'gcash_cash_out':
      return `Record the customer’s incoming transfer of ${currency(Number(quote.face_amount) + Number(quote.fee_amount))}, then record ${currency(Math.abs(Number(quote.cash_delta)))} cash paid out.`;
    case 'digital_product':
      return `Record ${currency(quote.retail_amount)} cash received after delivery has been confirmed.`;
  }
}

export function DigitalServicesPage() {
  const storeId = useAuthStore((state) => state.activeStoreId);
  const role = useAuthStore((state) => state.role);
  const actorId = useAuthStore((state) => state.user?.id as string | undefined);
  const categories = useProductStore((state) => state.categories);
  const fetchCategories = useProductStore((state) => state.fetchCategories);
  const { toast } = useToast();

  const [workspace, setWorkspace] = useState<DigitalServiceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeShiftId, setActiveShiftId] = useState('');
  const [kind, setKind] = useState<DigitalServiceKind>('eload');
  const [productId, setProductId] = useState('');
  const [faceAmount, setFaceAmount] = useState('');
  const [policyCode, setPolicyCode] = useState('');
  const [providerAccountId, setProviderAccountId] = useState('');
  const [outcome, setOutcome] = useState<'confirmed' | 'failed' | 'unknown'>('confirmed');
  const [reference, setReference] = useState('');
  const [externalAt, setExternalAt] = useState(localDateTimeNow);
  const [evidenceRef, setEvidenceRef] = useState('');
  const [cashAttested, setCashAttested] = useState(false);
  const [quote, setQuote] = useState<DigitalServiceQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<DigitalCommand | null>(null);
  const [recordMessage, setRecordMessage] = useState<{ type: 'success' | 'pending'; text: string } | null>(null);

  const [accountKind, setAccountKind] = useState<DigitalProviderKind>('gcash');
  const [providerName, setProviderName] = useState('GCash');
  const [accountLabel, setAccountLabel] = useState('Store GCash wallet');
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountOperationId, setAccountOperationId] = useState('');
  const [productKind, setProductKind] = useState<DigitalServiceKind>('eload');
  const [productName, setProductName] = useState('E-load');
  const [productSku, setProductSku] = useState('DIGITAL-ELOAD');
  const [categoryId, setCategoryId] = useState('');
  const [productPrice, setProductPrice] = useState('0.00');
  const [productCost, setProductCost] = useState('0.00');
  const [minFace, setMinFace] = useState('');
  const [maxFace, setMaxFace] = useState('');
  const [additionalCharge, setAdditionalCharge] = useState('0.00');
  const [productBusy, setProductBusy] = useState(false);
  const [productOperationId, setProductOperationId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [walletAmount, setWalletAmount] = useState('');
  const [walletReason, setWalletReason] = useState('');
  const [walletRequestOperationId, setWalletRequestOperationId] = useState('');
  const [walletRequestBusy, setWalletRequestBusy] = useState(false);
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({});
  const [decisionOperationIds, setDecisionOperationIds] = useState<Record<string, string>>({});
  const [decisionBusyId, setDecisionBusyId] = useState('');
  const [applicationEvidence, setApplicationEvidence] = useState<Record<string, { reference: string; evidence: string }>>({});
  const [applicationOperationIds, setApplicationOperationIds] = useState<Record<string, string>>({});
  const [applicationBusyId, setApplicationBusyId] = useState('');
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, { reference: string; externalAt: string; evidence: string }>>({});
  const [resolutionOperationIds, setResolutionOperationIds] = useState<Record<string, string>>({});
  const [resolutionBusyId, setResolutionBusyId] = useState('');

  const reload = useCallback(async () => {
    if (!storeId || storeId === 'all') {
      setWorkspace(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const result = await getDigitalServiceWorkspace(storeId);
      setWorkspace(result);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load digital services.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const activeShifts = workspace?.active_shifts ?? [];
    setActiveShiftId((current) => activeShifts.some((shift) => shift.id === current)
      ? current
      : activeShifts[0]?.id ?? '');
  }, [workspace?.active_shifts]);
  useEffect(() => {
    if (storeId && storeId !== 'all') void fetchCategories(storeId);
  }, [storeId, fetchCategories]);
  useEffect(() => {
    if (categories.length && !categoryId) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  const productsForKind = useMemo(
    () => workspace?.products.filter((product) => product.kind === kind) ?? [],
    [kind, workspace?.products],
  );
  const selectedProduct = productsForKind.find((product) => product.id === productId) ?? productsForKind[0];
  const providerKind = kind === 'eload' ? 'load' : 'gcash';
  const accountsForKind = useMemo(
    () => (workspace?.accounts ?? []).filter((account) => account.account_kind === providerKind && account.wallet_account_id),
    [providerKind, workspace?.accounts],
  );
  const selectedAccount = accountsForKind.find((account) => account.provider_account_id === providerAccountId) ?? accountsForKind[0];
  const walletOptions = (workspace?.accounts ?? []).filter((account) => account.wallet_account_id);
  const policiesForKind = useMemo(
    () => (workspace?.fee_policies ?? []).filter((policy) => policy.service_kind === kind),
    [kind, workspace?.fee_policies],
  );
  const selectedPolicy = policiesForKind.find((policy) => policy.policy_code === policyCode)
    ?? policiesForKind.find((policy) => policy.is_default);

  useEffect(() => {
    if (selectedProduct && selectedProduct.id !== productId) setProductId(selectedProduct.id);
  }, [productId, selectedProduct]);
  useEffect(() => {
    if (kind === 'digital_product' && selectedProduct) setFaceAmount(selectedProduct.selling_price);
    if (kind !== 'digital_product' && selectedProduct?.kind !== 'digital_product') setFaceAmount('');
  }, [kind, selectedProduct]);
  useEffect(() => {
    if (selectedPolicy && policyCode !== selectedPolicy.policy_code) setPolicyCode(selectedPolicy.policy_code);
  }, [policyCode, selectedPolicy]);
  useEffect(() => {
    if (selectedAccount && selectedAccount.provider_account_id !== providerAccountId) setProviderAccountId(selectedAccount.provider_account_id);
  }, [providerAccountId, selectedAccount]);
  useEffect(() => {
    if (!walletId && walletOptions[0]?.wallet_account_id) setWalletId(walletOptions[0].wallet_account_id);
  }, [walletId, walletOptions]);

  useEffect(() => {
    let current = true;
    const normalized = faceAmount.trim();
    if (!storeId || storeId === 'all' || !selectedProduct || !normalized) {
      setQuote(null);
      setQuoteError('');
      return () => { current = false; };
    }
    const timer = window.setTimeout(() => {
      void quoteDigitalService({
        storeId,
        productId: selectedProduct.id,
        serviceKind: kind,
        faceAmount: normalized,
        policyCode: kind === 'digital_product' ? null : selectedPolicy?.policy_code ?? null,
      }).then((result) => {
        if (current) { setQuote(result); setQuoteError(''); }
      }).catch((error: unknown) => {
        if (current) {
          setQuote(null);
          setQuoteError(error instanceof Error ? error.message : 'Could not calculate this quote.');
        }
      });
    }, 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [faceAmount, kind, selectedPolicy?.policy_code, selectedProduct, storeId]);

  const changeKind = (nextKind: DigitalServiceKind) => {
    setKind(nextKind);
    setProductId('');
    setPolicyCode('');
    setProviderAccountId('');
    setQuote(null);
    setRecordMessage(null);
  };

  const submitRecord = async () => {
    if (!storeId || storeId === 'all' || !selectedProduct || !workspace?.active_shifts.length) return;
    if (!navigator.onLine) {
      setLoadError('Digital service recording is online-only. Reconnect before recording a service.');
      return;
    }
    setSubmitting(true);
    setLoadError('');
    try {
      let command = pendingCommand;
      if (!command) {
        const shift = workspace.active_shifts.find((item) => item.id === activeShiftId);
        if (!shift) throw new Error('Select an active cashier shift first.');
        command = buildManualDigitalServiceCommand({
          storeId,
          terminalId: shift.terminal_id,
          shiftId: shift.id,
          productId: selectedProduct.id,
          serviceKind: kind,
          faceAmount,
          policyCode: kind === 'digital_product' ? null : selectedPolicy?.policy_code,
          providerAccountId: kind === 'digital_product' ? null : selectedAccount?.provider_account_id,
          walletAccountId: kind === 'digital_product' ? null : selectedAccount?.wallet_account_id,
          externalOutcome: kind === 'digital_product' ? 'confirmed' : outcome,
          reference: kind === 'digital_product' ? null : reference,
          externalAt: kind === 'digital_product' ? null : externalAt,
          evidenceRef,
          cashExchangeAttested: cashAttested,
        });
        setPendingCommand(command);
      }
      const result = await recordManualDigitalService(command);
      const state = result.result.state;
      const isPending = result.outcome === 'pending_external' || state !== 'completed';
      setRecordMessage({ type: isPending ? 'pending' : 'success', text: result.result.message });
      if (isPending) toast('warning', result.result.message);
      else toast('success', 'Digital service record saved.');
      setPendingCommand(null);
      setCashAttested(false);
      setReference('');
      setEvidenceRef('');
      setOutcome('confirmed');
      setExternalAt(localDateTimeNow());
      await reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not save this service record. Retry the same record to check whether it committed.');
    } finally {
      setSubmitting(false);
    }
  };

  const addAccount = async () => {
    if (!storeId || storeId === 'all') return;
    setAccountBusy(true);
    setLoadError('');
    try {
      const operationId = accountOperationId || createOperationId();
      setAccountOperationId(operationId);
      await createDigitalProviderAccount({
        storeId,
        providerName,
        accountKind,
        accountLabel,
        maskedIdentifier,
        operationId,
      });
      setAccountOperationId('');
      toast('success', 'Manual provider account and zero-balance wallet created.');
      await reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not create provider account. Retry the same setup.');
    } finally { setAccountBusy(false); }
  };

  const addProduct = async () => {
    if (!storeId || storeId === 'all') return;
    setProductBusy(true);
    setLoadError('');
    try {
      const operationId = productOperationId || createOperationId();
      setProductOperationId(operationId);
      await createDigitalServiceProduct({
        storeId,
        kind: productKind,
        name: productName,
        sku: productSku,
        categoryId,
        sellingPrice: productPrice,
        costPrice: productCost,
        minFaceAmount: minFace || null,
        maxFaceAmount: maxFace || null,
        additionalCharge,
        operationId,
      });
      setProductOperationId('');
      toast('success', 'Non-stock digital service product created.');
      await reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not create service product. Retry the same setup.');
    } finally { setProductBusy(false); }
  };

  const requestWalletFunding = async () => {
    if (!storeId || storeId === 'all') return;
    const wallet = workspace?.accounts.find((account) => account.wallet_account_id === walletId);
    if (!wallet?.wallet_account_id) return;
    setWalletRequestBusy(true);
    setLoadError('');
    try {
      const isOpening = Number(wallet.balance ?? 0) === 0;
      const operationId = walletRequestOperationId || createOperationId();
      setWalletRequestOperationId(operationId);
      await requestDigitalWalletAdjustment({
        storeId,
        walletId: wallet.wallet_account_id,
        walletVersion: wallet.wallet_version ?? 1,
        amount: walletAmount,
        kind: isOpening ? 'opening' : 'topup',
        fundingSource: isOpening ? 'opening_balance' : 'external',
        reason: walletReason,
        operationId,
      });
      setWalletRequestOperationId('');
      setWalletAmount('');
      setWalletReason('');
      toast('success', 'Wallet funding request submitted for independent approval.');
      await reload();
    } catch (error) {
      setLoadError(safeMessage(error, 'Could not request wallet funding. Retry the same request.'));
    } finally { setWalletRequestBusy(false); }
  };

  const decideWalletRequest = async (requestId: string, requestVersion: number, choice: 'approve' | 'reject') => {
    if (!storeId || storeId === 'all') return;
    setDecisionBusyId(requestId);
    setLoadError('');
    try {
      const operationId = decisionOperationIds[requestId] || createOperationId();
      setDecisionOperationIds((current) => ({ ...current, [requestId]: operationId }));
      await decideDigitalWalletAdjustment({
        storeId, requestId, requestVersion, decision: choice,
        reason: decisionReason[requestId] || (choice === 'approve' ? 'External wallet funding evidence will be checked before application.' : 'Wallet funding request was not approved.'),
        operationId,
      });
      setDecisionOperationIds((current) => { const next = { ...current }; delete next[requestId]; return next; });
      toast('success', `Wallet adjustment ${choice === 'approve' ? 'approved' : 'rejected'}.`);
      await reload();
    } catch (error) {
      setLoadError(safeMessage(error, 'Could not decide this request. Retry the same decision.'));
    } finally { setDecisionBusyId(''); }
  };

  const applyWalletRequest = async (request: NonNullable<DigitalServiceWorkspace['wallet_adjustments']>[number]) => {
    if (!storeId || storeId === 'all' || !request.decision_id) return;
    setApplicationBusyId(request.request_id);
    setLoadError('');
    try {
      const operationId = applicationOperationIds[request.request_id] || createOperationId();
      setApplicationOperationIds((current) => ({ ...current, [request.request_id]: operationId }));
      const evidence = applicationEvidence[request.request_id];
      await applyDigitalWalletAdjustment({
        storeId,
        walletId: request.wallet_id,
        requestId: request.request_id,
        decisionId: request.decision_id,
        walletVersion: request.wallet_version,
        externalReference: evidence?.reference ?? '',
        evidenceRef: evidence?.evidence ?? '',
        operationId,
      });
      setApplicationOperationIds((current) => { const next = { ...current }; delete next[request.request_id]; return next; });
      toast('success', 'Wallet balance updated from the approved external funding record.');
      await reload();
    } catch (error) {
      setLoadError(safeMessage(error, 'Could not apply this approved request. Retry the same application.'));
    } finally { setApplicationBusyId(''); }
  };

  const resolveRecord = async (record: NonNullable<DigitalServiceWorkspace['records']>[number]) => {
    if (!storeId || storeId === 'all') return;
    const draft = resolutionDrafts[record.id];
    if (!draft) return;
    setResolutionBusyId(record.id);
    setLoadError('');
    try {
      const operationId = resolutionOperationIds[record.id] || createOperationId();
      setResolutionOperationIds((current) => ({ ...current, [record.id]: operationId }));
      const result = await resolveManualDigitalServiceOutcome({
        storeId,
        serviceId: record.id,
        serviceVersion: record.version,
        reference: draft.reference,
        externalAt: draft.externalAt,
        evidenceRef: draft.evidence,
        operationId,
      });
      setResolutionOperationIds((current) => { const next = { ...current }; delete next[record.id]; return next; });
      const pending = result.outcome === 'pending_external' || result.result.state !== 'completed';
      setRecordMessage({ type: pending ? 'pending' : 'success', text: result.result.message });
      toast(pending ? 'warning' : 'success', result.result.message);
      await reload();
    } catch (error) {
      setLoadError(safeMessage(error, 'Could not resolve this provider outcome. Retry the same confirmation.'));
    } finally { setResolutionBusyId(''); }
  };

  if (storeId === 'all' || !storeId) {
    return <div className="px-4 py-8"><Alert><AlertDescription>Select one store to use digital services.</AlertDescription></Alert></div>;
  }

  const isAdmin = role === 'admin';
  const accountLocked = Boolean(accountOperationId);
  const productLocked = Boolean(productOperationId);
  const currentShift = workspace?.active_shifts.find((shift) => shift.id === activeShiftId);
  const selectedWallet = selectedAccount?.available_balance;
  const totalEarnings = (workspace?.records ?? []).reduce((sum, record) => sum + Number(record.earning_amount ?? 0), 0);
  const unresolvedCount = (workspace?.records ?? []).filter((record) => record.state === 'needs_reconciliation').length;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Digital services" subtitle="Record e-load, GCash cash-in/out, and digital product transactions after manual confirmation. This screen never sends transfers." />

      {loadError && <Alert variant="destructive" className="mb-5"><AlertDescription>{loadError}</AlertDescription></Alert>}
      {recordMessage && <Alert className={`mb-5 ${recordMessage.type === 'pending' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>
        {recordMessage.type === 'pending' && <AlertTriangle className="h-4 w-4" />}
        <AlertDescription>{recordMessage.text}</AlertDescription>
      </Alert>}

      <section aria-label="Digital service overview" className="mb-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Smartphone} label="Manual records" value={String(workspace?.records.length ?? 0)} detail="Recent transactions" />
        <SummaryCard icon={CircleDollarSign} label="Recorded earnings" value={currency(totalEarnings)} detail="Completed services only" />
        <SummaryCard icon={Clock3} label="Needs review" value={String(unresolvedCount)} detail="Unknown or incomplete outcome" />
      </section>

      {loading ? <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]" role="status">Loading digital service workspace…</div> : !workspace ? null : (
        <>
          {!workspace.enabled && <Alert className="mb-6 border-amber-300 bg-amber-50 text-amber-950">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Recording is disabled for this store until digital services and its cash, approval, and operations prerequisites are released. The setup panels below are available to store admins where operations are enabled.</AlertDescription>
          </Alert>}
          {workspace.enabled && !currentShift && <Alert className="mb-6 border-sky-300 bg-sky-50 text-sky-950">
            <AlertDescription>Open an active cashier shift before recording services. Cash effects are attached to the assigned drawer.</AlertDescription>
          </Alert>}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm sm:p-6" aria-labelledby="record-digital-title">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="record-digital-title" className="text-lg font-semibold text-[var(--foreground)]">Record a service</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">Use this after the cash exchange and manual provider check actually happened.</p>
                </div>
                {workspace.active_shifts.length > 1 ? <Field label="Cashier shift">
                  <select value={currentShift?.id ?? ''} onChange={(event) => setActiveShiftId(event.target.value)} className={inputClass} disabled={Boolean(pendingCommand)}>
                    {workspace.active_shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.cashier_name} · {shift.terminal_id.slice(0, 8)}</option>)}
                  </select>
                </Field> : <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--muted-foreground)]">{currentShift ? `Shift · ${currentShift.cashier_name}` : 'No active shift'}</span>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Service type">
                  <select value={kind} onChange={(event) => changeKind(event.target.value as DigitalServiceKind)} disabled={Boolean(pendingCommand)} className={inputClass}>
                    {Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Service product">
                  <select value={selectedProduct?.id ?? ''} onChange={(event) => setProductId(event.target.value)} disabled={!productsForKind.length || Boolean(pendingCommand)} className={inputClass}>
                    {productsForKind.length === 0 && <option value="">No active product configured</option>}
                    {productsForKind.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                  </select>
                </Field>
                <Field label={kind === 'digital_product' ? 'Retail price' : 'Service principal'}>
                  <Input inputMode="decimal" value={faceAmount} onChange={(event) => setFaceAmount(event.target.value)} placeholder="0.00" disabled={Boolean(pendingCommand)} />
                </Field>
                {kind !== 'digital_product' && <Field label="Fee policy">
                  <select value={selectedPolicy?.policy_code ?? ''} onChange={(event) => setPolicyCode(event.target.value)} disabled={!policiesForKind.length || Boolean(pendingCommand)} className={inputClass}>
                    {policiesForKind.map((policy) => <option key={`${policy.id}-${policy.version}`} value={policy.policy_code}>{policyLabel(policy)}</option>)}
                  </select>
                </Field>}
                {kind !== 'digital_product' && <Field label="Provider wallet">
                  <select value={selectedAccount?.provider_account_id ?? ''} onChange={(event) => setProviderAccountId(event.target.value)} disabled={!accountsForKind.length || Boolean(pendingCommand)} className={inputClass}>
                    {accountsForKind.length === 0 && <option value="">No provider wallet configured</option>}
                    {accountsForKind.map((account) => <option key={account.provider_account_id} value={account.provider_account_id}>{account.account_label} · available {currency(account.available_balance)}</option>)}
                  </select>
                </Field>}
                {kind !== 'digital_product' && <Field label="Manual provider outcome">
                  <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} disabled={Boolean(pendingCommand)} className={inputClass}>
                    <option value="confirmed">Confirmed manually</option>
                    <option value="unknown">Unknown · needs review</option>
                    <option value="failed">Provider reported failure</option>
                  </select>
                </Field>}
                {kind !== 'digital_product' && <Field label="External reference" hint="Required when confirmed. Case and leading zeroes are preserved.">
                  <Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} autoComplete="off" placeholder="Provider receipt/reference" disabled={Boolean(pendingCommand) || outcome !== 'confirmed'} />
                </Field>}
                {kind !== 'digital_product' && <Field label="Provider transaction time">
                  <Input type="datetime-local" value={externalAt} onChange={(event) => setExternalAt(event.target.value)} disabled={Boolean(pendingCommand) || outcome !== 'confirmed'} />
                </Field>}
                <Field label={kind === 'digital_product' ? 'Delivery evidence reference' : 'Evidence reference'} hint="Use an internal note or private evidence identifier. Never enter a PIN or OTP.">
                  <Input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} maxLength={200} autoComplete="off" placeholder="Receipt photo ID or audit note" disabled={Boolean(pendingCommand)} />
                </Field>
              </div>

              {kind !== 'digital_product' && <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={cashAttested} onChange={(event) => setCashAttested(event.target.checked)} disabled={Boolean(pendingCommand)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>I confirm the physical cash amount was actually received or paid out as shown below.</span>
              </label>}
              {kind === 'digital_product' && <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={cashAttested} onChange={(event) => setCashAttested(event.target.checked)} disabled={Boolean(pendingCommand)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>I confirm the digital product was delivered and the shown cash payment was received.</span>
              </label>}

              {quote && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4" aria-live="polite">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-[var(--foreground)]">Quote snapshot</h3>
                  {kind !== 'digital_product' && <span className="text-xs text-[var(--muted-foreground)]">{selectedPolicy?.policy_code} · v{selectedPolicy?.version}</span>}
                </div>
                <p className="mt-2 text-sm text-[var(--foreground)]">{serviceDirection(kind, quote)}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="Customer fee / extra" value={currency(kind === 'eload' ? quote.additional_charge_amount : quote.fee_amount)} />
                  <Metric label="Retail amount" value={currency(quote.retail_amount)} />
                  <Metric label="Expected earning" value={currency(quote.earning_amount)} />
                </div>
                {kind !== 'digital_product' && <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">GCash principal is tracked separately from customer spending. A pending or unknown provider result will not count as earned income.</p>}
              </div>}
              {quoteError && <p className="mt-3 text-sm text-[var(--destructive)]" role="status">{quoteError}</p>}
              {kind !== 'digital_product' && selectedWallet && Number(quote?.wallet_delta ?? 0) < 0 && Number(selectedWallet) < Math.abs(Number(quote?.wallet_delta ?? 0)) && <p className="mt-3 text-sm text-amber-800">The available wallet balance is below the quoted debit. Do not complete an e-load/cash-in transfer from this account.</p>}

              {pendingCommand && <Alert className="mt-4 border-sky-300 bg-sky-50 text-sky-950"><AlertDescription>This record may have committed already. Retry with the same operation ID before starting another service.</AlertDescription></Alert>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={() => void submitRecord()} loading={submitting} disabled={!workspace.enabled || !currentShift || !selectedProduct || !quote || Boolean(quoteError) || !cashAttested || !evidenceRef.trim() || (kind !== 'digital_product' && (!selectedAccount || !selectedPolicy || (outcome === 'confirmed' && (!reference.trim() || !externalAt))) )}>
                  {pendingCommand ? 'Retry same record' : 'Save manual record'}
                </Button>
                {!workspace.enabled && <span className="text-xs text-[var(--muted-foreground)]">Recording is disabled for this store.</span>}
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="wallets-title">
                <div className="mb-4 flex items-center gap-2"><Wallet className="h-5 w-5 text-[var(--primary)]" /><h2 id="wallets-title" className="font-semibold text-[var(--foreground)]">Provider accounts and wallets</h2></div>
                {workspace.accounts.length ? <div className="space-y-3">
                  {workspace.accounts.map((account) => <div key={account.provider_account_id} className="rounded-xl border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-2"><div><p className="font-medium text-[var(--foreground)]">{account.account_label}</p><p className="text-xs text-[var(--muted-foreground)]">{account.provider_name}{account.masked_identifier ? ` · ${account.masked_identifier}` : ''}</p></div><span className="text-xs text-[var(--muted-foreground)]">{account.wallet_type ?? 'provider'}</span></div>
                    {account.wallet_account_id && <div className="mt-2 flex justify-between text-sm"><span>Balance / available</span><span className="font-medium tabular-nums">{currency(account.balance)} / {currency(account.available_balance)}</span></div>}
                  </div>)}
                </div> : <p className="text-sm text-[var(--muted-foreground)]">No manual provider accounts are set up yet.</p>}
                {isAdmin && <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Record wallet funding</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">Opening balances and external top-ups require a second admin’s approval. The application then records the reference and evidence used to verify the real funding.</p>
                  <div className="mt-3 grid gap-3">
                    <Field label="Wallet"><select value={walletId} onChange={(event) => setWalletId(event.target.value)} className={inputClass} disabled={walletRequestBusy || Boolean(walletRequestOperationId) || !walletOptions.length}>
                      {walletOptions.map((account) => <option key={account.wallet_account_id} value={account.wallet_account_id ?? ''}>{account.account_label} · {currency(account.balance)}</option>)}
                      {!walletOptions.length && <option value="">Create a provider wallet first</option>}
                    </select></Field>
                    <Field label="Funding amount"><Input inputMode="decimal" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" disabled={walletRequestBusy || Boolean(walletRequestOperationId)} /></Field>
                    <Field label="Reason"><Input value={walletReason} onChange={(event) => setWalletReason(event.target.value)} maxLength={500} placeholder="Opening balance from provider statement" disabled={walletRequestBusy || Boolean(walletRequestOperationId)} /></Field>
                    <Button size="sm" onClick={() => void requestWalletFunding()} loading={walletRequestBusy} disabled={!walletId || !walletAmount || walletReason.trim().length < 3}>{walletRequestOperationId ? 'Retry same request' : 'Request independent approval'}</Button>
                  </div>
                  {workspace.wallet_adjustments.length > 0 && <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                    <h4 className="text-sm font-semibold text-[var(--foreground)]">Wallet approval queue</h4>
                    {workspace.wallet_adjustments.map((request) => {
                      const isRequester = request.requester_id === actorId;
                      const decisionLocked = Boolean(decisionOperationIds[request.request_id]);
                      const applicationLocked = Boolean(applicationOperationIds[request.request_id]);
                      return <article key={request.request_id} className="rounded-xl border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div><p className="font-medium text-[var(--foreground)]">{request.wallet_label} · {request.kind}</p><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{currency(request.amount)} · {request.funding_source.replace('_', ' ')} · {request.reason}</p></div>
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">{request.state}</span>
                        </div>
                        {request.state === 'requested' && (isRequester ? <p className="mt-3 text-xs text-[var(--muted-foreground)]">Waiting for a different store admin. The requester cannot approve this change.</p> : <div className="mt-3 space-y-2">
                          <Field label="Decision reason"><Input value={decisionReason[request.request_id] ?? ''} onChange={(event) => setDecisionReason((current) => ({ ...current, [request.request_id]: event.target.value }))} placeholder="Review provider statement before approving" disabled={decisionBusyId === request.request_id || decisionLocked} /></Field>
                          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void decideWalletRequest(request.request_id, request.request_version, 'approve')} loading={decisionBusyId === request.request_id} disabled={(decisionReason[request.request_id] ?? '').trim().length < 3 || decisionLocked}>Approve</Button><Button size="sm" variant="outline" onClick={() => void decideWalletRequest(request.request_id, request.request_version, 'reject')} disabled={decisionBusyId === request.request_id || (decisionReason[request.request_id] ?? '').trim().length < 3 || decisionLocked}>Reject</Button></div>
                        </div>)}
                        {request.state === 'approved' && request.decision === 'approve' && <div className="mt-3 space-y-2">
                          <p className="text-xs text-emerald-800">Approved independently. Apply only after verifying the external funding.</p>
                          <Field label="Provider reference"><Input value={applicationEvidence[request.request_id]?.reference ?? ''} onChange={(event) => setApplicationEvidence((current) => ({ ...current, [request.request_id]: { reference: event.target.value, evidence: current[request.request_id]?.evidence ?? '' } }))} maxLength={160} disabled={applicationBusyId === request.request_id || applicationLocked} /></Field>
                          <Field label="Evidence reference"><Input value={applicationEvidence[request.request_id]?.evidence ?? ''} onChange={(event) => setApplicationEvidence((current) => ({ ...current, [request.request_id]: { reference: current[request.request_id]?.reference ?? '', evidence: event.target.value } }))} maxLength={200} disabled={applicationBusyId === request.request_id || applicationLocked} /></Field>
                          <Button size="sm" onClick={() => void applyWalletRequest(request)} loading={applicationBusyId === request.request_id} disabled={(applicationEvidence[request.request_id]?.reference ?? '').trim().length === 0 || (applicationEvidence[request.request_id]?.evidence ?? '').trim().length === 0}>{applicationLocked ? 'Retry same application' : 'Apply approved funding'}</Button>
                        </div>}
                      </article>;
                    })}
                  </div>}
                </div>}
                {isAdmin && <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Add a manual account</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">The system stores only the provider name, a label, and an optional masked identifier. No credentials are collected.</p>
                  <div className="mt-3 grid gap-3">
                    <Field label="Account type"><select value={accountKind} onChange={(event) => setAccountKind(event.target.value as DigitalProviderKind)} className={inputClass} disabled={accountBusy || accountLocked}><option value="gcash">GCash wallet</option><option value="load">E-load account</option><option value="other">Other manual provider</option></select></Field>
                    <Field label="Provider"><Input value={providerName} onChange={(event) => setProviderName(event.target.value)} maxLength={80} disabled={accountBusy || accountLocked} /></Field>
                    <Field label="Account label"><Input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} maxLength={100} disabled={accountBusy || accountLocked} /></Field>
                    <Field label="Masked identifier (optional)"><Input value={maskedIdentifier} onChange={(event) => setMaskedIdentifier(event.target.value)} maxLength={80} placeholder="•••• 1234" disabled={accountBusy || accountLocked} /></Field>
                    <Button size="sm" onClick={() => void addAccount()} loading={accountBusy} disabled={!providerName.trim() || !accountLabel.trim()}>{accountOperationId ? 'Retry same setup' : 'Create account'}</Button>
                  </div>
                </div>}
              </section>

              {isAdmin && <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm" aria-labelledby="catalog-title">
                <h2 id="catalog-title" className="font-semibold text-[var(--foreground)]">Add a service product</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">Service products are non-stock catalog entries. Existing physical product inventory is unchanged.</p>
                <div className="mt-4 grid gap-3">
                  <Field label="Service type"><select value={productKind} onChange={(event) => {
                    const next = event.target.value as DigitalServiceKind;
                    setProductKind(next);
                    setProductName(serviceLabels[next]);
                    setProductSku(`DIGITAL-${next.toUpperCase()}`);
                    setProductPrice(next === 'digital_product' ? '10.00' : '0.00');
                    setProductCost(next === 'digital_product' ? '5.00' : '0.00');
                    setAdditionalCharge('0.00');
                  }} className={inputClass} disabled={productBusy || productLocked}>{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <Field label="Product name"><Input value={productName} onChange={(event) => setProductName(event.target.value)} maxLength={120} disabled={productBusy || productLocked} /></Field>
                  <Field label="SKU"><Input value={productSku} onChange={(event) => setProductSku(event.target.value)} maxLength={80} disabled={productBusy || productLocked} /></Field>
                  <Field label="Category"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass} disabled={productBusy || productLocked || !categories.length}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
                  <div className="grid grid-cols-2 gap-3"><Field label="Retail price"><Input inputMode="decimal" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} disabled={productBusy || productLocked} /></Field><Field label="Cost"><Input inputMode="decimal" value={productCost} onChange={(event) => setProductCost(event.target.value)} disabled={productBusy || productLocked} /></Field></div>
                  {productKind !== 'digital_product' && <div className="grid grid-cols-2 gap-3"><Field label="Minimum principal"><Input inputMode="decimal" value={minFace} onChange={(event) => setMinFace(event.target.value)} placeholder={productKind === 'gcash_cash_out' ? '50.00' : 'Optional'} disabled={productBusy || productLocked} /></Field><Field label="Maximum principal"><Input inputMode="decimal" value={maxFace} onChange={(event) => setMaxFace(event.target.value)} placeholder="Optional" disabled={productBusy || productLocked} /></Field></div>}
                  {productKind === 'eload' && <Field label="Extra customer charge"><Input inputMode="decimal" value={additionalCharge} onChange={(event) => setAdditionalCharge(event.target.value)} disabled={productBusy || productLocked} /></Field>}
                  <Button size="sm" onClick={() => void addProduct()} loading={productBusy} disabled={!categoryId || !productName.trim() || !productSku.trim() || (productKind === 'digital_product' && (Number(productPrice) <= 0 || Number(productCost) > Number(productPrice)))}>{productOperationId ? 'Retry same setup' : 'Create non-stock product'}</Button>
                </div>
              </section>}
            </aside>
          </div>

          <section className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm" aria-labelledby="recent-records-title">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div><h2 id="recent-records-title" className="font-semibold text-[var(--foreground)]">Recent records</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">Completed earnings and unresolved external outcomes are listed separately.</p></div>
              <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>Refresh</Button>
            </div>
            {workspace.records.length === 0 ? <p className="px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">No digital service records yet.</p> : <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="px-5 py-3 font-medium">Service / date</th><th className="px-5 py-3 font-medium">Principal</th><th className="px-5 py-3 font-medium">Fee</th><th className="px-5 py-3 font-medium">Earning</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">{workspace.records.map((record) => <Fragment key={record.id}>
                  <tr key={record.id}>
                    <td className="px-5 py-3"><p className="font-medium text-[var(--foreground)]">{serviceLabels[record.service_kind]}{record.product_name ? ` · ${record.product_name}` : ''}</p><p className="text-xs text-[var(--muted-foreground)]">{new Date(record.created_at).toLocaleString('en-PH')}{record.reference ? ` · Ref ${record.reference}` : ''}</p></td>
                    <td className="px-5 py-3 tabular-nums">{currency(record.face_amount)}</td><td className="px-5 py-3 tabular-nums">{currency(record.fee_amount)}</td><td className="px-5 py-3 tabular-nums">{record.state === 'completed' ? currency(record.earning_amount) : '—'}</td>
                    <td className="px-5 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${record.state === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{record.state === 'completed' ? 'Complete' : 'Needs reconciliation'}</span>{record.reconciliation_case_id && <p className="mt-1 text-xs text-amber-900">Review case opened</p>}</td>
                  </tr>
                  {isAdmin && record.state === 'needs_reconciliation' && (record.provider_leg_state === 'unknown' || record.provider_leg_state === 'confirmed') && <tr key={`${record.id}-review`}>
                    <td colSpan={5} className="bg-amber-50/70 px-5 py-4">
                      <div className="max-w-4xl">
                        <p className="text-sm font-semibold text-amber-950">Manually confirm provider outcome</p>
                        <p className="mt-1 text-xs leading-5 text-amber-900">Review the provider account directly. This records your confirmation and attempts the wallet ledger posting; it does not contact GCash or repeat a transfer.</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <Field label="Provider reference"><Input value={resolutionDrafts[record.id]?.reference ?? record.reference ?? ''} onChange={(event) => setResolutionDrafts((current) => ({ ...current, [record.id]: { reference: event.target.value, externalAt: current[record.id]?.externalAt ?? localDateTimeNow(), evidence: current[record.id]?.evidence ?? '' } }))} maxLength={160} disabled={resolutionBusyId === record.id || Boolean(resolutionOperationIds[record.id])} /></Field>
                          <Field label="Provider transaction time"><Input type="datetime-local" value={resolutionDrafts[record.id]?.externalAt ?? localDateTimeNow()} onChange={(event) => setResolutionDrafts((current) => ({ ...current, [record.id]: { reference: current[record.id]?.reference ?? record.reference ?? '', externalAt: event.target.value, evidence: current[record.id]?.evidence ?? '' } }))} disabled={resolutionBusyId === record.id || Boolean(resolutionOperationIds[record.id])} /></Field>
                          <Field label="Evidence reference"><Input value={resolutionDrafts[record.id]?.evidence ?? ''} onChange={(event) => setResolutionDrafts((current) => ({ ...current, [record.id]: { reference: current[record.id]?.reference ?? record.reference ?? '', externalAt: current[record.id]?.externalAt ?? localDateTimeNow(), evidence: event.target.value } }))} maxLength={200} disabled={resolutionBusyId === record.id || Boolean(resolutionOperationIds[record.id])} /></Field>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={() => void resolveRecord(record)} loading={resolutionBusyId === record.id} disabled={!(resolutionDrafts[record.id]?.reference ?? record.reference ?? '').trim() || !(resolutionDrafts[record.id]?.evidence ?? '').trim()}>{resolutionOperationIds[record.id] ? 'Retry same confirmation' : 'Confirm and reconcile'}</Button>
                          {resolutionOperationIds[record.id] && <Button size="sm" variant="outline" onClick={() => setResolutionOperationIds((current) => { const next = { ...current }; delete next[record.id]; return next; })} disabled={resolutionBusyId === record.id}>Edit details</Button>}
                        </div>
                      </div>
                    </td>
                  </tr>}
                </Fragment>)}</tbody>
              </table>
            </div>}
          </section>
        </>
      )}
    </main>
  );
}

const inputClass = 'flex h-10 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-50';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>{children}{hint && <span className="block text-xs leading-4 text-[var(--muted-foreground)]">{hint}</span>}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"><p className="text-xs text-[var(--muted-foreground)]">{label}</p><p className="mt-1 font-semibold tabular-nums text-[var(--foreground)]">{value}</p></div>;
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof Smartphone; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"><div className="flex items-start gap-3"><span className="rounded-lg bg-[var(--primary-soft)] p-2 text-[var(--primary)]"><Icon className="size-4" /></span><div><p className="text-xs text-[var(--muted-foreground)]">{label}</p><p className="mt-0.5 font-semibold text-[var(--foreground)]">{value}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{detail}</p></div></div></div>;
}

function policyLabel(policy: DigitalFeePolicy) {
  const suffix = policy.service_kind === 'gcash_cash_out' && policy.policy_code === 'cashout_standard'
    ? ' · ₱2 (₱50–₱100), ₱4 (>₱100)'
    : policy.rate_bps != null ? ` · ${policy.rate_bps / 100}%` : '';
  return `${policy.policy_code}${suffix}${policy.is_default ? ' · default' : ''}`;
}
