import { useState, useEffect } from 'react';

/**
 * Custom hook that tracks whether a CSS media query matches.
 * @param {string} query - CSS media query string, e.g. '(max-width: 1024px)'
 * @returns {boolean} Whether the media query currently matches
 */
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.matchMedia(query).matches;
        }
        return false;
    });

    useEffect(() => {
        const mql = window.matchMedia(query);
        const handler = (e) => setMatches(e.matches);
        
        // Modern browsers
        if (mql.addEventListener) {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        // Fallback for older browsers
        mql.addListener(handler);
        return () => mql.removeListener(handler);
    }, [query]);

    return matches;
}

/** Convenience: true when viewport ≤ 1024px */
export function useIsMobile() {
    return useMediaQuery('(max-width: 1024px)');
}
