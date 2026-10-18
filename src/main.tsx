import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import GameLearningApp from './GameLearningApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameLearningApp />
  </StrictMode>,
)
