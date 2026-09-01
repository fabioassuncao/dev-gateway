import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { render } from '@testing-library/react'
import i18n from '../../src/ui/i18n/index.ts'
import type { Locale } from '../../src/ui/i18n/use-locale.ts'

export function renderWithQuery(ui: ReactElement, locale?: Locale) {
  if (locale) void i18n.changeLanguage(locale)

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nextProvider>
  )
  return { ...render(ui, { wrapper }), client, i18n }
}
