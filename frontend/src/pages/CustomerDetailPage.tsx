import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { customerService } from '../services/customerService';
import { scheduleService } from '../services/scheduleService';
import { transactionService } from '../services/transactionService';
import { formatDate, formatCurrency } from '../utils/format';
import type { Customer, Schedule, Transaction, User } from '../types';

const statusLabel: Record<string, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const CustomerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      customerService.getOne(id),
      scheduleService.getAll({ customerId: id, limit: 100 }),
      transactionService.getAll({ customerId: id, limit: 100 }),
    ]).then(([c, s, t]) => {
      setCustomer(c);
      setSchedules(s.data);
      setTransactions(t.data);
    });
  }, [id]);

  if (!customer) return <div className="text-gray-500">Đang tải…</div>;

  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/customers" className="text-sm text-gray-500 hover:text-gray-700">
          ← Danh sách lớp
        </Link>
      </div>

      <div className="card">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">{customer.className}</h2>
        <p className="text-gray-500">{customer.school}</p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Liên hệ:</span>{' '}
            <span className="font-medium">{customer.contactName}</span>
          </div>
          <div>
            <span className="text-gray-500">SĐT:</span>{' '}
            <span className="font-medium">{customer.contactPhone}</span>
          </div>
          <div>
            <span className="text-gray-500">Email:</span>{' '}
            <span className="font-medium">{customer.contactEmail}</span>
          </div>
          <div>
            <span className="text-gray-500">Sĩ số:</span>{' '}
            <span className="font-medium">{customer.studentCount}</span>
          </div>
        </div>
        {customer.notes && <p className="mt-3 text-sm text-gray-600">{customer.notes}</p>}
      </div>

      {/* Finance summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-xs text-gray-500">Tổng thu</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(totalIncome)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500">Tổng chi</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(totalExpense)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500">Lợi nhuận</p>
          <p
            className={`text-xl font-bold ${totalIncome - totalExpense >= 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {formatCurrency(totalIncome - totalExpense)}
          </p>
        </div>
      </div>

      {/* Schedules */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-800">Lịch chụp</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 border-b">
            <tr>
              <th className="text-left px-4 py-3">Ngày</th>
              <th className="text-left px-4 py-3">Giờ</th>
              <th className="text-left px-4 py-3">Địa điểm</th>
              <th className="text-left px-4 py-3">Ekip</th>
              <th className="text-left px-4 py-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s._id} className="border-b last:border-0">
                <td className="px-4 py-3">{formatDate(s.shootDate)}</td>
                <td className="px-4 py-3 text-gray-600">
                  {s.startTime}
                  {s.endTime ? ` – ${s.endTime}` : ''}
                </td>
                <td className="px-4 py-3 text-gray-600">{s.location}</td>
                <td className="px-4 py-3 text-gray-600">
                  {typeof s.leadPhotographer === 'object'
                    ? (s.leadPhotographer as User)?.username
                    : (s.leadPhotographer ?? '—')}
                  {(s.supportPhotographers?.length ?? 0) > 0 && (
                    <span className="ml-1 text-xs text-gray-400">
                      (+{s.supportPhotographers!.length})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusColor[s.status]}`}>{statusLabel[s.status]}</span>
                </td>
              </tr>
            ))}
            {schedules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Chưa có lịch
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Transactions */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-800">Thu chi</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 border-b">
            <tr>
              <th className="text-left px-4 py-3">Ngày</th>
              <th className="text-left px-4 py-3">Loại</th>
              <th className="text-left px-4 py-3">Danh mục</th>
              <th className="text-left px-4 py-3">Mô tả</th>
              <th className="text-right px-4 py-3">Số tiền</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t._id} className="border-b last:border-0">
                <td className="px-4 py-3">{formatDate(t.date)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${t.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                  >
                    {t.type === 'income' ? 'Thu' : 'Chi'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {typeof t.categoryId === 'object' ? t.categoryId.name : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600">{t.description}</td>
                <td
                  className={`px-4 py-3 text-right font-medium ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}
                >
                  {t.type === 'expense' ? '-' : '+'}
                  {formatCurrency(t.amount)}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Chưa có giao dịch
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CustomerDetailPage;
