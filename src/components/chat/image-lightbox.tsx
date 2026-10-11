/**
 * Full-screen image preview and the right-side image editor body.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Eraser, Image as ImageIcon, Maximize2, Pencil, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogClose, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import {
  clampImageViewerPan,
  clampImageViewerZoom,
  IMAGE_VIEWER_ZOOM_MAX,
  IMAGE_VIEWER_ZOOM_MIN,
  IMAGE_VIEWER_ZOOM_STEP,
  type ImageViewerPan,
} from '@/lib/image-viewer'
import type { Attachment } from '@/types/chat'
import { useModels } from '@/store/models'
import { useAuth } from '@/store/auth'
import type { ImageEditSource } from '@/store/image-edit'
import { Composer } from './composer'

export interface ImageLightboxImage {
  id?: string
  src: string
  alt?: string
  downloadUrl?: string
  filename?: string
  editAttachment?: Attachment
}

interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
  alt?: string
  downloadUrl?: string
  filename?: string
  images?: ImageLightboxImage[]
  initialIndex?: number
  onEdit?: (image: ImageLightboxImage) => void
}

export interface ImageEditPanelProps {
  open: boolean
  source: ImageEditSource
  conversationId?: string
  onClose: () => void
  onSubmit: (
    text: string,
    attachments: Attachment[],
    imageModelId: string,
    options: { optimizeImagePrompt?: boolean },
  ) => void
}

const IMAGE_EDIT_PROMPTS = [
  { key: 'square', ratio: '1:1' },
  { key: 'portrait', ratio: '3:4' },
  { key: 'story', ratio: '9:16' },
  { key: 'landscape', ratio: '4:3' },
  { key: 'wide', ratio: '16:9' },
] as const

interface ImageDrag {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

function ImageEditToolbar({
  sizeMenuOpen,
  onSizeMenuOpenChange,
  onFillPrompt,
}: {
  sizeMenuOpen: boolean
  onSizeMenuOpenChange: (open: boolean) => void
  onFillPrompt: (prompt: string) => void
}) {
  const { t } = useTranslation('common')
  const removeBackgroundPrompt = t('chat:imageEditor.removeBackgroundPrompt', {
    defaultValue:
      'Remove the background from this image. Keep every foreground subject unchanged and fully intact, with clean, smooth edges. Make the background transparent.',
  })

  return (
    <div
      className="inline-flex w-fit items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-sm)]"
      role="toolbar"
      aria-label={t('chat:imageEditor.toolbar', { defaultValue: 'Image editing tools' })}
    >
      <button
        type="button"
        onClick={() => onFillPrompt(removeBackgroundPrompt)}
        className="inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <Eraser size={15} strokeWidth={1.8} aria-hidden />
        {t('chat:imageEditor.removeBackground', { defaultValue: 'Remove background' })}
      </button>
      <Popover open={sizeMenuOpen} onOpenChange={onSizeMenuOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={sizeMenuOpen}
            className="inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <Maximize2 size={15} strokeWidth={1.8} aria-hidden />
            {t('chat:imageEditor.resize', { defaultValue: 'Resize' })}
            <ChevronDown size={13} aria-hidden className={cn('transition-transform', sizeMenuOpen && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" sideOffset={8} className="w-60 rounded-[10px] p-1.5">
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-[var(--color-fg-subtle)]">
            {t('chat:imageEditor.resizeTitle', { defaultValue: 'Choose aspect ratio' })}
          </p>
          <div role="menu" aria-label={t('chat:imageEditor.resizeTitle', { defaultValue: 'Choose aspect ratio' })}>
            {IMAGE_EDIT_PROMPTS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  onFillPrompt(
                    t('chat:imageEditor.resizePrompt', {
                      ratio: option.ratio,
                      defaultValue: 'Set the aspect ratio to {{ratio}}',
                    }),
                  )
                  onSizeMenuOpenChange(false)
                }}
                className="flex min-h-10 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-bg-muted)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-[var(--color-border-strong)]" aria-hidden />
                <span className="flex-1">{t(`chat:imageEditor.${option.key}`, { defaultValue: option.ratio })}</span>
                <span className="text-[12px] text-[var(--color-fg-subtle)]">{option.ratio}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function ImageEditPanel({ open, source, conversationId, onClose, onSubmit }: ImageEditPanelProps) {
  const { t } = useTranslation('common')
  const imageModels = useModels((state) => state.imageModels)
  const user = useAuth((state) => state.user)
  const [editPrompt, setEditPrompt] = useState('')
  const [promptRevision, setPromptRevision] = useState(0)
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const [editModelId, setEditModelId] = useState('')

  useEffect(() => {
    if (!open) return
    setEditPrompt('')
    setPromptRevision((revision) => revision + 1)
    setSizeMenuOpen(false)
    const savedModelId = typeof user?.settings?.image_model_id === 'string' ? user.settings.image_model_id : ''
    setEditModelId(
      imageModels.some((model) => model.id === savedModelId)
        ? savedModelId
        : imageModels[0]?.id ?? '',
    )
  }, [imageModels, open, source.id, user?.settings?.image_model_id])

  function fillEditPrompt(prompt: string) {
    setEditPrompt(prompt)
    setPromptRevision((revision) => revision + 1)
  }

  const href = source.src
  const filename = source.filename ?? source.alt
  const sourceAttachment = source.attachment

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <ImageIcon size={14} aria-hidden className="text-[var(--color-secondary)]" />
        <span className="min-w-0 flex-1 truncate font-sans text-[15px] font-medium tracking-normal text-[var(--color-fg)]">
          {t('chat:imageEditor.title', { defaultValue: 'Edit image' })}
        </span>
        <a
          href={href}
          download={filename ?? ''}
          aria-label={t('actions.download')}
          title={t('actions.download')}
          className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <Download size={15} aria-hidden />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('actions.close')}
          title={t('actions.close')}
          className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <X size={15} aria-hidden />
        </button>
      </header>

      <div className="flex shrink-0 justify-center px-3 py-3">
        <ImageEditToolbar
          sizeMenuOpen={sizeMenuOpen}
          onSizeMenuOpenChange={setSizeMenuOpen}
          onFillPrompt={fillEditPrompt}
        />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)]">
        <div className="mx-auto flex min-h-full w-full flex-col items-center px-4 sm:px-5">
          <div className="flex min-h-[16rem] min-w-0 flex-1 items-center justify-center bg-[var(--color-surface)] py-5 sm:py-7">
            <img
              src={source.src}
              alt={source.alt ?? ''}
              className="max-h-[min(58dvh,42rem)] max-w-full object-contain"
              draggable={false}
            />
          </div>
          <div className="w-full shrink-0 pb-4 sm:pb-6">
            <Composer
              key={`${sourceAttachment?.id ?? source.id}:${promptRevision}`}
              modelId={editModelId}
              onModelChange={setEditModelId}
              initialValue={editPrompt}
              valueRequest={{ value: editPrompt, revision: promptRevision }}
              onSubmit={(text, attachments) => {
                if (!sourceAttachment || !editModelId) return
                onSubmit(
                  text,
                  [sourceAttachment, ...attachments.filter((attachment) => attachment.id !== sourceAttachment.id)],
                  editModelId,
                  { optimizeImagePrompt: true },
                )
                onClose()
              }}
              imageOnly
              conversationId={conversationId}
              placeholder={t('chat:composer.imagePromptRequired', {
                defaultValue: 'Describe how you want to edit this image.',
              })}
              commandsEnabled={false}
              minimal
              surfaceClassName="bg-white"
              autoFocus
            />
          </div>
        </div>
      </main>
    </div>
  )
}

export function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
  downloadUrl,
  filename,
  images,
  initialIndex,
  onEdit,
}: ImageLightboxProps) {
  const { t } = useTranslation('common')
  const gallery = images?.length ? images : [{ src, alt, downloadUrl, filename }]
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex ?? 0, gallery.length - 1)),
  )
  const [zoom, setZoom] = useState(IMAGE_VIEWER_ZOOM_MIN)
  const [pan, setPan] = useState<ImageViewerPan>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const zoomRef = useRef(IMAGE_VIEWER_ZOOM_MIN)
  const dragRef = useRef<ImageDrag | null>(null)
  const activeImage = gallery[activeIndex] ?? gallery[0]
  const activeSrc = activeImage?.src ?? src
  const activeAlt = activeImage?.alt ?? alt
  const activeHref = activeImage?.downloadUrl ?? activeSrc
  const activeFilename = activeImage?.filename ?? filename

  const clampPan = useCallback((candidate: ImageViewerPan, nextZoom: number): ImageViewerPan => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return { x: 0, y: 0 }
    return clampImageViewerPan(
      candidate,
      { width: image.clientWidth, height: image.clientHeight },
      { width: viewport.clientWidth, height: viewport.clientHeight },
      nextZoom,
    )
  }, [])

  const resetView = useCallback(() => {
    zoomRef.current = IMAGE_VIEWER_ZOOM_MIN
    dragRef.current = null
    setZoom(IMAGE_VIEWER_ZOOM_MIN)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
  }, [])

  const setViewerZoom = useCallback((requestedZoom: number) => {
    const nextZoom = clampImageViewerZoom(requestedZoom)
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setPan((currentPan) => clampPan(currentPan, nextZoom))
  }, [clampPan])

  useEffect(() => {
    if (!open) return
    setActiveIndex(Math.max(0, Math.min(initialIndex ?? 0, gallery.length - 1)))
    resetView()
  }, [gallery.length, initialIndex, open, resetView])

  useEffect(() => {
    if (open) resetView()
  }, [activeSrc, open, resetView])

  useEffect(() => {
    const constrainCurrentPan = () => {
      setPan((currentPan) => clampPan(currentPan, zoomRef.current))
    }
    window.addEventListener('resize', constrainCurrentPan)
    return () => window.removeEventListener('resize', constrainCurrentPan)
  }, [clampPan])

  function navigateGallery(direction: -1 | 1) {
    if (gallery.length < 2) return
    resetView()
    setActiveIndex((index) => (index + direction + gallery.length) % gallery.length)
  }

  function handleViewerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setViewerZoom(zoomRef.current + IMAGE_VIEWER_ZOOM_STEP)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      setViewerZoom(zoomRef.current - IMAGE_VIEWER_ZOOM_STEP)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      resetView()
      return
    }
    if (event.key === 'ArrowLeft' && gallery.length > 1) {
      event.preventDefault()
      navigateGallery(-1)
      return
    }
    if (event.key === 'ArrowRight' && gallery.length > 1) {
      event.preventDefault()
      navigateGallery(1)
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    setViewerZoom(zoomRef.current + direction * IMAGE_VIEWER_ZOOM_STEP)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoomRef.current <= IMAGE_VIEWER_ZOOM_MIN || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    }
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan(clampPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }, zoomRef.current))
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsDragging(false)
  }

  const zoomLabel = Math.round(zoom * 100) + '%'
  const atMinimumZoom = zoom <= IMAGE_VIEWER_ZOOM_MIN
  const atMaximumZoom = zoom >= IMAGE_VIEWER_ZOOM_MAX

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-white" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[70] flex min-h-0 flex-col bg-white focus:outline-none data-[state=open]:animate-[fade-in_220ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_140ms_var(--ease-in)]"
          aria-label={activeAlt ?? t('chat:imagePreview.title', { defaultValue: 'Image preview' })}
          onKeyDown={handleViewerKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">{activeAlt || 'Image'}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{activeAlt || ''}</DialogPrimitive.Description>

          <header className="flex h-14 shrink-0 items-center justify-end gap-1.5 px-4 sm:px-6">
            <a
              href={activeHref}
              download={activeFilename ?? ''}
              aria-label={t('actions.download')}
              title={t('actions.download')}
              className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-fg)] shadow-[var(--shadow-sm)] hover:bg-white interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <Download size={15} aria-hidden />
            </a>
            {activeImage?.editAttachment && onEdit ? (
              <button
                type="button"
                onClick={() => onEdit(activeImage)}
                aria-label={t('actions.edit')}
                title={t('actions.edit')}
                className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-fg)] shadow-[var(--shadow-sm)] hover:bg-white interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <Pencil size={15} aria-hidden />
              </button>
            ) : null}
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t('actions.close')}
                title={t('actions.close')}
                className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-fg)] shadow-[var(--shadow-sm)] hover:bg-white interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <X size={15} aria-hidden />
              </button>
            </DialogClose>
          </header>

          <main className="flex min-h-0 flex-1 items-center justify-center gap-3 px-3 pb-3 sm:gap-6 sm:px-6 sm:pb-5">
            {gallery.length > 1 ? (
              <button
                type="button"
                onClick={() => navigateGallery(-1)}
                aria-label={t('actions.previous', { defaultValue: 'Previous image' })}
                title={t('actions.previous', { defaultValue: 'Previous image' })}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-fg)] shadow-[var(--shadow-sm)] hover:bg-white interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
            ) : <span className="size-11 shrink-0" aria-hidden />}

            <div
              ref={viewportRef}
              className={cn(
                'relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
                'self-stretch',
                atMinimumZoom ? 'cursor-zoom-in' : isDragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
              tabIndex={0}
              role="group"
              aria-label={t('chat:imagePreview.hint', { defaultValue: 'Scroll to zoom, drag to pan.' })}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onClick={() => {
                if (zoomRef.current === IMAGE_VIEWER_ZOOM_MIN) setViewerZoom(2)
              }}
            >
              <div
                className={cn('absolute left-1/2 top-1/2 will-change-transform', !isDragging && 'transition-transform duration-150')}
                style={{ transform: 'translate(-50%, -50%) translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0)' }}
              >
                <img
                  ref={imageRef}
                  src={activeSrc}
                  alt={activeAlt ?? ''}
                  className={cn(
                    'block max-h-[min(78vh,calc(100dvh-8rem))] max-w-[min(78vw,72rem)] select-none object-contain will-change-transform',
                    !isDragging && 'transition-transform duration-150',
                  )}
                  style={{ transform: 'scale(' + zoom + ')' }}
                  draggable={false}
                  onLoad={() => setPan((currentPan) => clampPan(currentPan, zoomRef.current))}
                />
              </div>
            </div>

            {gallery.length > 1 ? (
              <button
                type="button"
                onClick={() => navigateGallery(1)}
                aria-label={t('actions.next', { defaultValue: 'Next image' })}
                title={t('actions.next', { defaultValue: 'Next image' })}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-fg)] shadow-[var(--shadow-sm)] hover:bg-white interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            ) : <span className="size-11 shrink-0" aria-hidden />}
          </main>

          <footer className="flex h-14 shrink-0 items-center justify-center gap-3 px-3 sm:px-6">
            <div
              className="inline-flex h-9 items-center rounded-[8px] border border-[var(--color-border)] bg-white p-0.5 shadow-[var(--shadow-sm)]"
              role="toolbar"
              aria-label={t('chat:imagePreview.controls', { defaultValue: 'Image preview controls' })}
            >
              <button
                type="button"
                onClick={() => setViewerZoom(zoomRef.current - IMAGE_VIEWER_ZOOM_STEP)}
                disabled={atMinimumZoom}
                aria-label={t('chat:imagePreview.zoomOut', { defaultValue: 'Zoom out' })}
                title={t('chat:imagePreview.zoomOut', { defaultValue: 'Zoom out' })}
                className="inline-flex size-8 items-center justify-center rounded-[6px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-35 interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <ZoomOut size={15} aria-hidden />
              </button>
              <output className="min-w-12 px-1 text-center text-[11px] tabular-nums text-[var(--color-fg-muted)]" aria-live="polite">
                {zoomLabel}
              </output>
              <button
                type="button"
                onClick={resetView}
                disabled={atMinimumZoom}
                aria-label={t('chat:imagePreview.reset', { defaultValue: 'Fit to view' })}
                title={t('chat:imagePreview.reset', { defaultValue: 'Fit to view' })}
                className="inline-flex size-8 items-center justify-center rounded-[6px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-35 interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <RotateCcw size={15} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setViewerZoom(zoomRef.current + IMAGE_VIEWER_ZOOM_STEP)}
                disabled={atMaximumZoom}
                aria-label={t('chat:imagePreview.zoomIn', { defaultValue: 'Zoom in' })}
                title={t('chat:imagePreview.zoomIn', { defaultValue: 'Zoom in' })}
                className="inline-flex size-8 items-center justify-center rounded-[6px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-35 interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <ZoomIn size={15} aria-hidden />
              </button>
            </div>
            {gallery.length > 1 ? (
              <span className="text-[11px] tabular-nums text-[var(--color-fg-muted)]">
                {activeIndex + 1} / {gallery.length}
              </span>
            ) : null}
          </footer>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
