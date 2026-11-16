import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'navigation' | 'auto';

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (theme: 'light' | 'dark') => void;
  initializeTheme: () => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'auto',
      resolvedTheme: 'light',

      setTheme: (theme: Theme) => {
        set({ theme });
        if (theme !== 'auto') {
          const resolved = theme === 'navigation' ? 'dark' : theme;
          set({ resolvedTheme: resolved });
          document.documentElement.setAttribute('data-theme', theme);
        } else {
          get().initializeTheme();
        }
      },

      setResolvedTheme: (resolvedTheme: 'light' | 'dark') => {
        set({ resolvedTheme });
        document.documentElement.setAttribute('data-theme', resolvedTheme);
      },

      initializeTheme: () => {
        const { theme } = get();
        if (theme === 'auto') {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          const resolved = prefersDark ? 'dark' : 'light';
          set({ resolvedTheme: resolved });
          document.documentElement.setAttribute('data-theme', resolved);
        }
      },

      toggleTheme: () => {
        const { resolvedTheme } = get();
        const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        set({ theme: newTheme, resolvedTheme: newTheme });
        document.documentElement.setAttribute('data-theme', newTheme);
      },
    }),
    {
      name: 'erpsaver-theme',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);

// Listen for system theme changes
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    const store = useThemeStore.getState();
    if (store.theme === 'auto') {
      const resolved = e.matches ? 'dark' : 'light';
      store.setResolvedTheme(resolved);
    }
  });
}