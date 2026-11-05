import { useSearchParams } from 'react-router-dom';
import { TitleCard } from '../components/TitleCard';
import { useCatalog } from '../store';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function Search() {
  const [params] = useSearchParams();
  const query = normalize(params.get('q') ?? '');
  const { titles } = useCatalog();
  const results = titles.filter((t) =>
    normalize([t.name, t.description, t.channel ?? '', ...t.tags].join(' ')).includes(query),
  );

  return (
    <div className="px-4 pb-16 pt-24 md:px-12">
      <h1 className="mb-6 text-lg text-white/60">
        {results.length} result{results.length === 1 ? '' : 's'} for <span className="text-white">“{params.get('q')}”</span>
      </h1>
      <div className="grid grid-cols-2 gap-x-2 gap-y-16 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {results.map((t) => (
          <TitleCard key={t.id} title={t} wide />
        ))}
      </div>
    </div>
  );
}
