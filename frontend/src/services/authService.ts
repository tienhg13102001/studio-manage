import api from './api';
import type { User } from '../types';

interface LoginResponse {
  token: string;
  user: User;
}

export const authService = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }).then((r) => r.data),
  getMe: () => api.get<{ user: User }>('/auth/me').then((r) => r.data.user),
};
