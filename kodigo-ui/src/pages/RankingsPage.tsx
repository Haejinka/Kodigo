import { useState } from 'react';
import { Trophy, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { mockRankings } from '@/lib/mock-data';
import type { ProductRanking } from '@/types';

const periods = ['Daily', 'Weekly', 'Monthly'] as const;
type Period = typeof periods[number];

const rankColors = ['#f59e0b', '#9ca3af', '#b45309'];
const rankIcons = ['🥇', '🥈', '🥉'];

export function RankingsPage() {
  const [period, setPeriod] = useState<Period>('Weekly');

  return (
    <div>
      <PageHeader
        title="Product Rankings"
        subtitle="Top selling products by revenue and units"
        actions={
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />

      {/* Podium (Top 3) */}
      <div className="flex items-end gap-4 mb-8">
        {[mockRankings[1], mockRankings[0], mockRankings[2]].map((r, i) => {
          const podiumRank = i === 0 ? 2 : i === 1 ? 1 : 3;
          // Platform step heights only — cards auto-size to content
          const platformHeight = ['h-14', 'h-20', 'h-10'][i];
          return (
            <div key={r.productId} className="flex flex-col items-center flex-1 min-w-0">
              {/* Card — height is auto, content never clipped */}
              <div className="w-full bg-white border border-gray-200 shadow-sm rounded-xl flex flex-col items-center p-4 gap-1.5">
                <span className="text-3xl leading-none">{rankIcons[podiumRank - 1]}</span>
                <p className="text-xs font-semibold text-gray-900 text-center leading-snug">
                  {r.productName}
                </p>
                <p className="text-sm font-bold font-mono text-gray-900">{formatCurrency(r.revenue)}</p>
              </div>
              {/* Podium platform — height varies to create the step effect */}
              <div
                className={`w-full ${platformHeight} flex items-center justify-center rounded-b-xl text-white text-sm font-bold mt-1`}
                style={{ backgroundColor: rankColors[podiumRank - 1] }}
              >
                #{podiumRank}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full Rankings Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900">Full Rankings — {period}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Rank</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Product</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Category</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Units Sold</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Revenue</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mockRankings.map((r: ProductRanking) => (
                <tr key={r.productId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    {r.rank <= 3 ? (
                      <span className="text-base">{rankIcons[r.rank - 1]}</span>
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 inline-flex">
                        {r.rank}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-medium text-gray-900">{r.productName}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{r.categoryName}</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-gray-900">{r.unitsSold.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-gray-900">{formatCurrency(r.revenue)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${r.percentageOfTotal * 3}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-600 w-10 text-right">{r.percentageOfTotal.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
