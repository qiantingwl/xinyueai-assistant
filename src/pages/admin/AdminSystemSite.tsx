import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi, ApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { PanelFallback } from '@/components/ui/panel-fallback'
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_TITLE, useSiteConfig } from '@/store/site-config'

const TITLE_MAX_LENGTH = 60
const DESCRIPTION_MAX_LENGTH = 300

export default function AdminSystemSite() {
  const { t } = useTranslation(['admin', 'common'])
  const setSiteConfig = useSiteConfig((state) => state.setConfig)
  const [title, setTitle] = useState(DEFAULT_SITE_TITLE)
  const [description, setDescription] = useState(DEFAULT_SITE_DESCRIPTION)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminApi.settings()
      .then((settings) => {
        if (typeof settings.site_title === 'string' && settings.site_title.trim()) setTitle(settings.site_title)
        if (typeof settings.site_description === 'string') setDescription(settings.site_description)
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : t('admin:common.failed')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    const nextTitle = title.trim()
    const nextDescription = description.trim()
    if (!nextTitle || nextTitle.length > TITLE_MAX_LENGTH || nextDescription.length > DESCRIPTION_MAX_LENGTH) {
      toast.error(t('admin:settings.fields.siteIdentityInvalid', {
        defaultValue: `名称不能为空且不超过 ${TITLE_MAX_LENGTH} 个字符，描述不超过 ${DESCRIPTION_MAX_LENGTH} 个字符。`,
      }))
      return
    }
    setSaving(true)
    try {
      await adminApi.updateSettings({ site_title: nextTitle, site_description: nextDescription })
      setTitle(nextTitle)
      setDescription(nextDescription)
      setSiteConfig({ title: nextTitle, description: nextDescription })
      toast.success(t('admin:settings.saved'))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin:common.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[76rem]">
      <header>
        <h1 className="font-serif text-2xl tracking-tight text-[var(--color-fg)] sm:text-3xl">
          {t('admin:menu.siteIdentity', { defaultValue: 'Website information' })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-fg-muted)]">
          {t('admin:settings.fields.siteIdentityLead', { defaultValue: 'Manage the public name and description shown across this deployment.' })}
        </p>
      </header>

      {loading ? <PanelFallback /> : (
        <section className="mt-8 flex flex-col gap-5">
          <Field
            label={t('admin:settings.fields.siteTitle', { defaultValue: 'Website name' })}
            htmlFor="site-title"
            hint={t('admin:settings.fields.siteTitleHint', { defaultValue: 'Shown in the logo and browser tab.' })}
          >
            <Input id="site-title" maxLength={TITLE_MAX_LENGTH} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field
            label={t('admin:settings.fields.siteDescription', { defaultValue: 'Website description' })}
            htmlFor="site-description"
            hint={t('admin:settings.fields.siteDescriptionHint', { defaultValue: 'Used as the public page description. Leave it empty to use the default description.' })}
          >
            <Textarea id="site-description" maxLength={DESCRIPTION_MAX_LENGTH} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-28 resize-y" />
          </Field>
          <div className="flex justify-end">
            <Button loading={saving} onClick={() => void save()}>{t('common:actions.save')}</Button>
          </div>
        </section>
      )}
    </div>
  )
}
