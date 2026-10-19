import { useEffect, useState } from 'react';
export function useAppearance(preference: 'system' | 'light' | 'dark') {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference;
}
