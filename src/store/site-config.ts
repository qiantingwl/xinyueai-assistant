import { create } from 'zustand'
import { authApi } from '@/api'

export const DEFAULT_SITE_TITLE = '心悦AI'
export const DEFAULT_SITE_DESCRIPTION = ''

interface SiteConfigState {
  title: string
  description: string
  loaded: boolean
  load: () => Promise<void>
  setConfig: (config: { title: string; description: string }) => void
}

let loadPromise: Promise<void> | null = null

export const useSiteConfig = create<SiteConfigState>((set, get) => ({
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  loaded: false,
  async load() {
    if (get().loaded) return
    if (loadPromise) return loadPromise
    loadPromise = authApi.siteConfig()
      .then((config) => {
        const title = config.title?.trim() || DEFAULT_SITE_TITLE
        const description = config.description?.trim() || DEFAULT_SITE_DESCRIPTION
        set({ title, description, loaded: true })
      })
      .catch(() => {
        // Branding must never block the application if the public endpoint is
        // unavailable during a rolling deployment or first-run setup.
        set({ loaded: true })
      })
      .finally(() => {
        loadPromise = null
      })
    return loadPromise
  },
  setConfig(config) {
    set({
      title: config.title.trim() || DEFAULT_SITE_TITLE,
      description: config.description.trim() || DEFAULT_SITE_DESCRIPTION,
      loaded: true,
    })
  },
}))
