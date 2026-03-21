import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { CategorySalesPoint } from '@/types';

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

interface CategorySalesChartProps {
  data: CategorySalesPoint[];
}

export function CategorySalesChart({ data }: CategorySalesChartProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 mb-4">Sales by Category</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            dataKey="revenue"
            nameKey="category"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CategorySalesPoint;
              return (
                <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-sm">
                  <p className="font-medium text-gray-700">{d.category}</p>
                  <p className="text-xs text-gray-500">₱{d.revenue.toLocaleString()} · {d.percentage}%</p>
                </div>
              );
            }}
          />
          <Legend
            formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
