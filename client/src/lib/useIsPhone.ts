import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md` breakpoint, pages switch to their phone layouts. */
export const PHONE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether the window is phone-sized, updating as it's resized or rotated. */
export function useIsPhone() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches);
}
