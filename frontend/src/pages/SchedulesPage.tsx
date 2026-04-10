import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { scheduleService } from '../services/scheduleService';
import { customerService } from '../services/customerService';
import { userService } from '../services/userService';
import Modal from '../components/Modal';
import { formatDate } from '../utils/format';
import type { Schedule, Customer, User } from '../types';
import { ROLE_LABELS } from '../types';

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

interface FilterState {
  status: string;
  dateFrom: string;
  dateTo: string;
  customerId: string;
}

const defaultFilter: FilterState = { status: '', dateFrom: '', dateTo: '', customerId: '' };

interface ScheduleFormValues {
  customerId: string;
  shootDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  leadPhotographer?: string;
  bookedBy?: string;
  notes?: string;
}

const SchedulesPage = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [photographers, setPhotographers] = useState<User[]>([]);
  const [salesUsers, setSalesUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [supportIds, setSupportIds] = useState<string[]>([]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
    watch,
  } = useForm<ScheduleFormValues>();

  const load = async (f = filter) => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (f.status) params.status = f.status;
    if (f.dateFrom) params.dateFrom = f.dateFrom;
    if (f.dateTo) params.dateTo = f.dateTo;
    if (f.customerId) params.customerId = f.customerId;
    const res = await scheduleService.getAll(params);
    setSchedules(res.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    customerService.getAll({ limit: 200 }).then((r) => setCustomers(r.data));
    userService.getPhotographers().then(setPhotographers);
    userService.getSales().then(setSalesUsers);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setSupportIds([]);
    reset({ status: 'pending' });
    setModalOpen(true);
  };

  const openEdit = (s: Schedule) => {
    setEditing(s);
    const leadId =
      typeof s.leadPhotographer === 'object'
        ? (s.leadPhotographer as User)._id
        : (s.leadPhotographer ?? '');
    const supIds = (s.supportPhotographers ?? []).map((u) =>
      typeof u === 'object' ? (u as User)._id : u,
    );
    setSupportIds(supIds);
    reset({
      customerId: typeof s.customerId === 'object' ? (s.customerId as Customer)._id : s.customerId,
      shootDate: s.shootDate.slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      status: s.status,
      notes: s.notes,
      leadPhotographer: leadId,
      bookedBy:
        typeof s.bookedBy === 'object'
          ? (s.bookedBy as User)._id
          : (s.bookedBy ?? ''),
    });
    setModalOpen(true);
  };

  const onSubmit = async (data: ScheduleFormValues) => {
    const payload = {
      ...data,
      leadPhotographer: data.leadPhotographer || undefined,
      bookedBy: data.bookedBy || undefined,
      supportPhotographers: supportIds,
    };
    if (editing) {
      await scheduleService.update(editing._id, payload);
    } else {
      await scheduleService.create(payload);
    }
    setModalOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xoá lịch này?')) return;
    await scheduleService.remove(id);
    load();
  };

  const handleDownloadContract = async (s: Schedule) => {
    const customer = typeof s.customerId === 'object' ? (s.customerId as Customer) : null;
    const filename = `${customer?.className?.replace(/\s+/g, '-') ?? s._id}-${customer?.school?.replace(/\s+/g, '-') ?? ''}`;
    await scheduleService.downloadContract(s._id, filename);
  };

  const applyFilter = () => load(filter);
  const resetFilter = () => {
    setFilter(defaultFilter);
    load(defaultFilter);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Lịch chụp</h2>
        <button onClick={openCreate} className="btn-primary">
          + Thêm lịch
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-2">
          <select
            className="input flex-1 min-w-[8rem]"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(statusLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
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
            Xoá lọc
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Đang tải…</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Ngày chụp</th>
                  <th className="text-left px-4 py-3">Lớp</th>
                  <th className="text-left px-4 py-3">Ghi chú</th>
                  <th className="text-left px-4 py-3">Giờ</th>
                  <th className="text-left px-4 py-3">Địa điểm</th>
                  <th className="text-left px-4 py-3">Sale</th>
                  <th className="text-left px-4 py-3">Leader</th>
                  <th className="text-left px-4 py-3">Support</th>
                  <th className="text-left px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const customer =
                    typeof s.customerId === 'object' ? (s.customerId as Customer) : null;
                  return (
                    <tr key={s._id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{formatDate(s.shootDate)}</td>
                      <td className="px-4 py-3 text-primary-600">{customer?.className ?? '—'}</td>
                      <td className="px-4 py-3 max-w-[14rem]">
                        <span
                          className="inline-block bg-yellow-50 text-yellow-800 text-xs font-medium px-2 py-1 rounded-md border border-yellow-200 max-w-full whitespace-pre-line"
                          title={s.notes}
                        >
                          {s.notes || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {s.startTime}
                        {s.endTime ? ` – ${s.endTime}` : ''}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{s.location}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {typeof s.bookedBy === 'object'
                          ? ((s.bookedBy as User)?.name ?? (s.bookedBy as User)?.username)
                          : (s.bookedBy ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {typeof s.leadPhotographer === 'object'
                          ? (s.leadPhotographer as User)?.name
                          : (s.leadPhotographer ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {(s.supportPhotographers ?? [])
                          .map((u) => (typeof u === 'object' ? (u as User)?.name : u))
                          .join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusColor[s.status]}`}>
                          {statusLabel[s.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => handleDownloadContract(s)}
                          className="text-green-600 hover:underline text-xs"
                        >
                          Hợp đồng
                        </button>
                        <button
                          onClick={() => openEdit(s)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(s._id)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Xoá
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                      Chưa có dữ liệu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {schedules.map((s) => {
              const customer = typeof s.customerId === 'object' ? (s.customerId as Customer) : null;
              const leadName =
                typeof s.leadPhotographer === 'object'
                  ? ((s.leadPhotographer as User)?.name ?? (s.leadPhotographer as User)?.username)
                  : (s.leadPhotographer ?? null);
              const bookedByName =
                typeof s.bookedBy === 'object'
                  ? ((s.bookedBy as User)?.name ?? (s.bookedBy as User)?.username)
                  : (s.bookedBy ?? null);
              const supports = (s.supportPhotographers ?? [])
                .map((u) =>
                  typeof u === 'object' ? ((u as User)?.name ?? (u as User)?.username) : u,
                )
                .join(', ');
              return (
                <div key={s._id} className="card p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-gray-900">{formatDate(s.shootDate)}</div>
                      <div className="text-primary-600 text-sm mt-0.5">
                        {customer?.className ?? '—'}
                      </div>
                    </div>
                    <span className={`badge ${statusColor[s.status]}`}>
                      {statusLabel[s.status]}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm text-gray-600">
                    {(s.startTime || s.endTime) && (
                      <div>
                        ⏰ {s.startTime}
                        {s.endTime ? ` – ${s.endTime}` : ''}
                      </div>
                    )}
                    {s.location && <div>📍 {s.location}</div>}
                    {leadName && <div>Leader: {leadName}</div>}
                    {supports && <div>Support: {supports}</div>}
                    {s.notes && (
                      <div className="bg-yellow-50 text-yellow-800 text-xs font-medium px-2 py-1 rounded-md border border-yellow-200 mt-1 whitespace-pre-line">
                        📝 <br />
                        {s.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => handleDownloadContract(s)}
                      className="text-green-600 text-xs font-medium"
                    >
                      Hợp đồng
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="text-blue-600 text-xs font-medium"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={() => handleDelete(s._id)}
                      className="text-red-600 text-xs font-medium"
                    >
                      Xoá
                    </button>
                    {bookedByName && (
                      <span className="ml-auto bg-primary-50 text-primary-700 text-xs font-medium px-2 py-0.5 rounded-full border border-primary-200">
                        {bookedByName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {schedules.length === 0 && (
              <div className="card py-10 text-center text-gray-400">Chưa có dữ liệu</div>
            )}
          </div>
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Sửa lịch chụp' : 'Thêm lịch chụp'}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Lớp *</label>
              <select {...register('customerId', { required: true })} className="input">
                <option value="">-- Chọn lớp --</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.className} – {c.school}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ngày chụp *</label>
              <input {...register('shootDate', { required: true })} type="date" className="input" />
            </div>
            <div>
              <label className="label">Trạng thái</label>
              <select {...register('status')} className="input">
                {Object.entries(statusLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Giờ bắt đầu</label>
              <input {...register('startTime')} type="time" className="input" />
            </div>
            <div>
              <label className="label">Giờ kết thúc</label>
              <input {...register('endTime')} type="time" className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Địa điểm</label>
              <input {...register('location')} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Người chốt lớp (Sale)</label>
              <select {...register('bookedBy')} className="input">
                <option value="">-- Không chỉ định --</option>
                {salesUsers.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.username}
                    {u.name ? ` (${u.name})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Thợ leader</label>
              <select {...register('leadPhotographer')} className="input">
                <option value="">-- Không chỉ định --</option>
                {photographers.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.username}
                    {u.name ? ` (${u.name})` : ''} – {ROLE_LABELS[3]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Thợ support</label>
              <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                {photographers
                  .filter((u) => u._id !== watch('leadPhotographer'))
                  .map((u) => (
                    <label
                      key={u._id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={supportIds.includes(u._id)}
                        onChange={(e) =>
                          setSupportIds((prev) =>
                            e.target.checked ? [...prev, u._id] : prev.filter((id) => id !== u._id),
                          )
                        }
                      />
                      <span className="text-sm text-gray-700">
                        {u.username}
                        {u.name ? ` (${u.name})` : ''}
                      </span>
                      -<span className="text-xs text-gray-400">{ROLE_LABELS[3]}</span>
                    </label>
                  ))}
                {photographers.length === 0 && (
                  <p className="text-sm text-gray-400 px-1">Không có người dùng phù hợp</p>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Ghi chú</label>
              <textarea {...register('notes')} className="input" rows={2} />
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

export default SchedulesPage;
