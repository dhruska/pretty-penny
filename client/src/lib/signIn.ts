/** Where to go after signing in: a page in this app, never another site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** The sign-in page, returning afterward to the given page (by default, the one showing now). */
export function signInPath(here = `${window.location.pathname}${window.location.search}`) {
  return here === '/' || here.startsWith('/login')
    ? '/login'
    : `/login?next=${encodeURIComponent(here)}`;
}
