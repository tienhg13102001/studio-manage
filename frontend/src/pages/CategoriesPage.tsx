import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { categoryService } from '../services/categoryService';
import Modal from '../components/Modal';
import type { Category } from '../types';

const CategoriesPage = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<Partial<Category>>();

  const load = () => categoryService.getAll().then(setCategories);
  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    reset({ type: 'income' });
    setModalOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    reset(c);
    setModalOpen(true);
  };

  const onSubmit = async (data: Partial<Category>) => {
    if (editing) {
      await categoryService.update(editing._id, data);
    } else {
      await categoryService.create(data);
    }
    setModalOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xoá danh mục này?')) return;
    await categoryService.remove(id);
    load();
  };

  const income = categories.filter((c) => c.type === 'income');
  const expense = categories.filter((c) => c.type === 'expense');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Danh mục thu / chi</h2>
        <button onClick={openCreate} className="btn-primary">
          + Thêm danh mục
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {[
          { label: 'Thu', list: income, color: 'text-green-600' },
          { label: 'Chi', list: expense, color: 'text-red-600' },
        ].map(({ label, list, color }) => (
          <div key={label} className="card p-0 overflow-hidden">
            <div className={`px-6 py-3 border-b bg-gray-50 font-semibold ${color}`}>{label}</div>
            <ul>
              {list.map((c) => (
                <li
                  key={c._id}
                  className="flex items-center justify-between px-6 py-3 border-b last:border-0 hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-800">
                    {c.name}
                    {c.isDefault && <span className="ml-2 text-xs text-gray-400">(mặc định)</span>}
                  </span>
                  <div className="space-x-2">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Sửa
                    </button>
                    {!c.isDefault && (
                      <button
                        onClick={() => handleDelete(c._id)}
                        className="text-red-600 hover:underline text-xs"
                      >
                        Xoá
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-6 py-4 text-sm text-gray-400">Chưa có danh mục</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Sửa danh mục' : 'Thêm danh mục'}
        size="sm"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label className="label">Tên danh mục *</label>
            <input {...register('name', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">Loại *</label>
            <select {...register('type', { required: true })} className="input">
              <option value="income">Thu</option>
              <option value="expense">Chi</option>
            </select>
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

export default CategoriesPage;
