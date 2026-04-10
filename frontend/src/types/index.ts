// 0: Superadmin | 1: Admin | 2: Sale | 3: Thợ chụp ảnh | 4: Cộng tác viên sale
export type UserRole = 0 | 1 | 2 | 3 | 4;

export const ROLE_LABELS: Record<UserRole, string> = {
  0: 'Superadmin',
  1: 'Admin',
  2: 'Sale',
  3: 'Thợ chụp ảnh',
  4: 'Cộng tác viên sale',
};

export interface User {
  _id: string;
  username: string;
  name?: string;
  roles: UserRole[];
  isActive: boolean;
  createdAt?: string;
}

export interface Customer {
  _id: string;
  className: string;
  school?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  studentCount: number;
  notes?: string;
  createdAt?: string;
}

export interface Schedule {
  _id: string;
  customerId: string | Customer;
  shootDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  leadPhotographer?: string | User;
  supportPhotographers?: (string | User)[];
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  createdAt?: string;
}

export interface Category {
  _id: string;
  name: string;
  type: 'income' | 'expense';
  isDefault: boolean;
  createdBy?: string;
}

export interface Transaction {
  _id: string;
  customerId?: string | Customer | null;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string | Category;
  description?: string;
  date: string;
  createdAt?: string;
}

export interface TransactionSummaryRow {
  _id: string | null;
  customer?: Customer;
  income: number;
  expense: number;
  profit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
