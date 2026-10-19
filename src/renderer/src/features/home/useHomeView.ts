import { useMemo } from 'react';
import { buildHomeView, type HomeViewInput } from '../../model/home-view';
export function useHomeView({
  model,
  snapshot,
  preferences,
  route,
  search,
  selectedLightGroup,
}: HomeViewInput) {
  return useMemo(
    () => buildHomeView({ model, snapshot, preferences, route, search, selectedLightGroup }),
    [model, snapshot, preferences, route, search, selectedLightGroup],
  );
}
