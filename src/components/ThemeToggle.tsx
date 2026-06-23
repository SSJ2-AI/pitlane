'use client';

import { useCallback, useEffect, useState } from 'react';

// Phase 10 task 3 — light/dark mode toggle.
//
// Reads + writes `localStorage('pitlane-theme')`. The first-paint class on
// <html> is set by the inline script in src/app/layout.tsx so this component
// only handles the post-hydration toggle and keeps its icon in sync.

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'pitlane-theme';

function readInitialTheme(): Theme {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
    } else {
        root.classList.add('dark');
        root.classList.remove('light');
    }
}

export function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>('dark');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setTheme(readInitialTheme());
        setMounted(true);
    }, []);

    const toggle = useCallback(() => {
        setTheme((current) => {
            const next: Theme = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try {
                window.localStorage.setItem(STORAGE_KEY, next);
            } catch {
                // localStorage can throw in incognito / sandboxed contexts;
                // the visual toggle still works, just won't persist.
            }
            return next;
        });
    }, []);

    // Pre-hydration: render a neutral placeholder so the button width stays
    // stable and we don't trigger a hydration mismatch. The inline script
    // already set the right class on <html> at first paint.
    if (!mounted) {
        return (
            <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900"
            />
        );
    }

    const isDark = theme === 'dark';
    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:border-red-500 hover:text-white"
        >
            {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
    );
}

function SunIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m4.93 19.07 1.41-1.41" />
            <path d="m17.66 6.34 1.41-1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}
