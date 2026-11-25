import { Download, LogOut, Plus, Search, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLiveDownloads } from '../store';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`select-none text-2xl font-black tracking-tight text-flix-red ${className}`}>
      YOUTUBE<span className="text-white/90">-</span>FLIX
    </Link>
  );
}

const links = [
  { to: '/', label: 'Home' },
  { to: '/series', label: 'Series' },
  { to: '/movies', label: 'Movies' },
  { to: '/downloads', label: 'Downloads' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const live = useLiveDownloads();
  const { local, signOut } = useAuth();
  const activeDownloads = Object.values(live).filter((d) => d.status === 'downloading' || d.status === 'queued').length;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onSearch = (value: string) => {
    setQuery(value);
    navigate(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : '/', { replace: true });
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'bg-flix-bg' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <nav className="flex h-16 items-center gap-6 px-4 md:px-12">
        <Logo />
        <ul className="hidden gap-5 text-sm md:flex">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.to !== '/downloads'}
                className={({ isActive }) => (isActive ? 'font-semibold text-white' : 'text-white/70 hover:text-white/90')}
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-4">
          <div className={`flex items-center border transition-all ${searchOpen ? 'border-white/70 bg-black/70' : 'border-transparent'}`}>
            <button
              aria-label="Search"
              className="p-1.5"
              onClick={() => {
                setSearchOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Search size={20} />
            </button>
            {searchOpen && (
              <>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => onSearch(e.target.value)}
                  onBlur={() => !query && setSearchOpen(false)}
                  placeholder="Titles, channels, genres"
                  className="w-40 bg-transparent pr-2 text-sm outline-none placeholder:text-white/50 md:w-56"
                />
                {query && (
                  <button aria-label="Clear search" className="pr-2" onClick={() => onSearch('')}>
                    <X size={16} />
                  </button>
                )}
              </>
            )}
          </div>

          <Link to="/downloads" className="relative md:hidden" aria-label="Downloads">
            <Download size={20} />
          </Link>
          {activeDownloads > 0 && (
            <Link
              to="/downloads"
              className="hidden items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs md:flex"
              title="Downloads in progress"
            >
              <Download size={14} className="animate-pulse" /> {activeDownloads}
            </Link>
          )}
          <Link
            to="/add"
            className="flex items-center gap-1 rounded bg-flix-red px-3 py-1.5 text-sm font-semibold hover:bg-flix-red-dark"
          >
            <Plus size={16} /> <span className="hidden sm:inline">Add</span>
          </Link>
          {local ? (
            <Link to="/settings" aria-label="Settings" className="text-white/80 hover:text-white">
              <Settings size={20} />
            </Link>
          ) : (
            <button aria-label="Sign out" title="Sign out" onClick={() => void signOut()} className="text-white/80 hover:text-white">
              <LogOut size={20} />
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
