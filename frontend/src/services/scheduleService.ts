import api from './api';
import type { Schedule, PaginatedResponse } from '../types';

export const scheduleService = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<PaginatedResponse<Schedule>>('/schedules', { params }).then((r) => r.data),
  getOne: (id: string) => api.get<Schedule>(`/schedules/${id}`).then((r) => r.data),
  create: (data: Partial<Schedule>) => api.post<Schedule>('/schedules', data).then((r) => r.data),
  update: (id: string, data: Partial<Schedule>) =>
    api.put<Schedule>(`/schedules/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/schedules/${id}`).then((r) => r.data),
  downloadContract: async (id: string, filename: string) => {
    const res = await api.get(`/schedules/${id}/contract`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `hop-dong-${filename}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
