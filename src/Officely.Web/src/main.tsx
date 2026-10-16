import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ShopStatusProvider } from './shopStatus'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShopStatusProvider>
      <App />
    </ShopStatusProvider>
  </StrictMode>,
)
