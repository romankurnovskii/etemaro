import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import App from './App'
import { queryClient } from './lib/queryClient'
import { applyTheme, useThemeStore } from './stores/themeStore'
import './styles.css'

// Apply the stored theme before the first paint so there is no flash.
applyTheme(useThemeStore.getState().mode)

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
