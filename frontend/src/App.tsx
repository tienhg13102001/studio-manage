import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout/Layout';
import LoginPage from './pages/LoginPage';
import { navItems, superadminItems } from './config/navItems';

const allRoutes = [...navItems, ...superadminItems];

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {allRoutes.map((item) => {
              const Element = item.component;
              const element = item.allowedRoles ? (
                <ProtectedRoute allowedRoles={item.allowedRoles}>
                  <Element />
                </ProtectedRoute>
              ) : (
                <Element />
              );

              return item.index ? (
                <Route key={item.to} index element={element} />
              ) : (
                <Route key={item.to} path={item.to.slice(1)} element={element} />
              );
            })}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
