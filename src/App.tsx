import { lazy, Suspense, useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOpenSettings } from '@/hooks/use-open-settings'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import { CommandMenu } from '@/components/command-menu/command-menu'
import { WelcomeCard } from '@/components/welcome/welcome-card'
import { SetPasswordGate } from '@/components/welcome/set-password-gate'
import { AnnouncementPopup } from '@/components/announcement/announcement-popup'
import { CreditAdjustmentNotice } from '@/components/credits/credit-adjustment-notice'
import { AuthGate } from '@/components/auth/auth-gate'
import { AuthDialog } from '@/components/auth/auth-dialog'
import SettingsDialog from '@/pages/settings/SettingsLayout'
import { useCommandMenu } from '@/hooks/use-command-menu'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useConversations } from '@/store/conversations'
import { resetComposerForNewConversation } from '@/store/composer-prefs'
import { useUI } from '@/store/ui'
import { useSettingsModal } from '@/store/settings-modal'
import { useAuthModal, type AuthModalMode } from '@/store/auth-modal'
import { useImageEdit } from '@/store/image-edit'
import { initAppUpdate, maybeApplyUpdate } from '@/lib/app-update'
import { initRealtime } from '@/lib/realtime'
import { useSiteConfig } from '@/store/site-config'

const ChatLayout = lazy(() => import('@/pages/chat/ChatLayout'))
const ChatRoute = lazy(() => import('@/pages/chat/ChatRoute'))
const ProjectsList = lazy(() => import('@/pages/projects/ProjectsList'))
const ProjectDetail = lazy(() => import('@/pages/projects/ProjectDetail'))
const CanvasList = lazy(() => import('@/pages/canvas/CanvasList'))
const CanvasEditor = lazy(() => import('@/pages/canvas/CanvasEditor'))
const PromoImage = lazy(() => import('@/pages/promo/PromoImage'))
const KnowledgeBasesList = lazy(() => import('@/pages/kb/KnowledgeBasesList'))
const KnowledgeBaseDetail = lazy(() => import('@/pages/kb/KnowledgeBaseDetail'))
const AuthLayout = lazy(() => import('@/pages/auth/AuthLayout'))
const Setup = lazy(() => import('@/pages/auth/Setup'))
const Subscription = lazy(() => import('@/pages/subscription/Subscription'))
const SharedConversation = lazy(() => import('@/pages/share/SharedConversation'))
const JoinWorkspace = lazy(() => import('@/pages/workspace/JoinWorkspace'))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminOverview = lazy(() => import('@/pages/admin/AdminOverview'))
const AdminChannels = lazy(() => import('@/pages/admin/AdminChannels'))
const AdminModels = lazy(() => import('@/pages/admin/AdminModels'))
const AdminModelEdit = lazy(() => import('@/pages/admin/AdminModelEdit'))
const AdminModelTags = lazy(() => import('@/pages/admin/AdminModelTags'))
const AdminSkills = lazy(() => import('@/pages/admin/AdminSkills'))
const AdminImageStyles = lazy(() => import('@/pages/admin/AdminImageStyles'))
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'))
const AdminUserGroups = lazy(() => import('@/pages/admin/AdminUserGroups'))
const AdminWorkspaces = lazy(() => import('@/pages/admin/AdminWorkspaces'))
const AdminUserConversations = lazy(() => import('@/pages/admin/AdminUserConversations'))
const AdminUserConversation = lazy(() => import('@/pages/admin/AdminUserConversation'))
const AdminUserLibrary = lazy(() => import('@/pages/admin/AdminUserLibrary'))
const AdminUserMemories = lazy(() => import('@/pages/admin/AdminUserMemories'))
const AdminUserLoginHistory = lazy(() => import('@/pages/admin/AdminUserLoginHistory'))
const AdminUsage = lazy(() => import('@/pages/admin/AdminUsage'))
const AdminAnalytics = lazy(() => import('@/pages/admin/AdminAnalytics'))
const AdminModelPolicy = lazy(() => import('@/pages/admin/AdminModelPolicy'))
const AdminContextMemory = lazy(() => import('@/pages/admin/AdminContextMemory'))
const AdminRegistration = lazy(() => import('@/pages/admin/AdminRegistration'))
const AdminSystemEmail = lazy(() => import('@/pages/admin/AdminSystemEmail'))
const AdminSystemSite = lazy(() => import('@/pages/admin/AdminSystemSite'))
const AdminSystemLegal = lazy(() => import('@/pages/admin/AdminSystemLegal'))
const AdminSystemLogging = lazy(() => import('@/pages/admin/AdminSystemLogging'))
const AdminSystemStorage = lazy(() => import('@/pages/admin/AdminSystemStorage'))
const AdminCreditSettings = lazy(() => import('@/pages/admin/AdminCreditSettings'))
const AdminBackup = lazy(() => import('@/pages/admin/AdminBackup'))
const AdminModeration = lazy(() => import('@/pages/admin/AdminModeration'))
const AdminAnnouncement = lazy(() => import('@/pages/admin/AdminAnnouncement'))
const AdminDocuments = lazy(() => import('@/pages/admin/AdminDocuments'))
const AdminFiles = lazy(() => import('@/pages/admin/AdminFiles'))
const AdminResources = lazy(() => import('@/pages/admin/AdminResources'))
const AdminFeedback = lazy(() => import('@/pages/admin/AdminFeedback'))
const UserFiles = lazy(() => import('@/pages/files/UserFiles'))
const SkillsPrompts = lazy(() => import('@/pages/library/SkillsPrompts'))
const AdminTools = lazy(() => import('@/pages/admin/AdminTools'))
const AdminMCP = lazy(() => import('@/pages/admin/AdminMCP'))
const AdminAudio = lazy(() => import('@/pages/admin/AdminAudio'))
const AdminOAuth = lazy(() => import('@/pages/admin/AdminOAuth'))
const AdminRedeemCodes = lazy(() => import('@/pages/admin/AdminRedeemCodes'))
const AdminPrompts = lazy(() => import('@/pages/admin/AdminPrompts'))
const AdminPaymentChannels = lazy(() => import('@/pages/admin/AdminPaymentChannels'))
const AdminPaymentMethods = lazy(() => import('@/pages/admin/AdminPaymentMethods'))
const AdminPaymentOrders = lazy(() => import('@/pages/admin/AdminPaymentOrders'))
const NotFound = lazy(() => import('@/pages/NotFound'))

function GlobalShortcuts() {
  const toggle = useCommandMenu((s) => s.toggle)
  const setOpen = useCommandMenu((s) => s.setOpen)
  const createConversation = useConversations((s) => s.createConversation)
  const navigate = useNavigate()
  const openSettings = useOpenSettings()

  useHotkeys([
    { combo: 'mod+k', whenInputFocused: true, handler: () => toggle() },
    { combo: 'mod+,', whenInputFocused: false, handler: () => openSettings('account') },
    {
      combo: 'mod+shift+o',
      // This is a navigation shortcut, not text editing; it should work even
      // when the composer currently owns focus.
      whenInputFocused: true,
      handler: () => {
        void (async () => {
          resetComposerForNewConversation()
          const c = await createConversation()
          if (c) navigate(`/chat/${c.id}`)
        })()
      },
    },
    {
      combo: 'mod+/',
      whenInputFocused: false,
      handler: () => openSettings('shortcuts'),
    },
    {
      combo: 'escape',
      whenInputFocused: true,
      handler: () => setOpen(false),
      preventDefault: false,
    },
  ])

  return null
}

function RouteFallback() {
  const { t } = useTranslation('common')

  return (
    <div
      className="min-h-svh w-full flex flex-col items-center justify-center gap-3 text-[var(--color-fg-subtle)] text-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-atomic="true"
    >
      <span
        aria-hidden
        className="inline-block size-4 rounded-full border-2 border-[var(--color-fg-faint)] border-r-transparent animate-[spin_900ms_linear_infinite]"
      />
      <span className="text-[13px]">{t('common.loading', { defaultValue: 'Loading…' })}</span>
    </div>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// Mobile: any navigation dismisses the sidebar drawer. Individual links inside
// the drawer already close it on tap for instant feedback, but plenty of
// navigations bypass those handlers (user-menu items, the archived dialog, the
// command menu, workspace switches) — this catches them all, and also resets a
// stale open flag when returning from layouts without the drawer (e.g. /admin).
function CloseNavOnNavigate() {
  const { pathname, search } = useLocation()
  const setNavOpen = useUI((s) => s.setNavOpen)
  useEffect(() => {
    setNavOpen(false)
  }, [pathname, search, setNavOpen])
  return null
}

function SiteConfigSync() {
  const title = useSiteConfig((state) => state.title)
  const description = useSiteConfig((state) => state.description)
  const load = useSiteConfig((state) => state.load)

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    document.querySelector('meta[name="application-name"]')?.setAttribute('content', title)
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', title)
  }, [title, description])
  return null
}

// The image editor is a global right-side panel, so dismiss it on every
// navigation instead of letting it survive into another page or conversation.
function CloseImageEditOnNavigate() {
  const { pathname, search, hash } = useLocation()
  const closeImageEdit = useImageEdit((s) => s.close)

  useEffect(() => {
    closeImageEdit()
  }, [closeImageEdit, hash, pathname, search])

  return null
}

// The settings dialog is pure UI state, so a route change underneath (browser
// Back, sign-out redirects, command-menu navigation) must dismiss it or it
// would float over the new page. Lives HERE — outside AuthGate — because the
// sign-out flow remounts the AuthGate subtree, which would wipe a ref kept
// inside the dialog; App never remounts, so the previous-path ref survives.
// The /settings deep-link redirect is exempt: that navigation is the one that
// OPENS the dialog (SettingsRedirect below).
function CloseSettingsOnNavigate() {
  const { pathname } = useLocation()
  const prevPathRef = useRef(pathname)
  useEffect(() => {
    const prev = prevPathRef.current
    prevPathRef.current = pathname
    if (prev !== pathname && !prev.startsWith('/settings')) {
      useSettingsModal.getState().close()
    }
  }, [pathname])
  return null
}

// Settings is a pure-state dialog (§设置-去路由化) — this route shim keeps the
// old /settings/:tab URLs working: the OAuth identity-link callback redirects
// to /settings/account?linked=…, and older bookmarks/deep links still point
// here. It opens the dialog on the requested tab and replaces the URL with
// /chat, carrying the query string so the account tab's ?linked toast fires.
function SettingsRedirect() {
  const { tab } = useParams<{ tab?: string }>()
  const { search } = useLocation()
  const navigate = useNavigate()
  const openSettings = useOpenSettings()
  useEffect(() => {
    openSettings(tab)
    navigate({ pathname: '/chat', search }, { replace: true })
  }, [tab, search, navigate, openSettings])
  return <RouteFallback />
}

// Backward-compatible auth URLs no longer own a page. They open the global
// dialog over the public chat home, preserving callback query parameters for
// OAuth, 2FA, and email verification flows.
function AuthModalRedirect({ mode }: { mode: AuthModalMode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const show = useAuthModal((state) => state.show)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const stateFrom = (location.state as { from?: unknown } | null)?.from
    const returnTo = typeof stateFrom === 'string' ? stateFrom : params.get('next') ?? '/'
    params.delete('next')
    show(mode, returnTo)
    const search = params.toString()
    navigate({ pathname: '/', search: search ? `?${search}` : '' }, { replace: true })
  }, [location.search, location.state, mode, navigate, show])

  return <RouteFallback />
}

export default function App() {
  const location = useLocation()
  // §23: realtime notify stream (multi-device sync) + invisible version
  // upgrades. Both are idempotent singletons; the realtime loop follows the
  // auth store on its own (connects after login, stops on logout).
  useEffect(() => {
    initRealtime()
    initAppUpdate()
  }, [])
  // A route navigation is a safe, invisible moment to apply a pending upgrade
  // (never fires while a message is streaming — see maybeApplyUpdate). The
  // settings dialog no longer navigates (pure UI state), so every pathname
  // change here is a real page swap the user already perceives as a jump.
  useEffect(() => {
    maybeApplyUpdate('navigation')
  }, [location.pathname])

  return (
    <TooltipProvider delayDuration={280} skipDelayDuration={120}>
      <NetworkStatusBanner />
      <SiteConfigSync />
      <ScrollToTop />
      <CloseNavOnNavigate />
      <CloseSettingsOnNavigate />
      <CloseImageEditOnNavigate />
      <AuthGate>
        <GlobalShortcuts />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/welcome" element={<Navigate to="/" replace />} />
            <Route path="/share/:token" element={<SharedConversation />} />
            <Route path="/workspace/join/:token" element={<JoinWorkspace />} />
            <Route path="/" element={<ChatLayout />}>
              <Route index element={<ChatRoute page="home" />} />
              <Route path="chat/:id" element={<ChatRoute page="thread" />} />
            </Route>
            <Route path="/chat" element={<ChatLayout />}>
              <Route index element={<ChatRoute page="home" />} />
              <Route path=":id" element={<ChatRoute page="thread" />} />
            </Route>
            <Route path="/projects" element={<ChatLayout />}>
              <Route index element={<ProjectsList />} />
              <Route path=":id" element={<ProjectDetail />} />
            </Route>
            <Route path="/files" element={<ChatLayout />}>
              <Route index element={<UserFiles />} />
            </Route>
            <Route path="/skills" element={<ChatLayout />}>
              <Route index element={<SkillsPrompts />} />
            </Route>
            <Route path="/kb" element={<ChatLayout />}>
              <Route index element={<KnowledgeBasesList />} />
              <Route path=":id" element={<KnowledgeBaseDetail />} />
            </Route>
            <Route path="/subscription" element={<ChatLayout />}>
              <Route index element={<Subscription />} />
            </Route>
            <Route path="/login" element={<AuthModalRedirect mode="login" />} />
            <Route path="/register" element={<AuthModalRedirect mode="register" />} />
            <Route path="/forgot-password" element={<AuthModalRedirect mode="forgot-password" />} />
            <Route element={<AuthLayout />}>
              <Route path="/setup" element={<Setup />} />
            </Route>
            <Route path="/canvas" element={<ChatLayout />}>
              <Route index element={<CanvasList />} />
              <Route path=":id" element={<CanvasEditor />} />
            </Route>
            <Route path="/promo-image" element={<ChatLayout />}>
              <Route index element={<PromoImage />} />
            </Route>
            {/* Settings is a dialog, not a page — these only catch old
                /settings/:tab links and the OAuth ?linked callback, opening
                the dialog and replacing the URL (see SettingsRedirect). */}
            <Route path="/settings" element={<SettingsRedirect />} />
            <Route path="/settings/:tab" element={<SettingsRedirect />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<AdminOverview />} />
              <Route path="channels" element={<AdminChannels />} />
              <Route path="models" element={<AdminModels />} />
              <Route path="models/:id" element={<AdminModelEdit />} />
              <Route path="model-tags" element={<AdminModelTags />} />
              <Route path="skills" element={<AdminSkills />} />
              <Route path="prompts" element={<AdminPrompts />} />
              <Route path="image-styles" element={<AdminImageStyles />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="user-groups" element={<AdminUserGroups />} />
              <Route path="workspaces" element={<AdminWorkspaces />} />
              <Route path="redeem-codes" element={<AdminRedeemCodes />} />
              <Route path="users/:id/conversations" element={<AdminUserConversations />} />
              <Route path="users/:id/library" element={<AdminUserLibrary />} />
              <Route path="users/:id/memories" element={<AdminUserMemories />} />
              <Route path="users/:id/login-history" element={<AdminUserLoginHistory />} />
              <Route path="users/:id/conversations/:cid" element={<AdminUserConversation />} />
              <Route path="usage" element={<AdminUsage />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="documents" element={<AdminDocuments />} />
              <Route path="resources" element={<AdminResources />} />
              <Route path="files" element={<AdminFiles />} />
              <Route path="feedback" element={<AdminFeedback />} />
              <Route path="tools" element={<AdminTools />} />
              <Route path="mcp" element={<AdminMCP />} />
              <Route path="audio" element={<AdminAudio />} />
              <Route path="oauth" element={<AdminOAuth />} />
              <Route path="moderation" element={<AdminModeration />} />
              <Route path="announcement" element={<AdminAnnouncement />} />
              <Route path="settings" element={<Navigate to="/admin/settings/model-policy" replace />} />
              <Route path="settings/model-policy" element={<AdminModelPolicy />} />
              <Route path="settings/context-memory" element={<AdminContextMemory />} />
              <Route path="settings/registration" element={<AdminRegistration />} />
              <Route path="settings/email" element={<AdminSystemEmail />} />
              <Route path="settings/site" element={<AdminSystemSite />} />
              <Route path="settings/legal" element={<AdminSystemLegal />} />
              <Route path="settings/logging" element={<AdminSystemLogging />} />
              <Route path="storage" element={<AdminSystemStorage />} />
              <Route path="credits" element={<AdminCreditSettings />} />
              <Route path="backup" element={<AdminBackup />} />
              <Route path="payment-channels" element={<AdminPaymentChannels />} />
              <Route path="payment-methods" element={<AdminPaymentMethods />} />
              <Route path="payment-orders" element={<AdminPaymentOrders />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        {/* Portaled dialog floating above whatever the Routes rendered; renders
            nothing while closed (tab chunks stay unloaded until first open). */}
        <SettingsDialog />
        <AuthDialog />
        <CommandMenu />
        <SetPasswordGate />
        <WelcomeCard />
        <AnnouncementPopup />
        <CreditAdjustmentNotice />
        <Toaster />
      </AuthGate>
    </TooltipProvider>
  )
}
