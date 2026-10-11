import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutTemplate, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { canvasesApi } from '@/api'
import type { ApiCanvas } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ContentHeader } from '@/components/layout/content-header'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/store/auth'
import { useAuthModal } from '@/store/auth-modal'

function formatUpdatedAt(value: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value * 1000)
}

function localizedCanvasName(name: string, translate: (key: string) => string): string {
  return name === 'Untitled canvas' || name === '未命名画布' || name === '未命名畫布' ? translate('canvas:untitled') : name
}

export default function CanvasList() {
  const { t, i18n } = useTranslation(['canvas', 'common'])
  const navigate = useNavigate()
  const user = useAuth((state) => state.user)
  const showAuth = useAuthModal((state) => state.show)
  const [items, setItems] = useState<ApiCanvas[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!user) {
      setItems([])
      setLoaded(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setItems(await canvasesApi.list())
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:common.error', { defaultValue: 'Unable to load canvases' }))
    } finally {
      setLoading(false)
    }
  }, [t, user])

  useEffect(() => { void load() }, [load])

  const sorted = useMemo(() => items.slice().sort((a, b) => b.updated_at - a.updated_at), [items])

  function createCanvas() {
    if (!user) {
      showAuth('login', '/canvas')
      return
    }
    setCreateName('')
    setCreateOpen(true)
  }

  async function submitCreateCanvas() {
    const name = createName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const created = await canvasesApi.create(name)
      setItems((current) => [created, ...current])
      setCreateOpen(false)
      navigate(`/canvas/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:common.error', { defaultValue: 'Unable to create canvas' }))
    } finally {
      setCreating(false)
    }
  }

  function beginRename(item: ApiCanvas) {
    setEditingId(item.id)
    setEditingName(localizedCanvasName(item.name, t))
  }

  async function commitRename(item: ApiCanvas) {
    const name = editingName.trim()
    setEditingId(null)
    if (!name || name === item.name) return
    try {
      const updated = await canvasesApi.update(item.id, { name })
      setItems((current) => current.map((candidate) => candidate.id === item.id ? updated : candidate))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:common.error', { defaultValue: 'Unable to rename canvas' }))
    }
  }

  async function deleteCanvas(item: ApiCanvas) {
    if (!window.confirm(t('canvas:deleteConfirm', { defaultValue: 'Delete this canvas? This cannot be undone.' }))) return
    try {
      await canvasesApi.remove(item.id)
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:common.error', { defaultValue: 'Unable to delete canvas' }))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <ContentHeader
        title={t('canvas:title', { defaultValue: 'Infinite canvas' })}
        actions={<Button variant="contrast" size="sm" leadingIcon={<Plus size={15} aria-hidden />} onClick={() => void createCanvas()}>{t('canvas:new', { defaultValue: 'New canvas' })}</Button>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded || loading ? (
          <div className="mx-auto grid w-full max-w-[var(--layout-content-max-w)] grid-cols-1 gap-5 px-5 py-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
            {[0, 1, 2].map((key) => <Skeleton key={key} className="h-[220px] rounded-[16px]" />)}
          </div>
        ) : error ? (
          <EmptyState icon={<LayoutTemplate size={20} aria-hidden />} title={t('common:common.error', { defaultValue: 'Something went wrong' })} description={error} action={<Button variant="secondary" leadingIcon={<RefreshCw size={15} aria-hidden />} onClick={() => void load()}>{t('common:actions.tryAgain', { defaultValue: 'Try again' })}</Button>} />
        ) : sorted.length === 0 ? (
          <div className="flex min-h-full items-center justify-center px-5 py-10">
            <div className="flex w-full max-w-[390px] flex-col items-center text-center">
              <CanvasIllustration />
              <h2 className="mt-6 text-[22px] font-semibold tracking-tight">{t('canvas:emptyTitle', { defaultValue: 'Create your first canvas' })}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-fg-muted)]">{t('canvas:emptyBody', { defaultValue: 'Arrange reference images, branch ideas, and generate multiple options in one place.' })}</p>
              <Button className="mt-6" variant="contrast" leadingIcon={<Plus size={16} aria-hidden />} onClick={() => void createCanvas()}>{t('canvas:new', { defaultValue: 'New canvas' })}</Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[var(--layout-content-max-w)] px-5 py-8 sm:px-8 sm:py-10">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <button type="button" onClick={() => void createCanvas()} className="group flex min-h-[220px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] shadow-[var(--shadow-xs)] transition hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
                <span className="grid size-11 place-items-center rounded-[12px] bg-[var(--color-bg-muted)] text-[var(--color-accent)] transition group-hover:scale-105"><Plus size={21} aria-hidden /></span>
                <span className="mt-3 text-sm font-medium">{t('canvas:new', { defaultValue: 'New canvas' })}</span>
              </button>
              {sorted.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)]">
                  <button type="button" onClick={() => navigate(`/canvas/${item.id}`)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]">
                    <CanvasThumbnail canvas={item} />
                  </button>
                  <div className="flex items-start gap-2 border-t border-[var(--color-divider)] px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      {editingId === item.id ? (
                        <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onBlur={() => void commitRename(item)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(item) }; if (event.key === 'Escape') setEditingId(null) }} className="h-7 w-full rounded-[6px] border border-[var(--color-accent)] bg-transparent px-1 text-sm font-semibold outline-none" aria-label={t('canvas:rename', { defaultValue: 'Canvas name' })} />
                      ) : <h3 className="truncate text-sm font-semibold">{localizedCanvasName(item.name, t)}</h3>}
                      <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{t('canvas:updated', { defaultValue: 'Updated' })} {formatUpdatedAt(item.updated_at, i18n.language)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip content={t('canvas:rename', { defaultValue: 'Rename' })}>
                        <button type="button" aria-label={t('canvas:rename', { defaultValue: 'Rename' })} onClick={() => beginRename(item)} className="grid size-7 place-items-center rounded-[7px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)]"><Pencil size={13} aria-hidden /></button>
                      </Tooltip>
                      <Tooltip content={t('common:actions.delete', { defaultValue: 'Delete' })}>
                        <button type="button" aria-label={t('common:actions.delete', { defaultValue: 'Delete' })} onClick={() => void deleteCanvas(item)} className="grid size-7 place-items-center rounded-[7px] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"><Trash2 size={13} aria-hidden /></button>
                      </Tooltip>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
      <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open) }}>
        <DialogContent size="sm" className="!max-w-[22.5rem]">
          <DialogHeader>
            <DialogTitle>{t('canvas:createTitle', { defaultValue: 'New canvas' })}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              id="new-canvas-name"
              autoFocus
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCreateCanvas() } }}
              placeholder={t('canvas:namePlaceholder', { defaultValue: 'Enter canvas name' })}
              maxLength={160}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>{t('common:actions.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button variant="contrast" onClick={() => void submitCreateCanvas()} loading={creating} disabled={!createName.trim()}>{t('common:actions.create', { defaultValue: 'Create' })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CanvasThumbnail({ canvas }: { canvas: ApiCanvas }) {
  let preview: string | undefined
  try {
    const data = JSON.parse(canvas.data) as { nodes?: Array<{ type?: string; imageUrl?: string }> }
    preview = data.nodes?.find((node) => node.type === 'result' && node.imageUrl)?.imageUrl ?? data.nodes?.find((node) => node.type === 'reference' && node.imageUrl)?.imageUrl
  } catch { /* malformed snapshots fall back to the empty preview */ }
  return <div className="relative flex h-[158px] items-center justify-center overflow-hidden bg-[var(--color-surface-sunken)]">
    <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(var(--color-border-strong)_1px,transparent_1px)] [background-size:16px_16px]" />
    {preview ? <img src={preview} alt="" className="relative size-full object-cover" /> : <span className="relative text-xs text-[var(--color-fg-subtle)]">空白画布</span>}
  </div>
}

function CanvasIllustration() {
  return <div className="relative aspect-[1.72] w-full overflow-hidden rounded-[20px] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] shadow-[var(--shadow-lg)]">
    <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(var(--color-border-strong)_1px,transparent_1px)] [background-size:18px_18px]" />
    <div className="absolute left-[10%] top-[22%] h-[42%] w-[23%] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-sm)]"><span className="block h-2 w-12 rounded-full bg-[var(--color-border-strong)]" /><span className="mt-2 block h-[58%] rounded-[7px] bg-[var(--color-bg-muted)]" /></div>
    <div className="absolute left-[43%] top-[18%] h-[27%] w-[21%] rounded-[11px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-sm)]"><span className="block h-2 w-10 rounded-full bg-[var(--color-border-strong)]" /><span className="mt-2 block h-2 w-14 rounded-full bg-[var(--color-bg-muted)]" /></div>
    <div className="absolute left-[43%] top-[52%] h-[28%] w-[22%] rounded-[11px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-sm)]"><span className="block h-2 w-4 rounded-full bg-[var(--color-border-strong)]" /><span className="mt-2 block h-2 w-12 rounded-full bg-[var(--color-bg-muted)]" /></div>
    <div className="absolute right-[10%] top-[23%] grid aspect-[0.68] w-[17%] place-items-center rounded-[11px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"><span className="size-7 rounded-full bg-[var(--color-info)] shadow-[0_0_14px_color-mix(in_srgb,var(--color-info)_65%,transparent)]" /></div>
    <svg className="absolute inset-0 size-full" viewBox="0 0 100 58" fill="none" aria-hidden><path d="M31 31C38 31 38 26 43 26M31 31C38 31 38 42 43 42M64 27C74 27 75 31 83 31" stroke="#8fb5ff" strokeWidth="0.7" strokeDasharray="2 2" /></svg>
  </div>
}
