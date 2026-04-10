import logoSrc from '../assets/images/logo.webp';

interface LogoProps {
  size?: number;
  className?: string;
}

const Logo = ({ size = 36, className = '' }: LogoProps) => (
  <div className="rounded-md overflow-hidden">
    <img
      src={logoSrc}
      alt="Yume Studio"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  </div>
);

export default Logo;
