import { create } from 'zustand'
import type { Attachment } from '@/types/chat'
import { useHtmlPreview } from './html-preview'
import { useInlineThreadDrawer } from './inline-thread'
import { useConversationFiles } from './conversation-files'

export interface ImageEditSource {
  id: string
  src: string
  alt?: string
  filename?: string
  attachment: Attachment
}

interface ImageEditStore {
  open: boolean
  source: ImageEditSource | null
  conversationId: string | null
  onSubmit: ((text: string, attachments: Attachment[], imageModelId: string, options: { optimizeImagePrompt?: boolean }) => void) | null
  openEditor: (args: {
    source: ImageEditSource
    conversationId: string
    onSubmit: ImageEditStore['onSubmit']
  }) => void
  close: () => void
}

export const useImageEdit = create<ImageEditStore>((set) => ({
  open: false,
  source: null,
  conversationId: null,
  onSubmit: null,
  openEditor({ source, conversationId, onSubmit }) {
    useHtmlPreview.getState().close()
    useInlineThreadDrawer.getState().close()
    useConversationFiles.getState().close()
    set({ open: true, source, conversationId, onSubmit })
  },
  close() {
    set({ open: false, source: null, conversationId: null, onSubmit: null })
  },
}))
