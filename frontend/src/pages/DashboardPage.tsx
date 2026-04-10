import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { customerService } from '../services/customerService';
import { scheduleService } from '../services/scheduleService';
import { transactionService } from '../services/transactionService';
import { formatCurrency } from '../utils/format';
import type { TransactionSummaryRow } from '../types';

interface Stats {
  totalCustomers: number;
  schedulesThisMonth: number;
  totalIncome: number;
  totalExpense: number;
}

const DashboardPage = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const now = new Date();
      const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const [customers, schedules, summary] = await Promise.all([
        customerService.getAll({ limit: 1 }),
        scheduleService.getAll({ dateFrom, dateTo, limit: 1 }),
        transactionService.getSummary(),
      ]);

      const totalIncome = (summary as TransactionSummaryRow[]).reduce((s, r) => s + r.income, 0);
      const totalExpense = (summary as TransactionSummaryRow[]).reduce((s, r) => s + r.expense, 0);

      setStats({
        totalCustomers: customers.total,
        schedulesThisMonth: schedules.total,
        totalIncome,
        totalExpense,
      });
      setLoading(false);
    };
    load().catch(console.error);
  }, []);

  if (loading) return <div className="text-gray-500">Đang tải…</div>;

  const cards = [
    { label: 'Tổng lớp', value: stats!.totalCustomers, color: 'text-blue-600', link: '/customers' },
    {
      label: 'Lịch chụp tháng này',
      value: stats!.schedulesThisMonth,
      color: 'text-purple-600',
      link: '/schedules',
    },
    {
      label: 'Tổng thu',
      value: formatCurrency(stats!.totalIncome),
      color: 'text-green-600',
      link: '/finance',
    },
    {
      label: 'Tổng chi',
      value: formatCurrency(stats!.totalExpense),
      color: 'text-red-600',
      link: '/finance',
    },
    {
      label: 'Lợi nhuận',
      value: formatCurrency(stats!.totalIncome - stats!.totalExpense),
      color: stats!.totalIncome - stats!.totalExpense >= 0 ? 'text-green-600' : 'text-red-600',
      link: '/finance',
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.link} className="card hover:shadow-md transition-shadow">
            <p className="text-sm text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
