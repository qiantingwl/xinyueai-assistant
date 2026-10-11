import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogBody, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAuthModal } from '@/store/auth-modal'

const Login = lazy(() => import('@/pages/auth/Login'))
const Register = lazy(() => import('@/pages/auth/Register'))
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'))

function AuthDialogFallback() {
  return (
    <div className="grid min-h-48 place-items-center" role="status">
      <span
        aria-hidden
        className="size-4 animate-[spin_900ms_linear_infinite] rounded-full border-2 border-[var(--color-fg-faint)] border-r-transparent"
      />
    </div>
  )
}

export function AuthDialog() {
  const open = useAuthModal((state) => state.open)
  const mode = useAuthModal((state) => state.mode)
  const returnTo = useAuthModal((state) => state.returnTo)
  const setMode = useAuthModal((state) => state.setMode)
  const close = useAuthModal((state) => state.close)
  const navigate = useNavigate()
  const { t } = useTranslation('auth')

  function completeAuthentication(path: string) {
    close()
    navigate(path, { replace: true })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DialogContent
        size="sm"
        aria-describedby={undefined}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="w-[min(94vw,28rem)] max-h-[min(46rem,calc(100dvh-1.5rem))]"
      >
        <DialogTitle className="sr-only">
          {mode === 'login'
            ? t('login.title')
            : mode === 'register'
              ? t('register.title')
              : t('forgot.title')}
        </DialogTitle>
        <DialogBody className="px-6 pb-7 pt-7 sm:px-8 sm:pb-8 sm:pt-8">
          <Suspense fallback={<AuthDialogFallback />}>
            {mode === 'login' ? (
              <Login
                returnTo={returnTo}
                onAuthenticated={completeAuthentication}
                onSwitchToRegister={() => setMode('register')}
                onSwitchToForgotPassword={() => setMode('forgot-password')}
              />
            ) : mode === 'register' ? (
              <Register
                onAuthenticated={() => completeAuthentication(returnTo)}
                onSwitchToLogin={() => setMode('login')}
              />
            ) : (
              <ForgotPassword onSwitchToLogin={() => setMode('login')} />
            )}
          </Suspense>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
