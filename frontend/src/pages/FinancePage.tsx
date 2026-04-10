import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { transactionService } from '../services/transactionService';
import { customerService } from '../services/customerService';
import { categoryService } from '../services/categoryService';
import Modal from '../components/Modal';
import { formatDate, formatCurrency } from '../utils/format';
import type { Transaction, Customer, Category, TransactionSummaryRow } from '../types';

interface FilterState {
  type: string;
  customerId: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
}

const defaultFilter: FilterState = {
  type: '',
  customerId: '',
  categoryId: '',
  dateFrom: '',
  dateTo: '',
};

const FinancePage = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<TransactionSummaryRow[]>([]);
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [tab, setTab] = useState<'list' | 'summary'>('list');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<Partial<Transaction>>();

  const selectedType = watch('type');

  const loadList = async (f = filter) => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (f.type) params.type = f.type;
    if (f.customerId) params.customerId = f.customerId;
    if (f.categoryId) params.categoryId = f.categoryId;
    if (f.dateFrom) params.dateFrom = f.dateFrom;
    if (f.dateTo) params.dateTo = f.dateTo;
    const res = await transactionService.getAll(params);
    setTransactions(res.data);
    setLoading(false);
  };

  const loadSummary = async (f = filter) => {
    const rows = await transactionService.getSummary({ dateFrom: f.dateFrom, dateTo: f.dateTo });
    setSummary(rows);
  };

  useEffect(() => {
    loadList();
    loadSummary();
    Promise.all([customerService.getAll({ limit: 200 }), categoryService.getAll()]).then(
      ([c, cat]) => {
        setCustomers(c.data);
        setCategories(cat);
      },
    );
  }, []);

  const openCreate = () => {
    setEditing(null);
    reset({ type: 'income', date: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  };

  const openEdit = (t: Transaction) => {
    setEditing(t);
    reset({
      ...t,
      customerId:
        typeof t.customerId === 'object' && t.customerId
          ? (t.customerId as Customer)._id
          : (t.customerId ?? ''),
      categoryId: typeof t.categoryId === 'object' ? (t.categoryId as Category)._id : t.categoryId,
      date: t.date.slice(0, 10),
    });
    setModalOpen(true);
  };

  const onSubmit = async (data: Partial<Transaction>) => {
    const payload = { ...data, customerId: data.customerId || null };
    if (editing) {
      await transactionService.update(editing._id, payload);
    } else {
      await transactionService.create(payload);
    }
    setModalOpen(false);
    loadList();
    loadSummary();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xoá giao dịch này?')) return;
    await transactionService.remove(id);
    loadList();
    loadSummary();
  };

  const applyFilter = () => {
    loadList(filter);
    loadSummary(filter);
  };
  const resetFilter = () => {
    setFilter(defaultFilter);
    loadList(defaultFilter);
    loadSummary(defaultFilter);
  };

  const filteredCategories = categories.filter((c) => !selectedType || c.type === selectedType);

  const grandTotal = summary.reduce(
    (acc, r) => ({
      income: acc.income + r.income,
      expense: acc.expense + r.expense,
      profit: acc.profit + r.profit,
    }),
    { income: 0, expense: 0, profit: 0 },
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Quản lý Thu Chi</h2>
        <button onClick={openCreate} className="btn-primary">
          + Thêm giao dịch
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-2">
          <select
            className="input flex-1 min-w-[7rem]"
            value={filter.type}
            onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
          >
            <option value="">Tất cả</option>
            <option value="income">Thu</option>
            <option value="expense">Chi</option>
          </select>
          <select
            className="input flex-1 min-w-[8rem]"
            value={filter.customerId}
            onChange={(e) => setFilter((f) => ({ ...f, customerId: e.target.value }))}
          >
            <option value="">Tất cả lớp</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>
                {c.className}
              </option>
            ))}
          </select>
          <select
            className="input flex-1 min-w-[8rem]"
            value={filter.categoryId}
            onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value }))}
          >
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="input flex-1 min-w-[8rem]"
            value={filter.dateFrom}
            onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value }))}
          />
          <input
            type="date"
            className="input flex-1 min-w-[8rem]"
            value={filter.dateTo}
            onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value }))}
          />
          <button onClick={applyFilter} className="btn-primary">
            Lọc
          </button>
          <button onClick={resetFilter} className="btn-secondary">
            Xoá
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('list')}
          className={tab === 'list' ? 'btn-primary' : 'btn-secondary'}
        >
          Danh sách
        </button>
        <button
          onClick={() => setTab('summary')}
          className={tab === 'summary' ? 'btn-primary' : 'btn-secondary'}
        >
          Tổng hợp theo lớp
        </button>
      </div>

      {tab === 'list' &&
        (loading ? (
          <p className="text-gray-500">Đang tải…</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 border-b">
                  <tr>
                    <th className="text-left px-4 py-3">Ngày</th>
                    <th className="text-left px-4 py-3">Loại</th>
                    <th className="text-left px-4 py-3">Danh mục</th>
                    <th className="text-left px-4 py-3">Lớp</th>
                    <th className="text-left px-4 py-3">Mô tả</th>
                    <th className="text-right px-4 py-3">Số tiền</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t._id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">{formatDate(t.date)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${t.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                        >
                          {t.type === 'income' ? 'Thu' : 'Chi'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {typeof t.categoryId === 'object' ? (t.categoryId as Category).name : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {t.customerId && typeof t.customerId === 'object'
                          ? (t.customerId as Customer).className
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{t.description}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {t.type === 'expense' ? '-' : '+'}
                        {formatCurrency(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => openEdit(t)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(t._id)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Xoá
                        </button>
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                        Chưa có dữ liệu
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {transactions.map((t) => (
                <div key={t._id} className="card p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm text-gray-500">{formatDate(t.date)}</div>
                      <div className="text-sm text-gray-600 mt-0.5">
                        {typeof t.categoryId === 'object' ? (t.categoryId as Category).name : '—'}
                      </div>
                      {t.customerId && typeof t.customerId === 'object' && (
                        <div className="text-xs text-gray-400">
                          {(t.customerId as Customer).className}
                        </div>
                      )}
                      {t.description && (
                        <div className="text-xs text-gray-400 mt-0.5">{t.description}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span
                        className={`badge ${t.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                      >
                        {t.type === 'income' ? 'Thu' : 'Chi'}
                      </span>
                      <div
                        className={`font-semibold text-sm mt-1 ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {t.type === 'expense' ? '-' : '+'}
                        {formatCurrency(t.amount)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => openEdit(t)}
                      className="text-blue-600 text-xs font-medium"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={() => handleDelete(t._id)}
                      className="text-red-600 text-xs font-medium"
                    >
                      Xoá
                    </button>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && (
                <div className="card py-10 text-center text-gray-400">Chưa có dữ liệu</div>
              )}
            </div>
          </>
        ))}

      {tab === 'summary' && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Lớp</th>
                  <th className="text-left px-4 py-3">Trường</th>
                  <th className="text-right px-4 py-3 text-green-600">Tổng thu</th>
                  <th className="text-right px-4 py-3 text-red-600">Tổng chi</th>
                  <th className="text-right px-4 py-3">Lợi nhuận</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row._id ?? 'unknown'} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {row.customer?.className ?? '(Không có lớp)'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.customer?.school}</td>
                    <td className="px-4 py-3 text-right text-green-600">
                      {formatCurrency(row.income)}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {formatCurrency(row.expense)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${row.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(row.profit)}
                    </td>
                  </tr>
                ))}
                {summary.length > 0 && (
                  <tr className="border-t bg-gray-50 font-semibold">
                    <td className="px-4 py-3" colSpan={2}>
                      Tổng cộng
                    </td>
                    <td className="px-4 py-3 text-right text-green-600">
                      {formatCurrency(grandTotal.income)}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {formatCurrency(grandTotal.expense)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right ${grandTotal.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(grandTotal.profit)}
                    </td>
                  </tr>
                )}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Chưa có dữ liệu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {summary.map((row) => (
              <div key={row._id ?? 'unknown'} className="card p-4">
                <div className="font-semibold text-gray-900 mb-0.5">
                  {row.customer?.className ?? '(Không có lớp)'}
                </div>
                {row.customer?.school && (
                  <div className="text-sm text-gray-500 mb-2">🏫 {row.customer.school}</div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Thu</div>
                    <div className="text-green-600 font-medium">{formatCurrency(row.income)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Chi</div>
                    <div className="text-red-600 font-medium">{formatCurrency(row.expense)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Lợi nhuận</div>
                    <div
                      className={`font-semibold ${row.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(row.profit)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {summary.length > 0 && (
              <div className="card p-4 bg-gray-50">
                <div className="font-semibold text-gray-900 mb-2">Tổng cộng</div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Thu</div>
                    <div className="text-green-600 font-semibold">
                      {formatCurrency(grandTotal.income)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Chi</div>
                    <div className="text-red-600 font-semibold">
                      {formatCurrency(grandTotal.expense)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Lợi nhuận</div>
                    <div
                      className={`font-semibold ${grandTotal.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(grandTotal.profit)}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {summary.length === 0 && (
              <div className="card py-10 text-center text-gray-400">Chưa có dữ liệu</div>
            )}
          </div>
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Sửa giao dịch' : 'Thêm giao dịch'}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Loại *</label>
              <select {...register('type', { required: true })} className="input">
                <option value="income">Thu</option>
                <option value="expense">Chi</option>
              </select>
            </div>
            <div>
              <label className="label">Danh mục *</label>
              <select {...register('categoryId', { required: true })} className="input">
                <option value="">-- Chọn danh mục --</option>
                {filteredCategories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Số tiền *</label>
              <input
                {...register('amount', { required: true, valueAsNumber: true, min: 0 })}
                type="number"
                className="input"
              />
            </div>
            <div>
              <label className="label">Ngày *</label>
              <input {...register('date', { required: true })} type="date" className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Lớp (tuỳ chọn)</label>
              <select {...register('customerId')} className="input">
                <option value="">-- Không có lớp --</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.className} – {c.school}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Mô tả</label>
              <textarea {...register('description')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Huỷ
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              Lưu
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default FinancePage;
