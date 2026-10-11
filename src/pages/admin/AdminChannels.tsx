/**
 * AdminChannels — list, create and edit upstream channels.
 * Channels carry the (type + base_url + api_key + api_format) tuple from
 * design.md §2.3-B. The api_key column is never re-displayed; admins can leave
 * the field blank when editing to keep the existing secret.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListPlus, Plus, Pencil, Search, Trash2 } from 'lucide-react'
import { adminApi, ApiError } from '@/api'
import type { ApiChannel, ApiChannelModelImportResult, ApiDiscoveredChannelModel } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AdminSortableList } from '@/components/admin/AdminSortableList'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { PanelFallback } from '@/components/ui/panel-fallback'
import { normalizeOpenAIBaseUrl } from '@/lib/channel-base-url'

type Editable = Partial<ApiChannel> & { api_key?: string }
type ChannelEditor = {
  open: boolean
  row?: ApiChannel
  draft: Editable
  autoImportModels: boolean
}

const TYPES = ['openai', 'apimart', 'claude', 'gemini'] as const

export default function AdminChannels() {
  const { t } = useTranslation(['admin', 'common'])
  const [rows, setRows] = useState<ApiChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<ChannelEditor>(
    { open: false, draft: { type: 'openai', api_format: 'chat', enabled: true }, autoImportModels: true },
  )
  const [confirmDelete, setConfirmDelete] = useState<ApiChannel | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [showBaseUrlError, setShowBaseUrlError] = useState(false)
  const [modelPicker, setModelPicker] = useState<{ channel: ApiChannel; models: ApiDiscoveredChannelModel[] } | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [importingModels, setImportingModels] = useState(false)
  const importingModelsRef = useRef(false)
  const [discoveringModels, setDiscoveringModels] = useState(false)
  const [discoveryError, setDiscoveryError] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setRows(await adminApi.channels())
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('admin:common.failed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openNew() {
    setShowBaseUrlError(false)
    setEditor({
      open: true,
      draft: { type: 'openai', api_format: 'chat', enabled: true, name: '', base_url: '' },
      autoImportModels: true,
    })
  }

  function openEdit(row: ApiChannel) {
    setShowBaseUrlError(false)
    setEditor({ open: true, row, draft: { ...row, api_key: '' }, autoImportModels: false })
  }

  function showModelImportResult(result: ApiChannelModelImportResult) {
    if (result.created > 0) {
      toast.success(
        t('admin:channels.modelImport.selectionSuccess', { count: result.created }),
        result.skipped_existing > 0
          ? t('admin:channels.modelImport.selectionSkipped', { count: result.skipped_existing })
          : undefined,
      )
    } else {
      toast.warning(t('admin:channels.modelImport.selectionEmpty'))
    }
  }

  function closeModelPicker() {
    if (importingModelsRef.current || discoveringModels) return
    setModelPicker(null)
    setModelQuery('')
    setSelectedModelIds([])
  }

  async function discoverModelsForChannel(channel: ApiChannel) {
    setDiscoveringModels(true)
    setDiscoveryError(false)
    try {
      const discovery = await adminApi.discoverChannelModels(channel.id)
      setModelPicker({ channel, models: discovery.models })
      setSelectedModelIds([])
    } catch {
      setDiscoveryError(true)
    } finally {
      setDiscoveringModels(false)
    }
  }

  function openModelManager(channel: ApiChannel) {
    if (discoveringModels || importingModelsRef.current) return
    setModelPicker({ channel, models: [] })
    setModelQuery('')
    setSelectedModelIds([])
    void discoverModelsForChannel(channel)
  }

  async function importSelectedModels() {
    if (!modelPicker || selectedModelIds.length === 0 || importingModelsRef.current) return
    importingModelsRef.current = true
    setImportingModels(true)
    try {
      const result = await adminApi.importChannelModels(modelPicker.channel.id, selectedModelIds)
      setModelPicker(null)
      setModelQuery('')
      setSelectedModelIds([])
      showModelImportResult(result)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('admin:channels.modelImport.failed'))
    } finally {
      importingModelsRef.current = false
      setImportingModels(false)
    }
  }

  async function submit() {
    if (savingRef.current) return
    const d = editor.draft
    if (!d.name) {
      toast.error(t('admin:channels.errors.nameRequired'))
      return
    }
    const normalizedBaseUrl = d.type === 'openai'
      ? normalizeOpenAIBaseUrl(d.base_url ?? '')
      : (d.base_url ?? '').trim()
    if (normalizedBaseUrl === null) {
      setShowBaseUrlError(true)
      return
    }
    const payload = { ...d, name: d.name.trim(), base_url: normalizedBaseUrl }
    savingRef.current = true
    setSaving(true)
    try {
      if (editor.row) {
        await adminApi.updateChannel(editor.row.id, payload)
        toast.success(t('admin:channels.updated'))
      } else {
        const created = await adminApi.createChannel(payload)
        setEditor({ ...editor, open: false })
        if (!editor.autoImportModels) {
          await load()
          toast.success(t('admin:channels.created'))
          return
        }
        openModelManager(created)
        await load()
        return
      }
      setEditor({ ...editor, open: false })
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t('admin:common.nameExists', { defaultValue: 'A record with this name already exists.' }))
      } else {
        toast.error(e instanceof ApiError ? e.message : t('admin:common.failed'))
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function remove(row: ApiChannel) {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await adminApi.removeChannel(row.id)
      toast.success(t('admin:channels.removed'))
      setConfirmDelete(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('admin:common.failed'))
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  function persistOrder(next: ApiChannel[], prev: ApiChannel[]) {
    void adminApi.reorderChannels(next.map((r) => r.id)).catch((e) => {
      setRows(prev)
      toast.error(e instanceof ApiError ? e.message : t('admin:common.failed'))
    })
  }

  const normalizedModelQuery = modelQuery.trim().toLocaleLowerCase()
  const filteredModels = modelPicker?.models.filter((model) => {
    if (!normalizedModelQuery) return true
    return model.request_id.toLocaleLowerCase().includes(normalizedModelQuery)
      || model.label.toLocaleLowerCase().includes(normalizedModelQuery)
      || model.kind.includes(normalizedModelQuery)
  }) ?? []
  const supportedModelIds = modelPicker?.models.filter((model) => model.supported).map((model) => model.request_id) ?? []

  return (
    <div>
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl tracking-tight text-[var(--color-fg)] sm:text-3xl">{t('admin:channels.title')}</h1>
          <p className="mt-2 text-[var(--color-fg-muted)] text-sm max-w-2xl">{t('admin:channels.lead')}</p>
        </div>
        <Button className="min-h-[var(--tap-min)] w-full sm:min-h-0 sm:w-auto" leadingIcon={<Plus size={15} aria-hidden />} onClick={openNew}>
          {t('admin:channels.new')}
        </Button>
      </header>

      <section className="mt-8">
        {loading ? (
          <PanelFallback />
        ) : rows.length === 0 ? (
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
            <p className="text-[var(--color-fg-muted)] text-sm">{t('admin:channels.empty')}</p>
            <div className="mt-4">
              <Button onClick={openNew}>{t('admin:common.createFirst', { kind: t('admin:channels.title').toLowerCase() })}</Button>
            </div>
          </div>
        ) : (
          <AdminSortableList
            items={rows}
            onItemsChange={setRows}
            onOrderCommit={persistOrder}
            dragHandleLabel={t('admin:common.dragHandle')}
            moveUpLabel={t('admin:common.moveUp')}
            moveDownLabel={t('admin:common.moveDown')}
            mobileDragOnly
            rowClassName="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2 px-2 py-3.5 md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-4 md:px-5 md:py-4"
            renderItem={(r) => (
              <>
                <div className="col-start-2 row-start-1 min-w-0 md:col-start-auto md:row-start-auto">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--color-fg)] truncate">{r.name}</span>
                    <Badge size="xs">{r.type}</Badge>
                    {r.type === 'openai' && r.api_format ? <Badge size="xs">{r.api_format}</Badge> : null}
                    {r.enabled ? null : <Badge size="xs" variant="neutral">{t('admin:channels.labels.disabled')}</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--color-fg-subtle)] font-mono truncate">
                    {r.base_url || t('admin:channels.labels.defaultEndpoint')} · {r.has_api_key ? t('admin:channels.labels.keySet') : t('admin:channels.labels.noKey')}
                  </div>
                </div>
                <div className="col-span-2 row-start-2 flex items-center justify-end gap-1 md:contents">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="whitespace-nowrap max-md:size-[var(--tap-min)] max-md:gap-0 max-md:px-0"
                    aria-label={`${t('admin:channels.modelPicker.manage')}: ${r.name}`}
                    aria-busy={discoveringModels || undefined}
                    leadingIcon={<ListPlus size={13} aria-hidden />}
                    disabled={discoveringModels}
                    onClick={() => openModelManager(r)}
                  >
                    <span className="max-md:sr-only">{t('admin:channels.modelPicker.manage')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="whitespace-nowrap max-md:size-[var(--tap-min)] max-md:gap-0 max-md:px-0"
                    aria-label={`${t('admin:common.edit')}: ${r.name}`}
                    leadingIcon={<Pencil size={13} aria-hidden />}
                    onClick={() => openEdit(r)}
                  >
                    <span className="max-md:sr-only">{t('admin:common.edit')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="whitespace-nowrap max-md:size-[var(--tap-min)] max-md:gap-0 max-md:px-0"
                    aria-label={`${t('admin:common.remove')}: ${r.name}`}
                    leadingIcon={<Trash2 size={13} aria-hidden />}
                    onClick={() => setConfirmDelete(r)}
                  >
                    <span className="max-md:sr-only">{t('admin:common.remove')}</span>
                  </Button>
                </div>
              </>
            )}
          />
        )}
      </section>

      <Dialog open={editor.open} onOpenChange={(o) => !savingRef.current && setEditor({ ...editor, open: o })}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editor.row ? t('admin:channels.editorTitle') : t('admin:channels.newTitle')}</DialogTitle>
            <DialogDescription>
              {editor.row ? t('admin:channels.editorDescriptionEdit') : t('admin:channels.editorDescriptionNew')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              <Field label={t('admin:channels.fields.name')} htmlFor="ch-name">
                <Input
                  id="ch-name"
                  disabled={saving}
                  value={editor.draft.name ?? ''}
                  onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })}
                  placeholder="Anthropic production"
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('admin:channels.fields.type')} htmlFor="ch-type">
                  <Select
                    disabled={saving}
                    value={editor.draft.type ?? 'openai'}
                    onValueChange={(v) => {
                      const type = v as ApiChannel['type']
                      // api_format only applies to OpenAI; clear it for others.
                      setShowBaseUrlError(false)
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          type,
                          api_format: type === 'openai' ? (editor.draft.api_format ?? 'chat') : '',
                        },
                      })
                    }}
                  >
                    <SelectTrigger id="ch-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((tp) => (
                        <SelectItem key={tp} value={tp}>
                          {tp}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {editor.draft.type === 'openai' ? (
                  <Field label={t('admin:channels.fields.apiFormat')} htmlFor="ch-fmt" hint={t('admin:channels.fields.apiFormatHint')}>
                    <Select
                      disabled={saving}
                      value={editor.draft.api_format ?? 'chat'}
                      onValueChange={(v) => setEditor({ ...editor, draft: { ...editor.draft, api_format: v as ApiChannel['api_format'] } })}
                    >
                      <SelectTrigger id="ch-fmt">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="chat">chat</SelectItem>
                        <SelectItem value="responses">responses</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Field
                label={t('admin:channels.fields.baseUrl')}
                htmlFor="ch-url"
                hint={t(editor.draft.type === 'openai'
                  ? 'admin:channels.fields.openAIBaseUrlHint'
                  : 'admin:channels.fields.baseUrlHint')}
                error={editor.draft.type === 'openai'
                  && showBaseUrlError
                  && normalizeOpenAIBaseUrl(editor.draft.base_url ?? '') === null
                  ? t('admin:channels.errors.openAIBaseUrlV1Required')
                  : undefined}
              >
                <Input
                  id="ch-url"
                  disabled={saving}
                  value={editor.draft.base_url ?? ''}
                  onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, base_url: e.target.value } })}
                  onBlur={() => editor.draft.type === 'openai' && setShowBaseUrlError(true)}
                  invalid={editor.draft.type === 'openai'
                    && showBaseUrlError
                    && normalizeOpenAIBaseUrl(editor.draft.base_url ?? '') === null}
                  placeholder={editor.draft.type === 'openai' ? 'https://api.openai.com/v1' : 'https://api.example.com'}
                />
              </Field>
              <Field
                label={t('admin:channels.fields.apiKey')}
                htmlFor="ch-key"
                hint={editor.row ? t('admin:channels.fields.apiKeyHintEdit') : t('admin:channels.fields.apiKeyHintNew')}
              >
                <Input
                  id="ch-key"
                  type="password"
                  disabled={saving}
                  value={editor.draft.api_key ?? ''}
                  onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, api_key: e.target.value } })}
                  placeholder="sk-…"
                />
              </Field>
              <div className="grid gap-1 rounded-[10px] bg-[var(--color-bg-muted)] p-1">
                <label className="flex min-h-11 items-center justify-between gap-4 rounded-[8px] px-2.5 py-2">
                  <span className="text-sm text-[var(--color-fg)]">{t('admin:channels.fields.enabled')}</span>
                  <Switch
                    disabled={saving}
                    checked={editor.draft.enabled ?? true}
                    onCheckedChange={(v) => setEditor({ ...editor, draft: { ...editor.draft, enabled: v } })}
                  />
                </label>
                {!editor.row ? (
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-[8px] px-2.5 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--color-fg)]">{t('admin:channels.fields.autoImportModels')}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--color-fg-muted)]">
                        {t('admin:channels.fields.autoImportModelsHint')}
                      </span>
                    </span>
                    <Switch
                      disabled={saving}
                      checked={editor.autoImportModels}
                      onCheckedChange={(autoImportModels) => setEditor({ ...editor, autoImportModels })}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={() => setEditor({ ...editor, open: false })}>
              {t('common:actions.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void submit()}>{t('common:actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(modelPicker)} onOpenChange={(open) => !open && closeModelPicker()}>
        <DialogContent size="lg" closeDisabled={importingModels || discoveringModels}>
          <DialogHeader>
            <DialogTitle>{t('admin:channels.modelPicker.title')}</DialogTitle>
            <DialogDescription>
              {t('admin:channels.modelPicker.description', { name: modelPicker?.channel.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {discoveringModels ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-[var(--color-fg-muted)]">
                {t('admin:channels.modelPicker.loading')}
              </div>
            ) : discoveryError ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-[var(--color-fg-muted)]">{t('admin:channels.modelPicker.loadFailed')}</p>
                <Button size="sm" variant="outline" onClick={() => modelPicker && void discoverModelsForChannel(modelPicker.channel)}>
                  {t('admin:channels.modelPicker.retry')}
                </Button>
              </div>
            ) : (
            <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={15}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)]"
                />
                <Input
                  className="pl-9"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={t('admin:channels.modelPicker.searchPlaceholder')}
                  aria-label={t('admin:channels.modelPicker.searchPlaceholder')}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={supportedModelIds.length === 0 || importingModels}
                  onClick={() => setSelectedModelIds(supportedModelIds)}
                >
                  {t('admin:channels.modelPicker.selectAll')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selectedModelIds.length === 0 || importingModels}
                  onClick={() => setSelectedModelIds([])}
                >
                  {t('admin:channels.modelPicker.clear')}
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)]">
              <div className="max-h-[min(52vh,32rem)] overflow-y-auto">
                {filteredModels.length > 0 ? filteredModels.map((model) => {
                  const checked = selectedModelIds.includes(model.request_id)
                  return (
                    <label
                      key={model.request_id}
                      className={`flex min-h-14 items-center gap-3 border-b border-[var(--color-divider)] px-3 py-2.5 last:border-b-0 ${
                        model.supported ? 'cursor-pointer hover:bg-[var(--color-bg-muted)]' : 'cursor-not-allowed opacity-60'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!model.supported || importingModels}
                        onChange={(event) => setSelectedModelIds((current) => event.target.checked
                          ? [...current, model.request_id]
                          : current.filter((id) => id !== model.request_id))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--color-fg)]">{model.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-[var(--color-fg-muted)]">{model.request_id}</span>
                      </span>
                      <Badge size="xs" variant="neutral">{t(`admin:channels.modelPicker.kinds.${model.kind}`)}</Badge>
                      <Badge size="xs" variant={model.supported ? 'success' : 'warning'}>
                        {t(model.supported
                          ? 'admin:channels.modelPicker.supported'
                          : 'admin:channels.modelPicker.unsupported')}
                      </Badge>
                    </label>
                  )
                }) : (
                  <div className="px-4 py-10 text-center text-sm text-[var(--color-fg-muted)]">
                    {modelPicker?.models.length
                      ? t('admin:channels.modelPicker.noResults')
                      : t('admin:channels.modelPicker.noModels')}
                  </div>
                )}
              </div>
            </div>
            </>
            )}
          </DialogBody>
          <DialogFooter className="justify-between">
            <span className="mr-auto text-sm text-[var(--color-fg-muted)]">
              {!discoveringModels && !discoveryError
                ? t('admin:channels.modelPicker.selectedCount', {
                  selected: selectedModelIds.length,
                  total: supportedModelIds.length,
                })
                : null}
            </span>
            <Button variant="ghost" disabled={importingModels || discoveringModels} onClick={closeModelPicker}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              loading={importingModels}
              disabled={discoveringModels || discoveryError || selectedModelIds.length === 0}
              onClick={() => void importSelectedModels()}
            >
              {t('admin:channels.modelPicker.addSelected', { count: selectedModelIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('admin:channels.removeTitle')}</DialogTitle>
            <DialogDescription>
              {confirmDelete ? t('admin:channels.removeBody', { name: confirmDelete.name }) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" loading={deleting} onClick={() => confirmDelete && void remove(confirmDelete)}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
