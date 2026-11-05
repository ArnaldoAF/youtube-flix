import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';
import { Navbar } from './components/Navbar';
import { TitleModal } from './components/TitleModal';
import { AddTitle } from './pages/AddTitle';
import { Downloads } from './pages/Downloads';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { Watch } from './pages/Watch';

export function App() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const openTitle = Number(params.get('t')) || null;
  const isWatching = pathname.startsWith('/watch/');
  const { local } = useAuth();

  return (
    <>
      {!isWatching && <Navbar />}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/series" element={<Home filter="series" />} />
          <Route path="/movies" element={<Home filter="movie" />} />
          <Route path="/search" element={<Search />} />
          <Route path="/add" element={<AddTitle />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={local ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="/watch/:episodeId" element={<Watch />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {openTitle && !isWatching && <TitleModal key={openTitle} id={openTitle} />}
    </>
  );
}
