import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, CircleHelp, CopyPlus, Eye, Hand, Info, Loader2, Maximize2, MousePointer2, RefreshCw, Save, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { canvasesApi, conversationsApi } from '@/api'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Composer } from '@/components/chat/composer'
import { ImageLightbox } from '@/components/chat/image-lightbox'
import { cn } from '@/lib/utils'
import { useModels } from '@/store/models'
import { useAuth } from '@/store/auth'
import { useConversations } from '@/store/conversations'
import type { Attachment } from '@/types/chat'
import { EMPTY_CANVAS_DOCUMENT, parseCanvasDocument, type CanvasDocument, type CanvasNode, type CanvasNodeType } from '@/types/canvas'

type Point = { x: number; y: number }
type Tool = 'select' | 'hand'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ComposerSubmit = NonNullable<ComponentProps<typeof Composer>['onSubmit']>
type ComposerOptions = Parameters<ComposerSubmit>[2]
const MAX_CANVAS_GENERATIONS = 3

function nodeColor(type: CanvasNodeType): string {
  if (type === 'reference') return 'color-mix(in oklch, var(--color-info-soft) 72%, var(--color-surface))'
  if (type === 'prompt') return 'color-mix(in oklch, var(--color-warning-soft) 72%, var(--color-surface))'
  return 'var(--color-sidebar-active)'
}

function createNode(type: CanvasNodeType, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    x,
    y,
    width: type === 'prompt' ? 320 : 270,
    height: type === 'prompt' ? 190 : type === 'result' ? 290 : 250,
    createdAt: Date.now(),
    ...extra,
  }
}

export default function CanvasEditor() {
  const { t } = useTranslation(['canvas', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuth((state) => state.user)
  const imageModels = useModels((state) => state.imageModels)
  const modelsLoaded = useModels((state) => state.loaded)
  const loadModels = useModels((state) => state.load)
  const beginOptimisticConversation = useConversations((state) => state.beginOptimisticConversation)
  const loadConversation = useConversations((state) => state.loadOne)
  const sendMessage = useConversations((state) => state.sendMessage)
  const abortStream = useConversations((state) => state.abortStream)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ kind: 'pan' | 'node'; id?: string; start: Point; origin?: Point } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const loadedRef = useRef(false)
  const seenArtifactIdsRef = useRef(new Set<string>())
  const [name, setName] = useState(() => t('canvas:untitled'))
  const [document, setDocument] = useState<CanvasDocument>(EMPTY_CANVAS_DOCUMENT)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [modelId, setModelId] = useState('')
  const [generationConversationIds, setGenerationConversationIds] = useState<string[]>([])
  const [activeImageNodeId, setActiveImageNodeId] = useState<string>()
  const [detailsNode, setDetailsNode] = useState<CanvasNode | null>(null)
  const [previewNode, setPreviewNode] = useState<CanvasNode | null>(null)
  const [composerRevision, setComposerRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const allConversations = useConversations((state) => state.conversations)
  const generationConversations = useMemo(
    () => generationConversationIds.map((conversationId) => allConversations.find((conversation) => conversation.id === conversationId)).filter(Boolean),
    [allConversations, generationConversationIds],
  )
  const conversationMessages = useMemo(() => generationConversations.flatMap((conversation) => conversation?.messages ?? []), [generationConversations])
  const streamingAssistants = useMemo(
    () => generationConversations.flatMap((conversation) => (conversation?.messages ?? []).filter((message) => message.role === 'assistant' && message.streaming)),
    [generationConversations],
  )
  const streamingAssistant = streamingAssistants[streamingAssistants.length - 1]
  const generatedArtifacts = useMemo(
    () => generationConversations.flatMap((conversation) => (conversation?.messages ?? []).flatMap((message) => (message.artifacts ?? []).map((artifact) => ({ artifact, conversationId: conversation!.id })))),
    [generationConversations],
  )
  const activeImageNode = useMemo(
    () => document.nodes.find((node) => node.id === activeImageNodeId && node.type === 'result' && node.imageUrl),
    [activeImageNodeId, document.nodes],
  )
  const activeAttachments = useMemo<Attachment[]>(
    () => activeImageNode?.sourceArtifactId
      ? [{ id: activeImageNode.sourceArtifactId, name: activeImageNode.title ?? 'generated-image.png', kind: 'image', size: 0, previewUrl: activeImageNode.imageUrl }]
      : [],
    [activeImageNode],
  )

  useEffect(() => { void loadModels() }, [loadModels])

  useEffect(() => {
    if (modelId || imageModels.length === 0) return
    const saved = typeof user?.settings?.image_model_id === 'string' ? user.settings.image_model_id : ''
    setModelId(imageModels.some((model) => model.id === saved) ? saved : imageModels[0].id)
  }, [imageModels, modelId, user?.settings?.image_model_id])

  useEffect(() => {
    if (!id) return
    if (!user) {
      loadedRef.current = false
      setLoading(false)
      setLoadError(null)
      setName(t('canvas:untitled'))
      setDocument(EMPTY_CANVAS_DOCUMENT)
      setSelectedIds([])
      setActiveImageNodeId(undefined)
      setGenerationConversationIds([])
      return
    }
    let active = true
    loadedRef.current = false
    setLoading(true)
    setLoadError(null)
    void canvasesApi.get(id).then((canvas) => {
      if (!active) return
      setName(canvas.name === 'Untitled canvas' || canvas.name === '未命名画布' || canvas.name === '未命名畫布' ? t('canvas:untitled') : canvas.name)
      const parsed = parseCanvasDocument(canvas.data)
      // Reference images are retained in generation metadata, not as separate
      // canvas nodes. Hide legacy reference/prompt nodes when opening older data.
      const nodes = parsed.nodes.filter((node) => node.type !== 'prompt' && node.type !== 'reference')
      const nodeIds = new Set(nodes.map((node) => node.id))
      setDocument({ nodes, edges: parsed.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) })
      setViewport({ x: canvas.viewport_x, y: canvas.viewport_y, zoom: canvas.zoom || 1 })
      loadedRef.current = true
      const pendingConversationIds = Array.from(new Set(nodes
        .filter((node) => node.type === 'result' && node.status === 'pending' && node.generation?.conversationId)
        .map((node) => node.generation?.conversationId)
        .filter((conversationId): conversationId is string => Boolean(conversationId))))
      if (pendingConversationIds.length > 0) {
        // Rehydrate the archived generation conversation after a refresh. Its
        // replay stream will either deliver the eventual artifact or settle the
        // pending node from the already-finished server message.
        setGenerationConversationIds(pendingConversationIds)
        pendingConversationIds.forEach((conversationId) => { void loadConversation(conversationId, { full: true }) })
      }
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : t('common:common.error', { defaultValue: 'Unable to load canvas' }))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, loadConversation, t, user])

  const persist = useCallback(() => {
    if (!id || !user || !loadedRef.current) return
    setSaveState('saving')
    void canvasesApi.update(id, { data: JSON.stringify(document), viewport_x: viewport.x, viewport_y: viewport.y, zoom: viewport.zoom }).then(() => setSaveState('saved')).catch(() => setSaveState('error'))
  }, [document, id, user, viewport])

  useEffect(() => {
    if (!loadedRef.current || !id) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(persist, 750)
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [document, id, persist, user, viewport])

  useEffect(() => {
    if (generatedArtifacts.length === 0) return
    const fresh = generatedArtifacts.filter(({ artifact }) => !seenArtifactIdsRef.current.has(artifact.id) && artifact.url)
    if (fresh.length === 0) return
    fresh.forEach(({ artifact }) => seenArtifactIdsRef.current.add(artifact.id))
    setDocument((current) => {
      const nodes = [...current.nodes]
      fresh.forEach(({ artifact, conversationId }, index) => {
        const existing = nodes.find((node) => node.sourceArtifactId === artifact.id || node.imageUrl === artifact.url)
        if (existing) {
          existing.status = 'ready'
          existing.title = t('canvas:result')
          existing.imageUrl = artifact.url
          existing.sourceArtifactId = artifact.id
          return
        }
        const pending = nodes.find((node) => node.type === 'result' && node.status === 'pending' && !node.sourceArtifactId && node.generation?.conversationId === conversationId)
          ?? nodes.find((node) => node.type === 'result' && node.status === 'pending' && !node.sourceArtifactId)
        if (pending) {
          pending.status = 'ready'
          pending.title = t('canvas:result')
          pending.imageUrl = artifact.url
          pending.sourceArtifactId = artifact.id
          return
        }
        const point = canvasCenter(surfaceRef.current, viewport)
        nodes.push(createNode('result', point.x + 350 + index * 24, point.y - 70 + index * 24, { title: t('canvas:result'), imageUrl: artifact.url, sourceArtifactId: artifact.id, status: 'ready' }))
      })
      return { ...current, nodes }
    })
  }, [generatedArtifacts, t, viewport])

  useEffect(() => {
    const latestError = [...conversationMessages].reverse().find((message) => message.role === 'assistant' && message.error)
    if (!latestError) return
    setDocument((current) => {
      const erroredConversationIds = new Set(generationConversations
        .filter((conversation) => conversation?.messages.some((message) => message.role === 'assistant' && message.error))
        .map((conversation) => conversation!.id))
      const pending = current.nodes.find((node) => node.type === 'result' && node.status === 'pending' && node.generation?.conversationId && erroredConversationIds.has(node.generation.conversationId))
        ?? current.nodes.find((node) => node.type === 'result' && node.status === 'pending')
      if (!pending) return current
      return { ...current, nodes: current.nodes.map((node) => node.id === pending.id ? { ...node, status: 'error' } : node) }
    })
  }, [conversationMessages, generationConversations])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length > 0) {
        event.preventDefault()
        removeNodes(selectedIds)
      }
      if (event.key === 'Escape') setSelectedIds([])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIds])

  function removeNodes(ids: string[]) {
    setDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !ids.includes(node.id)),
      edges: current.edges.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target)),
    }))
    setSelectedIds([])
    if (activeImageNodeId && ids.includes(activeImageNodeId)) setActiveImageNodeId(undefined)
    if (detailsNode && ids.includes(detailsNode.id)) setDetailsNode(null)
  }

  function handleComposerSubmit(text: Parameters<ComposerSubmit>[0], attachments: Attachment[], options: ComposerOptions, retryNodeId?: string) {
    const retryNode = retryNodeId ? document.nodes.find((node) => node.id === retryNodeId && node.type === 'result' && node.status === 'error') : undefined
    if (retryNodeId && !retryNode?.generation) return
    const submitModelId = retryNode?.generation?.modelId || modelId
    if (!submitModelId || streamingAssistants.length >= MAX_CANVAS_GENERATIONS) return
    const tempConversationId = beginOptimisticConversation(text, submitModelId, false)
    // Canvas generations use chat streaming internally, but their temporary
    // conversations must never appear in the ordinary chat history.
    useConversations.setState((state) => ({
      conversations: state.conversations.map((conversation) => conversation.id === tempConversationId ? { ...conversation, archived: true } : conversation),
    }))
    setGenerationConversationIds((current) => {
      const previousConversationId = retryNode?.generation?.conversationId
      const withoutPrevious = previousConversationId ? current.filter((conversationId) => conversationId !== previousConversationId) : current
      return withoutPrevious.includes(tempConversationId) ? withoutPrevious : [...withoutPrevious, tempConversationId]
    })
    // The bottom composer overlays the board. Center new standalone results in
    // the remaining visible area so the first card is visually centered.
    const point = canvasCenter(surfaceRef.current, viewport, activeImageNode ? 0 : 120)
    const resultNodes = document.nodes.filter((node) => node.type === 'result')
    const incomingResultIds = new Set(document.edges.map((edge) => edge.target))
    const followUpCount = activeImageNode
      ? document.edges.filter((edge) => edge.source === activeImageNode.id && resultNodes.some((node) => node.id === edge.target)).length
      : 0
    const lineRoots = resultNodes
      .filter((node) => !incomingResultIds.has(node.id))
      .sort((a, b) => a.createdAt - b.createdAt)
    const previousLineRoot = lineRoots[lineRoots.length - 1]
    const resultX = activeImageNode
      ? activeImageNode.x + activeImageNode.width + 80
      : previousLineRoot
        ? previousLineRoot.x
        : point.x - 135
    const resultY = activeImageNode
      ? activeImageNode.y + followUpCount * (290 + 80)
      : previousLineRoot
        ? previousLineRoot.y + previousLineRoot.height + 80
        : point.y - 145
    const referenceImages = attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({ id: attachment.id, name: attachment.name, url: attachment.previewUrl }))
    const sourceNodeIds = activeImageNode ? [activeImageNode.id] : []
    const resultNode = retryNode
      ? { ...retryNode, title: t('canvas:generating'), imageUrl: undefined, sourceArtifactId: undefined, status: 'pending' as const, generation: { ...retryNode.generation!, conversationId: tempConversationId, createdAt: Date.now() } }
      : createNode('result', resultX, resultY, {
        title: t('canvas:generating'),
        styleId: options.imageStyleId,
        status: 'pending',
        generation: { prompt: text, modelId: submitModelId, modelName: imageModels.find((model) => model.id === submitModelId)?.label, styleId: options.imageStyleId, params: options.params, referenceImages: referenceImages.length > 0 ? referenceImages : undefined, createdAt: Date.now() },
      })
    const newEdges = retryNode ? [] : sourceNodeIds.map((source) => ({ id: `edge_${Date.now().toString(36)}_${source}`, source, target: resultNode.id }))
    setDocument((current) => ({
      ...current,
      nodes: retryNode ? current.nodes.map((node) => node.id === retryNode.id ? resultNode : node) : [...current.nodes, resultNode],
      edges: [...current.edges, ...newEdges],
    }))
    const surface = surfaceRef.current
    if (surface && !retryNode) {
      const margin = 40
      const resultRight = (resultX + resultNode.width) * viewport.zoom + viewport.x
      const nextViewport = { ...viewport }
      if (resultRight > surface.clientWidth - margin) {
        // Move the canvas left just enough to reveal a newly appended result.
        nextViewport.x -= resultRight - (surface.clientWidth - margin)
      }
      const resultBottom = (resultY + resultNode.height) * viewport.zoom + nextViewport.y
      const resultTop = resultY * viewport.zoom + nextViewport.y
      if (resultBottom > surface.clientHeight - margin) {
        nextViewport.y -= resultBottom - (surface.clientHeight - margin)
      } else if (resultTop < margin) {
        nextViewport.y += margin - resultTop
      }
      if (!activeImageNode && previousLineRoot) {
        // Independent generations form a new row beneath the previous line;
        // keep that new row vertically centered in the visible board area.
        const visibleCenterY = Math.max(0, (surface.clientHeight - 120) / 2)
        const resultCenterY = resultY + resultNode.height / 2
        nextViewport.y = visibleCenterY - resultCenterY * viewport.zoom
      }
      setViewport(nextViewport)
    }
    setSelectedIds([resultNode.id])
    if (activeImageNode && !retryNode) {
      setComposerRevision((current) => current + 1)
      // The follow-up turn is now submitted; return the composer to its fixed
      // bottom position while keeping the edge from the source image.
      setActiveImageNodeId(undefined)
    }
    void sendMessage({ conversationId: tempConversationId, createFirst: true, text, modelId: submitModelId, attachments, mode: 'canvas', params: options.params, imageStyleId: options.imageStyleId, optimizeImagePrompt: options.optimizeImagePrompt, toolMode: options.toolMode, webSearch: options.webSearch, selectedUserSkillIds: options.selectedUserSkillIds, selectedToolIds: options.selectedToolIds, fast: options.fast, onConversationId: (conversationId) => { setGenerationConversationIds((current) => Array.from(new Set(current.map((id) => id === tempConversationId ? conversationId : id)))); setDocument((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === resultNode.id && node.generation ? { ...node, generation: { ...node.generation, conversationId } } : node) })); void conversationsApi.update(conversationId, { archived: true }).catch(() => {}) } })
  }

  function removeSelectedNode(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    if (tool === 'select' && event.target !== event.currentTarget) return
    // Clicking the empty board exits image-follow mode and restores the fixed
    // composer at the bottom. Child nodes/toolbars keep their existing behavior.
    if (event.target === event.currentTarget) {
      setActiveImageNodeId(undefined)
      setSelectedIds([])
    }
    dragRef.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.start.x
    const dy = event.clientY - drag.start.y
    if (drag.kind === 'pan' && drag.origin) setViewport((current) => ({ ...current, x: drag.origin!.x + dx, y: drag.origin!.y + dy }))
    if (drag.kind === 'node' && drag.id && drag.origin) setDocument((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === drag.id ? { ...node, x: drag.origin!.x + dx / viewport.zoom, y: drag.origin!.y + dy / viewport.zoom } : node) }))
  }

  function selectNode(event: React.PointerEvent, node: CanvasNode) {
    if (tool === 'hand') return
    event.stopPropagation()
    setSelectedIds((current) => event.shiftKey ? current.includes(node.id) ? current.filter((item) => item !== node.id) : [...current, node.id] : [node.id])
    dragRef.current = { kind: 'node', id: node.id, start: { x: event.clientX, y: event.clientY }, origin: { x: node.x, y: node.y } }
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextZoom = Math.max(0.1, Math.min(4, viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    setViewport((current) => ({ zoom: nextZoom, x: px - (px - current.x) * (nextZoom / current.zoom), y: py - (py - current.y) * (nextZoom / current.zoom) }))
  }

  const fitCanvas = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || document.nodes.length === 0) return
    const minX = Math.min(...document.nodes.map((node) => node.x))
    const minY = Math.min(...document.nodes.map((node) => node.y))
    const maxX = Math.max(...document.nodes.map((node) => node.x + node.width))
    const maxY = Math.max(...document.nodes.map((node) => node.y + node.height))
    const zoom = Math.max(0.1, Math.min(1.5, Math.min((rect.width - 100) / (maxX - minX + 100), (rect.height - 180) / (maxY - minY + 100))))
    setViewport({ zoom, x: rect.width / 2 - ((minX + maxX) / 2) * zoom, y: (rect.height - 120) / 2 - ((minY + maxY) / 2) * zoom })
  }, [document.nodes])

  function addReferenceFromNode(node: CanvasNode) {
    if (!node.imageUrl) return
    // References live in generation metadata; activating a result opens the
    // attached composer without adding another visible reference node.
    setActiveImageNodeId(node.id)
    setSelectedIds([node.id])
  }

  if (loading) return <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="animate-spin text-[var(--color-fg-muted)]" size={20} aria-label={t('common:common.loading', { defaultValue: 'Loading' })} /></div>
  if (loadError || !id) return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--color-fg-muted)]"><CircleHelp size={22} /><span>{loadError ?? t('canvas:notFound', { defaultValue: 'Canvas not found' })}</span><Button variant="secondary" onClick={() => navigate('/canvas')}>{t('canvas:back', { defaultValue: 'Back to canvases' })}</Button></div>

  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface-sunken)] text-[var(--color-fg)]">
    <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-divider)] bg-[var(--color-surface)]/95 px-3 backdrop-blur sm:px-5">
      <Link to="/canvas" aria-label={t('canvas:back', { defaultValue: 'Back to canvases' })} className="grid size-9 place-items-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)]"><ArrowLeft size={17} aria-hidden /></Link>
      <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => { const next = name.trim(); if (user && next) void canvasesApi.update(id, { name: next }) }} className="min-w-0 max-w-[300px] flex-1 rounded-[7px] bg-transparent px-2 py-1 text-sm font-semibold outline-none hover:bg-[var(--color-bg-muted)] focus:bg-[var(--color-bg-muted)]" aria-label={t('canvas:name', { defaultValue: 'Canvas name' })} />
      <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-fg-subtle)]">{saveState === 'saving' ? <><Loader2 size={14} className="animate-spin" />{t('canvas:saving', { defaultValue: 'Saving' })}</> : saveState === 'error' ? <><Save size={14} />{t('canvas:saveError', { defaultValue: 'Save failed' })}</> : saveState === 'saved' ? <><Check size={14} />{t('canvas:saved', { defaultValue: 'Saved' })}</> : null}</div>
    </header>
    <div ref={surfaceRef} className="relative min-h-0 flex-1 touch-none select-none overflow-hidden [background-image:radial-gradient(var(--color-border-strong)_1px,transparent_1px)] [background-size:24px_24px]" onPointerDown={removeSelectedNode} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} onWheel={onWheel} style={{ backgroundPosition: `${viewport.x % 24}px ${viewport.y % 24}px` }}>
      <div className="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-raised)]/95 p-1 shadow-[var(--shadow-md)] backdrop-blur">
        <ToolButton label={t('canvas:select', { defaultValue: 'Select' })} active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={16} aria-hidden /></ToolButton>
        <ToolButton label={t('canvas:pan', { defaultValue: 'Pan' })} active={tool === 'hand'} onClick={() => setTool('hand')}><Hand size={16} aria-hidden /></ToolButton>
        <span className="mx-1 h-5 w-px bg-[var(--color-divider)]" aria-hidden />
        <ToolButton label={t('canvas:zoomOut', { defaultValue: 'Zoom out' })} onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.1, current.zoom * 0.9) }))}><ZoomOut size={16} aria-hidden /></ToolButton>
        <span className="min-w-[3.2rem] text-center text-[11px] font-medium text-[var(--color-fg-muted)]">{Math.round(viewport.zoom * 100)}%</span>
        <ToolButton label={t('canvas:zoomIn', { defaultValue: 'Zoom in' })} onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(4, current.zoom * 1.1) }))}><ZoomIn size={16} aria-hidden /></ToolButton>
        <ToolButton label={t('canvas:fit', { defaultValue: 'Fit canvas' })} onClick={fitCanvas}><Maximize2 size={16} aria-hidden /></ToolButton>
      </div>
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {document.edges.map((edge) => {
            const source = document.nodes.find((node) => node.id === edge.source)
            const target = document.nodes.find((node) => node.id === edge.target)
            if (!source || !target) return null
            const x1 = source.x + source.width
            const y1 = source.y + source.height / 2
            const x2 = target.x
            const y2 = target.y + target.height / 2
            const curve = Math.max(40, Math.abs(x2 - x1) * 0.45)
            return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`} fill="none" stroke="var(--color-info)" strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
          })}
        </g>
      </svg>
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {document.nodes.map((node) => <CanvasNodeCard key={node.id} node={node} selected={selectedIds.includes(node.id)} labels={{ reference: t('canvas:reference'), prompt: t('canvas:prompt'), result: t('canvas:result'), resultPending: t('canvas:generating'), resultFailed: t('canvas:generationFailed'), retry: t('canvas:retry', { defaultValue: 'Retry' }), remove: t('canvas:removeNode'), useAsReference: t('canvas:useAsReference'), details: t('canvas:details'), preview: t('canvas:preview', { defaultValue: 'Preview' }) }} onPointerDown={(event) => selectNode(event, node)} onRemove={() => removeNodes([node.id])} onUseAsReference={() => addReferenceFromNode(node)} onActivate={() => { if (node.type === 'result' && node.status === 'ready' && node.imageUrl) setActiveImageNodeId(node.id) }} onRetry={() => { if (!node.generation) return; const retryAttachments: Attachment[] = (node.generation.referenceImages ?? []).map((image) => ({ id: image.id, name: image.name, kind: 'image', size: 0, previewUrl: image.url })); handleComposerSubmit(node.generation.prompt, retryAttachments, { params: node.generation.params, imageStyleId: node.generation.styleId, optimizeImagePrompt: false, toolMode: 'auto' }, node.id) }} onPreview={() => setPreviewNode(node)} onOpenDetails={() => setDetailsNode(node)} />)}
        {activeImageNode ? <div className="pointer-events-auto absolute select-text" style={{ left: activeImageNode.x, top: activeImageNode.y + Math.max(activeImageNode.height, 300) + 20, width: 620 }}>
          <Composer key={`${activeImageNode.id}:${composerRevision}`} modelId={modelId} onModelChange={setModelId} onSubmit={handleComposerSubmit} initialAttachments={activeAttachments} imageOnly conversationId={undefined} streaming={streamingAssistants.length >= MAX_CANVAS_GENERATIONS} onStop={() => { if (streamingAssistant) abortStream(streamingAssistant.id) }} commandsEnabled={false} autoFocus={false} />
        </div> : null}
      </div>
      {document.nodes.length === 0 ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 pb-32"><div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]/85 px-6 py-4 text-center shadow-[var(--shadow-sm)] backdrop-blur"><p className="text-sm font-medium">{t('canvas:emptyBoard', { defaultValue: 'Start with a reference image or prompt' })}</p><p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('canvas:emptyBoardBody', { defaultValue: 'Add an image and prompt below to generate your first result.' })}</p></div></div> : null}
      {!activeImageNode ? <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3"><div className="pointer-events-auto w-full max-w-[780px]">{modelsLoaded && imageModels.length === 0 ? <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-raised)]/95 px-3 py-2 text-center text-sm text-[var(--color-fg-muted)] shadow-[var(--shadow-md)] backdrop-blur">{t('canvas:noImageModel', { defaultValue: 'No image model available' })}</div> : <Composer modelId={modelId} onModelChange={setModelId} onSubmit={handleComposerSubmit} imageOnly conversationId={undefined} streaming={streamingAssistants.length >= MAX_CANVAS_GENERATIONS} onStop={() => { if (streamingAssistant) abortStream(streamingAssistant.id) }} commandsEnabled={false} autoFocus={false} />}</div></div> : null}
      {detailsNode ? <Dialog open onOpenChange={(open) => { if (!open) setDetailsNode(null) }}><DialogContent size="sm"><DialogHeader><DialogTitle>{t('canvas:generationDetails')}</DialogTitle></DialogHeader><DialogBody className="space-y-2 px-6 pb-6">
        {detailsNode.generation?.prompt || detailsNode.text ? <DetailRow label={t('canvas:promptDetail')} value={detailsNode.generation?.prompt ?? detailsNode.text ?? ''} /> : null}
        {detailsNode.generation?.modelName || detailsNode.generation?.modelId ? <DetailRow label={t('canvas:modelDetail')} value={detailsNode.generation.modelName ?? imageModels.find((model) => model.id === detailsNode.generation?.modelId)?.label ?? detailsNode.generation.modelId ?? ''} /> : null}
        {detailsNode.generation?.referenceImages?.length ? <ReferenceImagesRow label={t('canvas:reference')} images={detailsNode.generation.referenceImages} /> : null}
        {detailsNode.generation?.styleId ? <DetailRow label={t('canvas:styleDetail')} value={detailsNode.generation.styleId} /> : null}
        {detailsNode.generation?.params && Object.keys(detailsNode.generation.params).length > 0 ? <DetailRow label={t('canvas:paramsDetail')} value={JSON.stringify(detailsNode.generation.params, null, 2)} /> : null}
      </DialogBody></DialogContent></Dialog> : null}
      <ImageLightbox open={Boolean(previewNode?.imageUrl)} onOpenChange={(open) => { if (!open) setPreviewNode(null) }} src={previewNode?.imageUrl ?? ''} alt={previewNode?.title ?? t('canvas:result')} filename="generated-image.png" />
    </div>
  </div>
}

function canvasCenter(surface: HTMLDivElement | null, viewport: { x: number; y: number; zoom: number }, bottomInset = 0): Point {
  const center = surface
    ? { x: surface.clientWidth / 2, y: Math.max(0, (surface.clientHeight - bottomInset) / 2) }
    : { x: 500, y: 350 }
  return { x: (center.x - viewport.x) / viewport.zoom, y: (center.y - viewport.y) / viewport.zoom }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[9px] border border-[var(--color-divider)] bg-[var(--color-bg-muted)]/40 px-3 py-2"><div className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</div><div className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">{value}</div></div>
}

function ReferenceImagesRow({ label, images }: { label: string; images: Array<{ id: string; name: string; url?: string }> }) {
  return <div className="rounded-[9px] border border-[var(--color-divider)] bg-[var(--color-bg-muted)]/40 px-3 py-2"><div className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</div><div className="mt-2 flex flex-wrap gap-2">{images.map((image) => <div key={image.id} className="flex min-w-0 items-center gap-2"><div className="size-10 shrink-0 overflow-hidden rounded-[6px] bg-[var(--color-bg-muted)]">{image.url ? <img src={image.url} alt={image.name} className="size-full object-cover" /> : null}</div><span className="max-w-[220px] truncate text-sm text-[var(--color-fg)]">{image.name}</span></div>)}</div></div>
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tooltip content={label}><button type="button" aria-label={label} aria-pressed={active} onPointerDown={(event) => event.stopPropagation()} onClick={onClick} className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)]', active && 'bg-[var(--color-fg)] text-[var(--color-fg-inverted)] hover:bg-[var(--color-fg)] hover:text-[var(--color-fg-inverted)]')}>{children}</button></Tooltip>
}

function CanvasNodeCard({ node, selected, labels, onPointerDown, onRemove, onUseAsReference, onActivate, onRetry, onPreview, onOpenDetails }: { node: CanvasNode; selected: boolean; labels: { reference: string; prompt: string; result: string; resultPending: string; resultFailed: string; retry: string; remove: string; useAsReference: string; details: string; preview: string }; onPointerDown: (event: React.PointerEvent) => void; onRemove: () => void; onUseAsReference: () => void; onActivate: () => void; onRetry: () => void; onPreview: () => void; onOpenDetails: () => void }) {
  const label = node.type === 'reference' ? labels.reference : node.type === 'prompt' ? labels.prompt : labels.result
  const title = node.type === 'result' && node.status === 'error' ? labels.resultFailed : node.title ?? label
  const statusDot = node.type !== 'result' || node.status === 'pending'
    ? 'bg-[var(--color-info)]'
    : node.status === 'error'
      ? 'bg-[var(--color-danger)]'
      : 'bg-[var(--color-success)]'
  const resultStatus = node.status === 'error' ? labels.resultFailed : node.status === 'pending' ? labels.resultPending : ''
  return <div onPointerDown={onPointerDown} className={cn('absolute overflow-hidden rounded-[13px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)]', selected && 'ring-2 ring-[var(--color-info)] ring-offset-2 ring-offset-[var(--color-surface-sunken)]')} style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}>
    <div className="flex items-center gap-2 border-b border-[var(--color-divider)] px-3 py-2" style={{ backgroundColor: nodeColor(node.type) }}><span className={cn('size-2 rounded-full', statusDot)} /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--color-fg-muted)]">{title}</span><div className="flex items-center gap-0.5">{node.type === 'result' && node.imageUrl && node.status === 'ready' ? <Tooltip content={labels.preview}><button type="button" aria-label={labels.preview} onPointerDown={(event) => event.stopPropagation()} onClick={onPreview} className="grid size-6 place-items-center rounded-[7px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)]"><Eye size={13} aria-hidden /></button></Tooltip> : null}{node.generation ? <Tooltip content={labels.details}><button type="button" aria-label={labels.details} onPointerDown={(event) => event.stopPropagation()} onClick={onOpenDetails} className="grid size-6 place-items-center rounded-[7px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)]"><Info size={13} aria-hidden /></button></Tooltip> : null}<Tooltip content={labels.remove}><button type="button" aria-label={labels.remove} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove} className="grid size-6 place-items-center rounded-[7px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-fg)]"><Trash2 size={12} aria-hidden /></button></Tooltip>{node.imageUrl ? <Tooltip content={labels.useAsReference}><button type="button" aria-label={labels.useAsReference} onPointerDown={(event) => event.stopPropagation()} onClick={onUseAsReference} className="grid size-6 place-items-center rounded-[7px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)]"><CopyPlus size={13} aria-hidden /></button></Tooltip> : null}</div></div>
    {node.type === 'prompt' ? <p className="min-h-[150px] whitespace-pre-wrap px-3 py-3 text-[13px] leading-6 text-[var(--color-fg)]">{node.text}</p> : node.imageUrl && node.status !== 'pending' ? <img src={node.imageUrl} alt={node.imageAlt ?? ''} className="block h-[255px] w-full cursor-pointer object-cover" draggable={false} onPointerDown={(event) => { if (node.type === 'result') { event.stopPropagation(); onActivate() } }} onClick={(event) => { event.stopPropagation(); if (node.type === 'result') onActivate() }} /> : <div className="flex h-[255px] flex-col items-center justify-center gap-2.5 bg-[var(--color-sidebar-active)] px-4 text-center text-xs leading-tight text-[var(--color-sidebar-active-ink)]"><Loader2 size={20} strokeWidth={1.8} className={cn('shrink-0 text-[var(--color-secondary)]', node.status === 'pending' && 'animate-spin')} /><span>{resultStatus}</span>{node.status === 'error' ? <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onRetry} className="mt-1 inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-medium text-[var(--color-sidebar-active-ink)] hover:bg-[var(--color-bg-muted)]"><RefreshCw size={12} aria-hidden />{labels.retry}</button> : null}</div>}
  </div>
}
