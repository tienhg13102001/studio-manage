import api from './api';
import type { Transaction, TransactionSummaryRow, PaginatedResponse } from '../types';

export const transactionService = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<PaginatedResponse<Transaction>>('/transactions', { params }).then((r) => r.data),
  getOne: (id: string) => api.get<Transaction>(`/transactions/${id}`).then((r) => r.data),
  create: (data: Partial<Transaction>) =>
    api.post<Transaction>('/transactions', data).then((r) => r.data),
  update: (id: string, data: Partial<Transaction>) =>
    api.put<Transaction>(`/transactions/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/transactions/${id}`).then((r) => r.data),
  getSummary: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<TransactionSummaryRow[]>('/transactions/summary', { params }).then((r) => r.data),
};
