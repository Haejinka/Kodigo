import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Phone, Mail, MapPin, Package, Edit, Trash2, Clock, CheckCircle, XCircle, ShoppingCart, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/Toast';
import { useSupplierStore } from '@/stores/supplierStore';
import { useProductStore } from '@/stores/productStore';
import { formatCurrency, formatDate } from '@/lib/utils';

function ScoreRing({ score, label, formula }: { score: number; label: string; formula?: string }) {
  const color = score >= 90 ? 'text-green-600' : score >= 75 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex flex-col items-center text-center">
      <div className={`text-2xl font-bold font-mono ${color}`}>{score}</div>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {formula && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{formula}</p>}
    </div>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { suppliers, deleteSupplier, purchaseOrders, receivePurchaseOrder, cancelPurchaseOrder } = useSupplierStore();
  const products = useProductStore((s) => s.products);
  const supplier = suppliers.find((s) => s.id === id);
  const supplierProducts = products.filter((p) => p.supplierId === id);
  const supplierPOs = purchaseOrders.filter((po) => po.supplierId === id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!supplier) return;
    setDeleting(true);
    await new Promise((r) => setTimeout(r, 600));
    try {
      await deleteSupplier(supplier.id);
      toast('success', `"${supplier.name}" has been removed.`);
      navigate('/suppliers');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to remove supplier.');
    } finally {
      setDeleting(false);
    }
  };

  const handleReceive = async (poId: string, onTime: boolean) => {
    try {
      await receivePurchaseOrder(poId, onTime, products);
      toast('success', onTime ? 'Order received and stock replenished.' : 'Order received late and stock replenished.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to receive purchase order.');
    }
  };

  const handleCancel = async (poId: string) => {
    try {
      await cancelPurchaseOrder(poId);
      toast('info', 'Purchase order cancelled.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to cancel purchase order.');
    }
  };

  if (!supplier) {
    return (
      <div className="pt-16">
        <EmptyState title="Supplier not found" />
      </div>
    );
  }

  const onTimePct = supplier.totalOrders > 0
    ? Math.round((supplier.onTimeDeliveries / supplier.totalOrders) * 100)
    : 100;

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle={`Contact: ${supplier.contact}${supplier.storeNames.length > 0 ? ` · ${supplier.storeNames.join(', ')}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate('/suppliers')}
            >
              Back
            </Button>
            <Button
              variant="ghost"
              icon={<Edit className="w-4 h-4" />}
              onClick={() => navigate(`/suppliers/${id}/edit`)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => setConfirmDelete(true)}
              className="text-red-500 hover:bg-red-50"
            >
              Delete
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Contact Info */}
        <div className="space-y-5">
          {/* Contact Card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Contact Information</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-700">{supplier.phone}</span>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-700">{supplier.email}</span>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-700">{supplier.address}</span>
              </div>
            </div>
          </div>

          {/* Lead Time */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-2">Lead Time</h3>
            <p className="text-3xl font-bold font-mono text-blue-600">{supplier.leadTimeDays}</p>
            <p className="text-sm text-gray-500 mt-0.5">days average</p>
          </div>

          {/* Orders summary */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Order History</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-bold font-mono text-gray-900">{supplier.totalOrders}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total Orders</p>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-green-600">{onTimePct}%</p>
                <p className="text-xs text-gray-500 mt-0.5">On-Time Rate</p>
              </div>
            </div>
            <div className="mt-3">
              <Badge variant={onTimePct >= 90 ? 'success' : onTimePct >= 75 ? 'warning' : 'danger'}>
                {onTimePct >= 90 ? 'Excellent' : onTimePct >= 75 ? 'Good' : 'Needs Improvement'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Right: Scores & Products */}
        <div className="lg:col-span-2 space-y-5">
          {/* Score Card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900">Performance Scores</h3>
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="font-bold text-gray-900">{supplier.overallScore}</span>
                <span className="text-xs text-gray-400">/ 100</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <ScoreRing score={supplier.overallScore} label="Overall" formula="60% Reliability + 40% Price" />
              <ScoreRing score={supplier.reliabilityScore} label="Reliability" formula="On-time / Total × 100" />
              <ScoreRing score={supplier.priceScore} label="Price" formula="Normalized vs other suppliers" />
            </div>
            <div className="mt-5 space-y-2">
              {[
                { label: 'Overall Score', value: supplier.overallScore },
                { label: 'Reliability Score', value: supplier.reliabilityScore },
                { label: 'Price Score', value: supplier.priceScore },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">{item.label}</span>
                    <span className="font-mono font-semibold text-gray-700">{item.value}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${item.value >= 90 ? 'bg-green-500' : item.value >= 75 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${item.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PO History */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Purchase Orders</h3>
              <span className="text-xs text-gray-400">{supplierPOs.length} total</span>
            </div>

            {/* Score recalculation note */}
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
              <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                Marking an order as received updates the reliability and price scores automatically for all suppliers.
              </p>
            </div>

            {supplierPOs.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No purchase orders yet"
                description="Create a purchase order from the Restocking page to start tracking deliveries."
              />
            ) : (
              <div className="space-y-3">
                {supplierPOs.map((po) => (
                  <div key={po.id} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <p className="text-xs font-mono text-gray-400 mb-0.5">{po.id}</p>
                        <p className="text-sm text-gray-700">
                          {po.items.length} item{po.items.length !== 1 ? 's' : ''} ·{' '}
                          <span className="font-semibold font-mono">{formatCurrency(po.total)}</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(po.createdAt)}</p>
                      </div>
                      <div className="shrink-0">
                        {po.status === 'sent' && <Badge variant="info">Pending</Badge>}
                        {po.status === 'received' && (
                          <Badge variant={po.onTime ? 'success' : 'warning'}>
                            {po.onTime ? 'On Time' : 'Late'}
                          </Badge>
                        )}
                        {po.status === 'cancelled' && <Badge variant="danger">Cancelled</Badge>}
                        {po.status === 'draft' && <Badge variant="default">Draft</Badge>}
                      </div>
                    </div>

                    {po.status === 'received' && po.receivedAt && (
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        Received {formatDate(po.receivedAt)}
                      </p>
                    )}

                    {po.status === 'sent' && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleReceive(po.id, true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 text-xs font-medium transition-colors"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Mark On Time
                        </button>
                        <button
                          onClick={() => handleReceive(po.id, false)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 text-xs font-medium transition-colors"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          Mark Late
                        </button>
                        <button
                          onClick={() => void handleCancel(po.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-xs font-medium transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Products sourced from this supplier */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Products from this Supplier</h3>
              <span className="text-xs text-gray-400">{supplierProducts.length} products</span>
            </div>
            {supplierProducts.length === 0 ? (
              <EmptyState icon={Package} title="No products" description="This supplier hasn't been assigned to any products yet." />
            ) : (
              <div className="space-y-2">
                {supplierProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-gray-900">{formatCurrency(p.costPrice)}</p>
                      <p className="text-xs text-gray-400">cost price</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove Supplier"
        description={`Are you sure you want to remove "${supplier.name}"? This cannot be undone.`}
        confirmLabel="Remove"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
