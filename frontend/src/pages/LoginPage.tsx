import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

interface FormValues {
  username: string;
  password: string;
}

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    setError('');
    try {
      await login(data.username, data.password);
      navigate('/');
    } catch {
      setError('Tên đăng nhập hoặc mật khẩu không đúng.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="card w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Logo size={52} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Yume Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Đăng nhập để tiếp tục</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Tên đăng nhập</label>
            <input
              {...register('username', { required: true })}
              className="input"
              placeholder="superadmin"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="label">Mật khẩu</label>
            <input
              {...register('password', { required: true })}
              type="password"
              className="input"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
