import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCircle2, Image as ImageIcon, Lightbulb, Loader2, Sparkles, UploadCloud, X } from 'lucide-react'
import { apiUpload, conversationsApi } from '@/api'
import { Button } from '@/components/ui/button'
import { ContentHeader } from '@/components/layout/content-header'
import { ModelPicker } from '@/components/chat/model-picker'
import { Field } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { persistUserSettings } from '@/lib/user-settings'
import { useAuth } from '@/store/auth'
import { useModels } from '@/store/models'
import { useConversations } from '@/store/conversations'
import type { Attachment } from '@/types/chat'
import { cn } from '@/lib/utils'

const RATIOS = [
  { id: 'free', value: '自由', label: '自由比例' },
  { id: '1:1', value: '1:1', label: '方形' },
  { id: '3:4', value: '3:4', label: '竖版' },
  { id: '9:16', value: '9:16', label: '故事版' },
  { id: '4:3', value: '4:3', label: '横版' },
  { id: '16:9', value: '16:9', label: '宽屏' },
] as const

const RATIO_FRAMES: Record<(typeof RATIOS)[number]['id'], string> = {
  free: 'h-5 w-7 rounded-[6px]',
  '1:1': 'h-5 w-5 rounded-[6px]',
  '3:4': 'h-6 w-4 rounded-[5px]',
  '9:16': 'h-7 w-3.5 rounded-[5px]',
  '4:3': 'h-4 w-6 rounded-[5px]',
  '16:9': 'h-3.5 w-7 rounded-[5px]',
}

function RatioGlyph({ id, selected }: { id: (typeof RATIOS)[number]['id']; selected: boolean }) {
  return (
    <span className="grid h-7 w-8 shrink-0 place-items-center" aria-hidden>
      <span
        className={cn(
          'grid place-items-center border-[1.5px]',
          RATIO_FRAMES[id],
          selected ? 'border-current text-current' : 'border-[var(--color-fg-muted)] text-[var(--color-fg-muted)]',
        )}
      >
        {id === 'free' ? <ImageIcon size={11} strokeWidth={2} /> : null}
      </span>
    </span>
  )
}

const LOGO_PROMPT = '以用户上传的商标为品牌核心，保持商标的图形和文字样式不变，但允许根据整体场景自由调整商标颜色、材质、光影和呈现方式，使商标自然融入产品及宣传场景。'
const BASE_PROMPT = '根据用户需求生成精致、高端、有商业广告质感的产品宣传图。'

const SAMPLE_IMAGE = { src: '/promo-samples/examples-4up.png', alt: '四种产品宣传图效果示例' }

export default function PromoImage() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const imageModels = useModels((s) => s.imageModels)
  const modelsLoaded = useModels((s) => s.loaded)
  const loadModels = useModels((s) => s.load)
  const adoptConversation = useConversations((s) => s.adoptConversation)
  const sendMessage = useConversations((s) => s.sendMessage)
  const inputRef = useRef<HTMLInputElement>(null)
  const imageModelPersistRef = useRef<Promise<unknown>>(Promise.resolve())
  const [logo, setLogo] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [need, setNeed] = useState('')
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]['id']>('free')
  const [imageModelId, setImageModelId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const savedImageModelId = typeof user?.settings?.image_model_id === 'string' ? user.settings.image_model_id : ''

  const onFile = useCallback((file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    if (preview) URL.revokeObjectURL(preview)
    setLogo(file)
    setPreview(URL.createObjectURL(file))
    setError('')
  }, [preview])

  useEffect(() => { void loadModels() }, [loadModels])
  useEffect(() => {
    if (imageModelId || imageModels.length === 0) return
    const preferred = imageModels.find((model) => model.id === savedImageModelId)
    setImageModelId(preferred?.id ?? imageModels[0].id)
  }, [imageModelId, imageModels, savedImageModelId])

  const handleImageModelChange = (id: string) => {
    setImageModelId(id)
    if (!imageModels.some((model) => model.id === id)) return
    imageModelPersistRef.current = imageModelPersistRef.current
      .catch(() => undefined)
      .then(() => persistUserSettings({ image_model_id: id }))
      .catch(() => undefined)
  }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData
      const file = Array.from(clipboard?.files ?? []).find((item) => item.type.startsWith('image/'))
        ?? Array.from(clipboard?.items ?? [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .find((item): item is File => Boolean(item))
      if (file) {
        event.preventDefault()
        onFile(file)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onFile])

  const selectedRatio = useMemo(() => RATIOS.find((item) => item.id === ratio) ?? RATIOS[0], [ratio])
  const removeLogo = () => {
    if (preview) URL.revokeObjectURL(preview)
    setLogo(null)
    setPreview('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function submit() {
    if (!user) { navigate('/login'); return }
    if (!need.trim()) { setError('请输入用户需求'); return }
    if (!imageModelId) { setError('暂无可用的生图模型'); return }
    setSubmitting(true)
    setError('')
    try {
      const conversation = await conversationsApi.create({ model_id: imageModelId })
      let attachments: Attachment[] | undefined
      if (logo) {
        const form = new FormData()
        form.append('file', logo)
        const uploaded = await apiUpload<{ id: string; url?: string }>('/files?conversation_id=' + encodeURIComponent(conversation.id) + '&draft=1', form)
        attachments = [{
          id: uploaded.id,
          name: logo.name,
          kind: 'image',
          size: logo.size,
          previewUrl: uploaded.url || `/api/files/${encodeURIComponent(uploaded.id)}`,
        }]
      }
      const ratioPrompt = selectedRatio.id === 'free' ? '' : `\n\n生成比例：\n${selectedRatio.value}`
      const logoPrompt = logo ? `${LOGO_PROMPT}\n\n` : ''
      const prompt = `${logoPrompt}${BASE_PROMPT}\n\n用户需求：\n${need.trim()}${ratioPrompt}`
      adoptConversation(conversation)
      navigate(`/chat/${conversation.id}`)
      void sendMessage({
        conversationId: conversation.id,
        text: prompt,
        modelId: imageModelId,
        attachments,
        toolMode: 'enabled',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <ContentHeader title="AI宣传图" showThemeToggle={false} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-[1180px] px-4 py-5 pb-12 sm:px-8 sm:py-7 sm:pb-16">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(17rem,1fr)] lg:gap-5">
            <form className="rounded-xl bg-[var(--color-surface)] p-5 shadow-[var(--shadow-md)] sm:p-6" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <section>
                <div className="mb-3 flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">1</span>
                  <div><h2 className="text-[15px] font-semibold">上传商标</h2><p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">支持 JPG、PNG、SVG 等格式，建议使用清晰的图标</p></div>
                </div>
                <div className="pl-10">
                  <div
                    className={cn('relative flex min-h-[128px] items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors', isDragging ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)]/30')}
                    onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(event) => { event.preventDefault(); setIsDragging(false); onFile(event.dataTransfer.files?.[0]) }}
                  >
                    {preview ? <div className="relative"><img src={preview} alt="商标预览" className="h-24 max-w-[240px] rounded-lg object-contain" /><button type="button" onClick={removeLogo} aria-label="移除商标" className="absolute -right-3 -top-3 grid size-7 place-items-center rounded-full bg-[var(--color-fg)] text-[var(--color-fg-inverted)]"><X size={14} /></button></div> : <button type="button" onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-1.5 text-[var(--color-fg-muted)]"><span className="grid size-10 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)]"><UploadCloud size={22} /></span><span className="mt-1 text-sm font-medium text-[var(--color-fg)]">点击上传商标</span></button>}
                    <input ref={inputRef} id="promo-logo-file" type="file" accept="image/*" className="hidden" onChange={(event) => onFile(event.target.files?.[0])} />
                  </div>
                  {logo ? <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">已上传 1/1 张</p> : null}
                </div>
              </section>

              <section className="mt-7">
                <div className="mb-3 flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">2</span>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3"><h2 className="text-[15px] font-semibold">用户需求</h2><span className="text-xs tabular-nums text-[var(--color-fg-subtle)]">{need.length}/100</span></div>
                </div>
                <div className="pl-10"><Textarea id="promo-need" value={need} maxLength={100} required aria-required="true" onChange={(event) => setNeed(event.target.value)} placeholder="如：高端酱酒宣传图" className="min-h-[96px] resize-none" /><p className="mt-2 text-xs text-[var(--color-fg-muted)]">请描述产品、场景或希望呈现的宣传重点，帮助 AI 更好地理解你的需求。</p></div>
              </section>

              <section className="mt-7">
                <div className="mb-3 flex items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">3</span><h2 className="text-[15px] font-semibold">图片比例</h2></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{RATIOS.map((item) => {
                  const selected = ratio === item.id
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setRatio(item.id)}
                      aria-pressed={selected}
                      className={cn(
                        'relative flex min-h-[58px] items-center justify-center rounded-[14px] border px-4 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-border-strong)]',
                      )}
                    >
                      {selected ? (
                        <span className="absolute right-2.5 top-2.5 grid size-[18px] place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      ) : null}
                      <span className="flex items-center gap-3">
                        <RatioGlyph id={item.id} selected={selected} />
                        <span className="w-[4.5rem] text-left">
                          <span className="block h-5 text-[15px] font-semibold leading-5">{item.value}</span>
                          <span className={cn('mt-0.5 block h-4 text-xs leading-4', selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-muted)]')}>{item.label}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}</div>
              </section>

              <section className="mt-7">
                <div className="mb-3 flex items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">4</span><h2 className="text-[15px] font-semibold">生成设置</h2></div>
                <Field label="选择生图模型">
                  <ModelPicker
                    value={imageModelId}
                    onChange={handleImageModelChange}
                    imageOnly
                    disabled={!modelsLoaded || imageModels.length === 0}
                    menuAlign="start"
                    className="h-10 w-full max-w-none rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3.5 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                  />
                </Field>
              </section>

              {error ? <p className="mt-5 text-sm text-[var(--color-danger)]">{error}</p> : null}
              <Button type="submit" variant="primary" size="lg" className="mt-7 w-full" leadingIcon={submitting ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} loading={submitting} disabled={!need.trim()}>开始生成</Button>
            </form>

            <aside className="rounded-xl bg-[var(--color-accent-soft)]/55 p-4 shadow-[var(--shadow-md)] sm:p-5">
              <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-xs)]"><Sparkles size={15} /></span><div><h2 className="text-[15px] font-semibold">效果示例</h2><p className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">输入你的创意，生成专业的宣传图</p></div></div>
              <img src={SAMPLE_IMAGE.src} alt={SAMPLE_IMAGE.alt} className="mt-4 h-auto w-full rounded-lg shadow-[var(--shadow-xs)]" />
              <div className="mt-4 rounded-xl bg-[var(--color-surface)]/70 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-accent)]"><Lightbulb size={17} />创作小贴士</div>
                <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--color-fg-muted)]"><li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />尽量详细描述产品特点和使用场景</li><li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />可以指定风格，如高端、简约、科技感等</li><li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />上传清晰的商标图片可获得更好效果</li></ul>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  )
}
