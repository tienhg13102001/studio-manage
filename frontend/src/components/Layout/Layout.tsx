import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Logo from '../Logo';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-20 flex items-center h-14 px-4 bg-gray-900 md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-white p-1 mr-3"
          aria-label="Mở menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <Logo size={26} />
        <span className="ml-1 text-white font-bold text-sm">Yume Studio</span>
      </div>

      <main className="flex-1 md:ml-60 p-4 md:p-6 overflow-y-auto pt-[4.5rem] md:pt-6">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
