import api from './api';
import type { User } from '../types';

export const userService = {
  getAll: () => api.get<User[]>('/users').then((r) => r.data),
  getPhotographers: () => api.get<User[]>('/users/photographers').then((r) => r.data),
  create: (data: Partial<User> & { password?: string }) =>
    api.post<User>('/users', data).then((r) => r.data),
  update: (id: string, data: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};
