/**
 * 快速搜索浮窗页面入口。
 * 页面运行在 runtime 创建的子窗里（brick-child preload 注入 window.brickly），
 * 业务能力全部经 brickly.notify/request 走 runtime 中转，不直连宿主。
 */
import './style.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QuickSearchPage } from './QuickSearchPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QuickSearchPage />
  </StrictMode>
)
