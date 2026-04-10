import api from './api';
import type { Customer, PaginatedResponse } from '../types';

export const customerService = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<PaginatedResponse<Customer>>('/customers', { params }).then((r) => r.data),
  getOne: (id: string) => api.get<Customer>(`/customers/${id}`).then((r) => r.data),
  create: (data: Partial<Customer>) => api.post<Customer>('/customers', data).then((r) => r.data),
  update: (id: string, data: Partial<Customer>) =>
    api.put<Customer>(`/customers/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/customers/${id}`).then((r) => r.data),
};
