import { createRoot } from 'react-dom/client'
import { Provider } from "./components/ui/provider"
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <Provider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/room-1" replace />} />
        <Route path="/:roomId" element={<App />} />
      </Routes>
    </BrowserRouter>
  </Provider>
)
