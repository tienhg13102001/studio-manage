import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';
import type { UserRole } from '../types';

interface Props {
  children: ReactNode;
  requiredRole?: UserRole;
  allowedRoles?: UserRole[];
}

const ProtectedRoute = ({ children, requiredRole, allowedRoles }: Props) => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (requiredRole !== undefined && !user?.roles?.includes(requiredRole))
    return <Navigate to="/" replace />;
  if (allowedRoles && !user?.roles?.some((r) => allowedRoles.includes(r)))
    return <Navigate to="/" replace />;

  return <>{children}</>;
};

export default ProtectedRoute;
