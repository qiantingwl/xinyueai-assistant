export type CanvasNodeType = 'reference' | 'prompt' | 'result'

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  title?: string
  text?: string
  imageUrl?: string
  imageAlt?: string
  styleId?: string
  status?: 'pending' | 'ready' | 'error'
  sourceArtifactId?: string
  generation?: {
    prompt: string
    conversationId?: string
    modelId?: string
    modelName?: string
    styleId?: string
    params?: Record<string, unknown>
    referenceImages?: Array<{ id: string; name: string; url?: string }>
    createdAt: number
  }
  createdAt: number
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
}

export interface CanvasDocument {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export const EMPTY_CANVAS_DOCUMENT: CanvasDocument = { nodes: [], edges: [] }

export function parseCanvasDocument(value: string | undefined): CanvasDocument {
  if (!value) return EMPTY_CANVAS_DOCUMENT
  try {
    const parsed = JSON.parse(value) as Partial<CanvasDocument>
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return EMPTY_CANVAS_DOCUMENT
    return { nodes: parsed.nodes as CanvasNode[], edges: parsed.edges as CanvasEdge[] }
  } catch {
    return EMPTY_CANVAS_DOCUMENT
  }
}
