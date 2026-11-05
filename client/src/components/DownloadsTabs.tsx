import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/downloads', label: 'Downloads' },
  { to: '/downloads/storage', label: 'Storage' },
];

/** Page heading shared by the download queue and the storage manager. */
export function DownloadsTabs() {
  return (
    <nav aria-label="Downloads views" className="flex gap-6 border-b border-white/15">
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `-mb-px border-b-2 pb-2 text-2xl font-black ${
              isActive ? 'border-flix-red text-white' : 'border-transparent text-white/50 hover:text-white/80'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
