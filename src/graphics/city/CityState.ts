/**
 * Shared roadside-city settings. The road streamer rebuilds chunks lazily
 * whenever `version` changes, so Scenery.setDetail() needs no handle on it.
 */
export type CityDetail = 0 | 1 | 2 | 3;

export const cityState = {
  detail: 2 as CityDetail,
  version: 0,
};

export function setCityDetail(level: CityDetail): void {
  if (cityState.detail === level) return;
  cityState.detail = level;
  cityState.version++;
}

/** Building rows behind the first one, per detail level. */
export const ROWS_BY_DETAIL = [2, 3, 4, 5] as const;
/** Tree density multiplier per detail level. */
export const TREES_BY_DETAIL = [0.45, 0.7, 1, 1.3] as const;
