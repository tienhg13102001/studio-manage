import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../types';
import { navItems, superadminItems } from '../../config/navItems';
import Logo from '../Logo';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavClick = () => {
    onClose();
  };

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-60 bg-gray-900 text-white flex flex-col h-screen fixed left-0 top-0 z-40 transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="px-6 py-5 border-b border-gray-700">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <div>
              <h1 className="text-lg font-bold leading-tight">Yume Studio</h1>
              <p className="text-xs text-gray-400">Quản lý chụp ảnh</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems
            .filter(
              (item) =>
                !item.hidden &&
                (!item.allowedRoles || user?.roles?.some((r) => item.allowedRoles!.includes(r))),
            )
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}

          {user?.roles?.some((r) =>
            superadminItems.some((item) => item.allowedRoles?.includes(r)),
          ) && (
            <>
              <div className="pt-3 pb-1 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Admin
              </div>
              {superadminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`
                  }
                >
                  <span>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="px-4 py-4 border-t border-gray-700">
          <div className="text-sm text-gray-300 mb-2">
            <span className="font-medium">{user?.username}</span>
            {user?.name && <span className="ml-1 text-xs text-gray-400">({user.name})</span>}
            <div className="mt-1 flex flex-wrap gap-1">
              {user?.roles?.map((r) => (
                <span key={r} className="text-xs bg-gray-700 px-1.5 py-0.5 rounded">
                  {ROLE_LABELS[r]}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors"
          >
            Đăng xuất →
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
