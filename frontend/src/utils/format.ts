export const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

export const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN');
};

export const formatDateTime = (dateStr: string): string => {
  const d = new Date(dateStr);
  return d.toLocaleString('vi-VN');
};
