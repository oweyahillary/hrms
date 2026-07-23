import { useEffect } from 'react';

/**
 * Warns before the browser tab closes, reloads, or the address bar is used to
 * navigate away while `dirty` is true — the native `beforeunload` prompt.
 *
 * Deliberately does NOT catch in-app link clicks (sidebar nav, a page's own
 * "Back to X" link): that needs React Router's `useBlocker`, which only works
 * under the data-router (`createBrowserRouter`/`RouterProvider`), and this
 * app uses the classic `<BrowserRouter>` — switching router modes app-wide
 * was more architectural risk than this pass should take on. Still real
 * protection for the most damaging case (losing a long form to an accidental
 * tab close), just not a complete one.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
