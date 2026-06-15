import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Star, ExternalLink, Edit, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { SearchInput } from '@/components/shared/SearchInput';
import { DataTable } from '@/components/shared/DataTable';
import { Badge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/Toast';
import { useSupplierStore } from '@/stores/supplierStore';
import { useAuthStore } from '@/stores/authStore';
import type { Supplier } from '@/types';
import type { Column } from '@/components/shared/DataTable';

function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-green-500' : score >= 75 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[80px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono font-semibold text-gray-700">{score}</span>
    </div>
  );
}

export function SuppliersPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { suppliers, deleteSupplier } = useSupplierStore();
  const { activeStoreId } = useAuthStore();
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Clear local state when switching stores
  useEffect(() => {
    setSearch('');
    setDeleteTarget(null);
  }, [activeStoreId]);

  const filtered = suppliers.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.contact.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await new Promise((r) => setTimeout(r, 600));
    try {
      await deleteSupplier(deleteTarget.id);
      toast('success', `"${deleteTarget.name}" removed successfully.`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast('error', err?.message || 'Failed to remove supplier.');
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Supplier>[] = [
    {
      key: 'name',
      header: 'Supplier',
      accessor: (s) => (
        <div>
          <p className="font-medium text-gray-900">{s.name}</p>
          <p className="text-xs text-gray-400">{s.contact}</p>
          <p className="text-[11px] text-blue-600 mt-0.5">
            {s.storeNames.length === 1 ? s.storeNames[0] : `${s.storeNames.length} stores`}
          </p>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', accessor: (s) => <span className="text-gray-600 text-xs">{s.phone}</span> },
    {
      key: 'overallScore',
      header: 'Overall Score',
      accessor: (s) => (
        <div className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          <ScoreBar score={s.overallScore} />
        </div>
      ),
    },
    { key: 'reliability', header: 'Reliability', accessor: (s) => <ScoreBar score={s.reliabilityScore} /> },
    { key: 'price', header: 'Price Score', accessor: (s) => <ScoreBar score={s.priceScore} /> },
    { key: 'leadTime', header: 'Lead Time', accessor: (s) => <span className="text-xs font-mono text-gray-600">{s.leadTimeDays}d</span>, align: 'center' },
    {
      key: 'orders',
      header: 'Orders',
      accessor: (s) => (
        <div className="text-xs">
          <span className="font-mono font-semibold text-gray-900">{s.totalOrders}</span>
          <span className="text-gray-400"> total</span>
        </div>
      ),
      align: 'center',
    },
    {
      key: 'onTime',
      header: 'On-Time %',
      accessor: (s) => {
        const pct = s.totalOrders > 0 ? Math.round((s.onTimeDeliveries / s.totalOrders) * 100) : 100;
        return <Badge variant={pct >= 90 ? 'success' : pct >= 75 ? 'warning' : 'danger'}>{pct}%</Badge>;
      },
      align: 'center',
    },
    {
      key: 'actions',
      header: '',
      accessor: (s) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/suppliers/${s.id}`)}
            className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
            title="View details"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate(`/suppliers/${s.id}/edit`)}
            className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
            title="Edit supplier"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDeleteTarget(s)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
            title="Delete supplier"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
      align: 'right',
    },
  ];

  const toolbar = (
    <SearchInput value={search} onChange={setSearch} placeholder="Search suppliers…" className="w-56" />
  );

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Manage and score your product suppliers"
        actions={
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => navigate('/suppliers/new')}
          >
            Add Supplier
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
        toolbar={toolbar}
        emptyTitle="No suppliers found"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove Supplier"
        description={`Are you sure you want to remove "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Remove"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
