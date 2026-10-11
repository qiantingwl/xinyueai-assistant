import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import { adminApi, ApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/hooks/use-toast'
import { PanelFallback } from '@/components/ui/panel-fallback'

type Settings = Record<string, unknown>

const OWNED_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_tls'] as const

export default function AdminSystemEmail() {
  const { t } = useTranslation(['admin', 'common'])
  const [draft, setDraft] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testRecipient, setTestRecipient] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    adminApi.settings()
      .then(setDraft)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : t('admin:common.failed')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function readString(key: string, fallback = ''): string {
    return typeof draft[key] === 'string' ? draft[key] : fallback
  }

  function readBool(key: string, fallback = false): boolean {
    return typeof draft[key] === 'boolean' ? draft[key] : fallback
  }

  function settingsPatch(): Settings {
    const patch: Settings = {}
    for (const key of OWNED_KEYS) {
      if (key in draft) patch[key] = draft[key]
    }
    return patch
  }

  async function save() {
    setSaving(true)
    try {
      await adminApi.updateSettings(settingsPatch())
      toast.success(t('admin:settings.saved'))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin:common.failed'))
    } finally {
      setSaving(false)
    }
  }

  async function sendTestEmail() {
    const recipient = testRecipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast.error(t('admin:settings.fields.smtpTestInvalidEmail'))
      return
    }
    setTesting(true)
    try {
      await adminApi.updateSettings(settingsPatch())
      await adminApi.testEmail(recipient)
      toast.success(t('admin:settings.fields.smtpTestSuccess'))
    } catch (error) {
      const code = error instanceof ApiError ? error.message : ''
      const message =
        code === 'invalid_email'
          ? t('admin:settings.fields.smtpTestInvalidEmail')
          : code === 'email_test_unavailable'
            ? t('admin:settings.fields.smtpTestUnavailable')
            : t('admin:settings.fields.smtpTestFailed')
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  const directTls = readBool('smtp_tls')

  return (
    <div className="mx-auto max-w-[76rem]">
      <header>
        <h1 className="font-serif text-2xl tracking-tight text-[var(--color-fg)] sm:text-3xl">
          {t('admin:menu.emailService', { defaultValue: 'Email service' })}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
          {t('admin:settings.fields.smtpLead')}
        </p>
      </header>

      {loading ? (
        <PanelFallback />
      ) : (
        <section className="mt-8 flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              label={t('admin:settings.fields.smtpHost')}
              htmlFor="smtp-host"
              className="md:col-span-2"
              hint={t('admin:settings.fields.smtpHostHint')}
            >
              <Input
                id="smtp-host"
                value={readString('smtp_host')}
                placeholder="smtp.example.com"
                onChange={(event) => setDraft((current) => ({ ...current, smtp_host: event.target.value }))}
              />
            </Field>
            <Field
              label={t('admin:settings.fields.smtpPort')}
              htmlFor="smtp-port"
              hint={t('admin:settings.fields.smtpPortHint')}
            >
              <Input
                id="smtp-port"
                inputMode="numeric"
                value={readString('smtp_port', '587')}
                placeholder="587"
                onChange={(event) => setDraft((current) => ({ ...current, smtp_port: event.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t('admin:settings.fields.smtpUser')} htmlFor="smtp-user">
              <Input
                id="smtp-user"
                autoComplete="off"
                value={readString('smtp_user')}
                onChange={(event) => setDraft((current) => ({ ...current, smtp_user: event.target.value }))}
              />
            </Field>
            <Field
              label={t('admin:settings.fields.smtpPassword')}
              htmlFor="smtp-password"
              hint={t('admin:settings.fields.smtpPasswordHint')}
            >
              <Input
                id="smtp-password"
                type="password"
                autoComplete="new-password"
                value={readString('smtp_password')}
                onChange={(event) => setDraft((current) => ({ ...current, smtp_password: event.target.value }))}
              />
            </Field>
          </div>

          <Field
            label={t('admin:settings.fields.smtpFrom')}
            htmlFor="smtp-from"
            hint={t('admin:settings.fields.smtpFromHint')}
          >
            <Input
              id="smtp-from"
              value={readString('smtp_from')}
              placeholder="noreply@example.com"
              onChange={(event) => setDraft((current) => ({ ...current, smtp_from: event.target.value }))}
            />
          </Field>

          <div>
            <ToggleRow
              label={t('admin:settings.fields.smtpTls')}
              checked={directTls}
              onChange={(value) => setDraft((current) => ({ ...current, smtp_tls: value }))}
            />
            {directTls && (
              <p className="mt-2 pl-1 text-xs text-[var(--color-fg-subtle)]">
                {t('admin:settings.fields.smtpTlsHint')}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--color-divider)] pt-6">
            <div className="max-w-2xl">
              <h2 className="text-base font-semibold text-[var(--color-fg)]">
                {t('admin:settings.fields.smtpTestTitle')}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-fg-muted)]">
                {t('admin:settings.fields.smtpTestLead')}
              </p>
            </div>
            <div className="mt-4 flex flex-col items-end gap-3 sm:flex-row">
              <Field
                label={t('admin:settings.fields.smtpTestEmail')}
                htmlFor="smtp-test-recipient"
                hint={t('admin:settings.fields.smtpTestEmailHint')}
                className="w-full flex-1"
              >
                <Input
                  id="smtp-test-recipient"
                  type="email"
                  autoComplete="email"
                  value={testRecipient}
                  placeholder="you@example.com"
                  onChange={(event) => setTestRecipient(event.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                loading={testing}
                leadingIcon={<Send size={15} aria-hidden />}
                onClick={() => void sendTestEmail()}
                className="w-full sm:w-auto"
              >
                {t('admin:settings.fields.smtpTestSend')}
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button loading={saving} onClick={() => void save()}>
              {t('common:actions.save')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
