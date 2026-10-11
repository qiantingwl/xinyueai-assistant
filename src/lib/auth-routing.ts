const PUBLIC_PATHS = [
  '/',
  '/welcome',
  '/login',
  '/register',
  '/forgot-password',
  '/share',
  '/canvas',
  '/setup',
] as const

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((publicPath) =>
    publicPath === '/' ? path === '/' : path === publicPath || path.startsWith(publicPath + '/'),
  )
}

export function isAutomaticLoginRedirectExempt(path: string): boolean {
  if (path === '/') return true
  if (path.startsWith('/share/')) return true
  if (path === '/canvas' || path.startsWith('/canvas/')) return true
  return path === '/setup' || path.startsWith('/setup/')
}
