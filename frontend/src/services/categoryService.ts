import api from './api';
import type { Category } from '../types';

export const categoryService = {
  getAll: (type?: 'income' | 'expense') =>
    api.get<Category[]>('/categories', { params: type ? { type } : {} }).then((r) => r.data),
  create: (data: Partial<Category>) => api.post<Category>('/categories', data).then((r) => r.data),
  update: (id: string, data: Partial<Category>) =>
    api.put<Category>(`/categories/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/categories/${id}`).then((r) => r.data),
};
