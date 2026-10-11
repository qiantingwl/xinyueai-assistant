import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ChevronDown, Menu } from 'lucide-react'
import { Composer } from '@/components/chat/composer'
import { UserMenu } from '@/components/sidebar/sidebar'
import { MyGallery } from '@/components/chat/my-gallery'
import { useConversations } from '@/store/conversations'
import { useAuth } from '@/store/auth'
import { useAuthModal } from '@/store/auth-modal'
import { useModels } from '@/store/models'
import { useUI } from '@/store/ui'
import { useComposerPrefs } from '@/store/composer-prefs'
import { useWorkspaces } from '@/store/workspaces'
import { conversationsApi } from '@/api'
import { cn } from '@/lib/utils'
import { persistUserSettings } from '@/lib/user-settings'
import {
  clearPendingConversation,
  pendingConversationKey,
  readPendingConversation,
  writePendingConversation,
} from '@/lib/pending-conversation'
import type { Attachment } from '@/types/chat'
import type { ApiConversation } from '@/api/types'
import type { ToolMode } from '@/lib/tool-mode'
import { resolveNewConversationFastMode } from '@/lib/chat-defaults'
import { userCan } from '@/lib/user-permissions'
import { enterOptimisticConversation } from '@/lib/optimistic-conversation-start'

gsap.registerPlugin(useGSAP)

export default function ChatHome() {
  const navigate = useNavigate()
  const { t } = useTranslation('chat')
  const beginOptimisticConversation = useConversations((s) => s.beginOptimisticConversation)
  const sendMessage = useConversations((s) => s.sendMessage)
  const defaultModelId = useModels((s) => s.defaultId)
  const imageModels = useModels((s) => s.imageModels)
  const modelsLoaded = useModels((s) => s.loaded)
  const loadModels = useModels((s) => s.load)
  const user = useAuth((s) => s.user)
  const canDraw = userCan(user, 'allow_drawing')
  const workspaceId = useWorkspaces((s) => s.activeId ?? undefined)
  const clearComposerDraft = useComposerPrefs((s) => s.clearDraft)

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // The home screen has no title to show, so on mobile it drops the layout's
  // standalone brand bar entirely (§ mobile home redesign) — a light floating
  // button below replaces it for opening the sidebar drawer.
  useEffect(() => {
    useUI.getState().setPageOwnsTopBar(true)
    return () => useUI.getState().setPageOwnsTopBar(false)
  }, [])

  // §4.20: the sidebar "Draw" entry links here with ?mode=draw to open the
  // composer pre-set to an image model (drawing mode).
  const [searchParams] = useSearchParams()
  const drawRequested = searchParams.get('mode') === 'draw'
  const drawMode = drawRequested && canDraw && imageModels.length > 0
  const draftScope = drawMode ? 'new-draw' : 'new-chat'
  const savedImageModelId =
    typeof user?.settings?.image_model_id === 'string' ? user.settings.image_model_id : ''
  const savedImageModelAvailable = imageModels.some((model) => model.id === savedImageModelId)
  const drawDefault = drawMode ? (savedImageModelAvailable ? savedImageModelId : imageModels[0]?.id ?? '') : ''
  const pendingStorageKey = useMemo(
    () => pendingConversationKey(user?.id, draftScope, workspaceId),
    [draftScope, user?.id, workspaceId],
  )

  // The model the user picks in the composer before the conversation exists.
  // Falls back to the draw default (if any), then the async-loaded chat default,
  // so a new chat honours the picker instead of always using the default model.
  const [pickedModelId, setPickedModelId] = useState<string | null>(null)
  // Serialize preference writes so rapid model changes cannot finish out of
  // order and leave the older image model as the persisted default.
  const imageModelPersistRef = useRef<Promise<unknown>>(Promise.resolve())
  const modelId = pickedModelId ?? (drawDefault || defaultModelId)
  // A user's explicit default model starts new chats in advanced mode. Accounts
  // without one start in 快速 when the deployment provides a fast model. Draw
  // mode (image models) is always advanced.
  const fastAvailable = useModels((s) => s.fastAvailable)
  const [pickedFast, setPickedFast] = useState<boolean | null>(null)
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<string[]>([])
  const fast =
    !drawMode &&
    (pickedFast ?? resolveNewConversationFastMode(user?.settings, fastAvailable, drawMode))

  useEffect(() => {
    if (!drawRequested || drawMode || !modelsLoaded) return
    navigate('/', { replace: true })
  }, [drawMode, drawRequested, modelsLoaded, navigate])

  const handleModelChange = (id: string) => {
    setPickedModelId(id)
    if (!imageModels.some((model) => model.id === id)) return
    imageModelPersistRef.current = imageModelPersistRef.current
      .catch(() => undefined)
      .then(() => persistUserSettings({ image_model_id: id }))
      .catch(() => undefined)
  }

  useEffect(() => {
    setSelectedKnowledgeBaseIds([])
  }, [draftScope, workspaceId])

  // When the user attaches a file BEFORE sending, we must create the
  // conversation up front so the upload is scoped + RAG-ingested (§4.11.2).
  // Stash it here so the eventual send reuses the SAME conversation instead of
  // spawning a second empty one. Created OUTSIDE the store on purpose: the
  // draft stays off the sidebar (no "Untitled" row from merely attaching) and
  // only enters the cache when the optimistic send adopts its server id. Its id
  // is persisted so a refresh can reclaim the draft without exposing it in the
  // sidebar.
  const pendingConvRef = useRef<ApiConversation | null>(null)
  const pendingCreateRef = useRef<Promise<ApiConversation | undefined> | null>(null)
  const pendingConsumedRef = useRef(false)
  // Set when the composer drains its last attachment while the lazy create is
  // still in flight — the create then discards its own conversation on landing
  // instead of installing a draft nobody references ("Untitled ghost").
  const draftAbandonedRef = useRef(false)
  const mountedRef = useRef(true)
  // Read synchronously on the first render so Composer starts in its restoring
  // state and cannot submit an attachment-less turn before recovery finishes.
  const [pendingConversationId, setPendingConversationId] = useState<string | undefined>(() =>
    readPendingConversation(pendingStorageKey),
  )
  const pendingStorageKeyRef = useRef(pendingStorageKey)
  pendingStorageKeyRef.current = pendingStorageKey
  // Guards startNew against a double fire (rapid re-click, two suggestion cards)
  // spawning duplicate conversations + sends.
  const startedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Reclaim an attachment-created conversation after a refresh. Keep the id in
  // durable browser storage instead of deleting it from pagehide: unload-time
  // DELETE requests are inherently racy and used to discard minutes of parsing.
  useEffect(() => {
    pendingConvRef.current = null
    pendingCreateRef.current = null
    pendingConsumedRef.current = false
    const savedID = readPendingConversation(pendingStorageKey)
    setPendingConversationId(savedID)
    if (!savedID) return
    let cancelled = false
    const recovery = (async () => {
      try {
        const loaded = await conversationsApi.get(savedID, { limit: 1 })
        if (loaded.messages.length > 0) {
          clearPendingConversation(pendingStorageKey)
          if (!cancelled) setPendingConversationId(undefined)
          return undefined
        }
        // A send can claim this recovery promise before the request settles.
        // Return the row to that background handoff without reinstalling the
        // draft state or storage entry after the home route has gone away.
        if (!cancelled && !pendingConsumedRef.current) {
          pendingConvRef.current = loaded.conversation
          setPendingConversationId(savedID)
        }
        return loaded.conversation
      } catch {
        clearPendingConversation(pendingStorageKey)
        if (!cancelled) setPendingConversationId(undefined)
        return undefined
      }
    })()
    pendingCreateRef.current = recovery
    void recovery.finally(() => {
      if (pendingCreateRef.current === recovery) pendingCreateRef.current = null
    })
    return () => {
      cancelled = true
    }
  }, [pendingStorageKey])

  // Lazily create (once) the conversation the first attachment will be scoped
  // to. Idempotent: repeat attaches in the same draft reuse the same id — the
  // in-flight promise is memoized so two quick attaches share ONE create. Does
  // NOT navigate — that happens on send, so attaching a file doesn't yank the
  // user off the home screen mid-compose. Returning undefined on failure lets
  // the composer fall back to a scope-less (non-RAG) upload instead of
  // uploading against a fabricated id the server would reject.
  function ensureConversation(): Promise<string | undefined> {
    // A fresh attach revives an abandoned draft scope (see discardDraftConversation).
    draftAbandonedRef.current = false
    if (pendingConvRef.current) return Promise.resolve(pendingConvRef.current.id)
    if (!pendingCreateRef.current) {
      const storageKey = pendingStorageKey
      const creation = (async () => {
        try {
          const created = await conversationsApi.create({
            model_id: modelId || undefined,
            workspace_id: workspaceId,
            fast,
          })
          // A suggestion card can bypass the composer's upload gate while this
          // create is in flight. A mode/workspace switch also invalidates this
          // scope before any upload starts. So does removing every attachment
          // before the create lands (draft abandoned).
          if (draftAbandonedRef.current || pendingStorageKeyRef.current !== storageKey) {
            void conversationsApi.remove(created.id).catch(() => {})
            return undefined
          }
          // startNew claimed this in-flight reservation. Hand the row to the
          // optimistic send, but do not recreate a pending-draft storage entry
          // after navigation has already consumed it.
          if (pendingConsumedRef.current) return created
          writePendingConversation(storageKey, created.id)
          if (!mountedRef.current) return created
          pendingConvRef.current = created
          setPendingConversationId(created.id)
          return created
        } catch {
          return undefined
        }
      })()
      pendingCreateRef.current = creation
      void creation.finally(() => {
        if (pendingCreateRef.current === creation) pendingCreateRef.current = null
      })
    }
    return pendingCreateRef.current.then((conversation) => conversation?.id)
  }

  // The composer removed its LAST attachment: the draft conversation existed
  // purely to scope those uploads, so delete it — otherwise it lingers
  // server-side forever and surfaces as an "Untitled" row on the next sidebar
  // load. A create still in flight is flagged instead (it self-discards on
  // landing); a subsequent attach simply creates a fresh scope.
  function discardDraftConversation() {
    if (pendingConsumedRef.current) return
    draftAbandonedRef.current = true
    const pending = pendingConvRef.current
    pendingConvRef.current = null
    clearPendingConversation(pendingStorageKey)
    setPendingConversationId(undefined)
    if (pending) void conversationsApi.remove(pending.id).catch(() => {})
  }

  // Entrance choreography — the heading, lead and composer rise + fade in
  // sequence. All gated behind prefers-reduced-motion via gsap.matchMedia.
  const root = useRef<HTMLDivElement>(null)
  // Drawing mode: the gallery sits below the centered hero; the scroll cue jumps
  // to it, and the gallery itself defers loading until scrolled into view.
  const galleryRef = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
        // opacity (not autoAlpha) so the composer stays focusable while fading —
        // autoAlpha's visibility:hidden would swallow the textarea's autoFocus.
        tl.from('.home-rise', { y: 16, opacity: 0, duration: 0.6, stagger: 0.09 })
      })
    },
    { scope: root },
  )

  function startNew(
    text: string,
    attachments: Attachment[],
    opts: {
      mode?: 'default' | 'deep-research' | 'canvas'
      params?: Record<string, unknown>
      imageStyleId?: string
      optimizeImagePrompt?: boolean
      verify?: boolean
      toolMode: ToolMode
      webSearch?: boolean
      selectedUserSkillIds?: string[]
      selectedToolIds?: string[]
      fast?: boolean
    },
  ) {
    if (!user) {
      useAuthModal.getState().show('login', '/')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    // Claim the attachment/recovery reservation synchronously, but wait for it
    // only inside sendMessage after the optimistic route is already visible.
    // A resolved draft is reused so uploaded files keep their original owner;
    // an invalid/failed reservation falls back to creating a fresh conversation.
    const pending = pendingConvRef.current
    const preparedConversation = pending
      ? Promise.resolve(pending)
      : pendingCreateRef.current ?? undefined
    pendingConsumedRef.current = true
    pendingConvRef.current = null
    setPendingConversationId(undefined)
    clearPendingConversation(pendingStorageKey)

    enterOptimisticConversation({
      createConversation: () =>
        beginOptimisticConversation(
          text,
          modelId,
          opts.fast === true,
          selectedKnowledgeBaseIds,
        ),
      beforeNavigate: () => clearComposerDraft(draftScope),
      // Commit the already-loaded thread before background conversation work
      // starts. This is the one transition where a visible response in the same
      // click matters more than React's normal event-batch deferral.
      navigate: (tempId) => flushSync(() => navigate(`/chat/${tempId}`)),
      startBackgroundWork: (tempId) => sendMessage({
        conversationId: tempId,
        createFirst: true,
        preparedConversation,
        text,
        modelId,
        attachments,
        mode: opts.mode,
        params: opts.params,
        imageStyleId: opts.imageStyleId,
        optimizeImagePrompt: opts.optimizeImagePrompt,
        verify: opts.verify,
        toolMode: opts.toolMode,
        webSearch: opts.webSearch,
        selectedUserSkillIds: opts.selectedUserSkillIds,
        selectedToolIds: opts.selectedToolIds,
        fast: opts.fast,
        // Swap temp→real id in the URL only if the user is STILL on the optimistic
        // thread. If they navigated elsewhere during the create round-trip, leave
        // them be — the stream still lands in the (re-keyed) real conversation,
        // reachable from the sidebar; yanking them would be worse than a stale URL.
        onConversationId: (realId) => {
          if (window.location.pathname === `/chat/${tempId}`) {
            navigate(`/chat/${realId}`, { replace: true })
          }
        },
      }),
    })
  }

  return (
    <div
      ref={root}
      className={cn(
        'relative flex-1 flex flex-col overflow-hidden sm:overflow-y-auto sm:overflow-x-hidden',
        // Drawing keeps its existing scrollable gallery on phones. The normal
        // chat home below is a fixed-height mobile workspace instead.
        drawMode && 'max-sm:overflow-y-auto',
      )}
    >
      {/* Mobile home: a compact, direct way to reach the navigation drawer. */}
      <button
        type="button"
        aria-label={t('commandMenu.actions.toggleSidebar')}
        onClick={() => useUI.getState().setNavOpen(true)}
        className="lg:hidden absolute left-3 top-3 z-20 inline-flex size-[var(--tap-min)] items-center justify-center rounded-[10px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] max-sm:left-2 max-sm:top-2 max-sm:size-10 max-sm:rounded-[8px]"
      >
        <Menu size={17} aria-hidden />
      </button>
      {/* Mobile home top-right: the account avatar opens the same menu the
          sidebar footer's avatar does (placement="header" adapts the trigger +
          popup direction for a top-right corner). */}
      <div className="lg:hidden absolute right-3 top-3 z-20 max-sm:right-2 max-sm:top-2">
        <UserMenu placement="header" />
      </div>
      {/* Phone chat home: welcome copy occupies the available center space while
          the composer remains in a dedicated bottom work area. */}
      {!drawMode && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col px-3 sm:hidden">
          <header className="flex min-h-0 flex-1 flex-col items-center justify-center pb-8 pt-12 text-center">
            <h1 className="home-rise max-w-[18rem] text-balance font-sans text-[20px] font-semibold leading-[1.14] tracking-tight text-[var(--color-fg)]">
              {t('empty.subtitle')}
            </h1>
          </header>
          <div className="home-rise shrink-0 pb-2">
            <Composer
              modelId={modelId}
              onModelChange={handleModelChange}
              fast={fast}
              onFastChange={setPickedFast}
              onSubmit={(text, atts, opts) => void startNew(text, atts, opts)}
              draftScope={draftScope}
              conversationId={pendingConversationId}
              ensureConversationId={ensureConversation}
              onAttachmentsDrained={discardDraftConversation}
              kbIds={selectedKnowledgeBaseIds}
              onKBChange={setSelectedKnowledgeBaseIds}
              showToolControls={false}
              autoFocus
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative z-10 mx-auto min-h-full w-full max-w-[var(--layout-message-max-w)] flex-col px-[var(--layout-gutter-mobile)] sm:px-8',
          drawMode ? 'flex' : 'hidden sm:flex',
        )}
      >
        {/* HERO — title + composer, vertically centered in the first screenful
            (both chat and drawing mode, PC and mobile). In drawing mode it caps at
            ~one viewport so the gallery sits just below the fold. */}
        <div className={cn('flex flex-col', drawMode ? 'min-h-[90dvh]' : 'flex-1')}>
          <div className="flex flex-1 flex-col justify-center py-10 sm:py-12">
            <header className="text-center">
              <h1 className="home-rise font-sans font-semibold tracking-tight text-[20px] sm:text-[30px] leading-[1.14] sm:leading-[1.12] text-[var(--color-fg)] text-balance">
                {t('empty.subtitle')}
              </h1>
              {drawMode ? (
                <p className="home-rise mt-3.5 text-[var(--color-fg-muted)] text-sm sm:text-base text-pretty mx-auto max-w-2xl">
                  {t('empty.drawLead', { defaultValue: 'Describe what you want to create — your gallery is below.' })}
                </p>
              ) : null}
            </header>

            {/* Fixed, comfortable width — deliberately NOT --layout-message-max-w,
                so the home input doesn't widen with the appearance → chat-width
                ("full") setting (that governs the conversation column, not this). */}
            <div className="home-rise mt-7 sm:mt-10 mx-auto w-full max-w-[44rem]">
              <Composer
                modelId={modelId}
                onModelChange={handleModelChange}
                fast={fast}
                onFastChange={setPickedFast}
                onSubmit={(text, atts, opts) => void startNew(text, atts, opts)}
                draftScope={draftScope}
                conversationId={pendingConversationId}
                ensureConversationId={ensureConversation}
                onAttachmentsDrained={discardDraftConversation}
                kbIds={selectedKnowledgeBaseIds}
                onKBChange={setSelectedKnowledgeBaseIds}
                showToolControls={false}
                autoFocus
              />
            </div>

          </div>

          {/* Drawing mode: a bobbing cue at the bottom of the first screen that
              jumps to the (below-the-fold, lazily-loaded) gallery. */}
          {drawMode && (
            <button
              type="button"
              onClick={() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-label={t('empty.galleryScrollCue', { defaultValue: '下拉查看我的画廊' })}
              className="home-rise mx-auto mb-6 inline-flex size-10 items-center justify-center rounded-full text-[var(--color-fg-faint)] interactive hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <ChevronDown size={20} strokeWidth={1.5} aria-hidden className="animate-[bob_1.6s_ease-in-out_infinite]" />
            </button>
          )}
        </div>

        {/* §4.20 gallery — below the fold; defers its own image fetch until it
            scrolls into view (shows just the heading + a "scroll to view" hint). */}
        {drawMode && (
          <div ref={galleryRef} className="pb-16 sm:pb-20">
            <MyGallery />
          </div>
        )}
      </div>
    </div>
  )
}
