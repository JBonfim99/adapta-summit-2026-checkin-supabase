import { BrowserRouter, Routes, Route, useLocation, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppProvider } from '@/contexts/app-context'
import { AuthProvider } from '@/hooks/use-auth'

import Layout from '@/components/Layout'
import { AdminLayout } from '@/components/AdminLayout'

import Login from '@/pages/Login'
import MagicLink from '@/pages/MagicLink'
import NotFound from '@/pages/NotFound'
import BuyerDashboard from '@/pages/buyer/Dashboard'
import ParticipantForm from '@/pages/participant/Form'
import ParticipantSuccess from '@/pages/participant/Success'
import ParticipantExpired from '@/pages/participant/Expired'
import ParticipantTicket from '@/pages/participant/Ticket'

import AdminLogin from '@/pages/admin/Login'
import AdminDashboard from '@/pages/admin/Dashboard'
import AdminImport from '@/pages/admin/Importar'
import AdminCompradores from '@/pages/admin/Compradores'
import AdminParticipants from '@/pages/admin/Participantes'
import AdminLogs from '@/pages/admin/Logs'
import AdminDispatch from '@/pages/admin/Disparo'
import AdminDispatchWhatsApp from '@/pages/admin/DisparoWhatsApp'
import AdminInsights from '@/pages/admin/Insights'

function PreCredenciamentoRedirect() {
  const { token } = useParams()
  return <Navigate to={`/participante?token=${token}`} replace />
}

function CredenciamentoRedirect() {
  const location = useLocation()
  return <Navigate to={`/participante${location.search}`} replace />
}

function PrefillHack() {
  const location = useLocation()
  useEffect(() => {
    if (location.pathname === '/participante') {
      const params = new URLSearchParams(location.search)
      const nome = params.get('nome')
      const email = params.get('email')

      const attemptFill = () => {
        if (nome) {
          const el = document.querySelector(
            'input[name="nome_completo"], input[name="name"]',
          ) as HTMLInputElement
          if (el && !el.value) {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value',
            )?.set
            setter?.call(el, nome)
            el.dispatchEvent(new Event('input', { bubbles: true }))
          }
        }
        if (email) {
          const el = document.querySelector('input[name="email"]') as HTMLInputElement
          if (el && !el.value) {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value',
            )?.set
            setter?.call(el, email)
            el.dispatchEvent(new Event('input', { bubbles: true }))
          }
        }
      }

      setTimeout(attemptFill, 100)
      setTimeout(attemptFill, 500)
      setTimeout(attemptFill, 1000)
    }
  }, [location])
  return null
}

const App = () => (
  <AppProvider>
    <AuthProvider>
      <BrowserRouter>
        <TooltipProvider>
          <PrefillHack />
          <Toaster />
          <Sonner />
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Login />} />
              <Route path="/acesso" element={<MagicLink />} />

              <Route path="/meus-ingressos" element={<BuyerDashboard />} />

              <Route path="/participante/obrigado" element={<ParticipantSuccess />} />
              <Route path="/participante/expirado" element={<ParticipantExpired />} />
              <Route path="/ingresso" element={<ParticipantTicket />} />
              <Route path="/participante" element={<ParticipantForm />} />
              <Route path="/pre-credenciamento/:token" element={<PreCredenciamentoRedirect />} />
              <Route path="/credenciamento" element={<CredenciamentoRedirect />} />
            </Route>

            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="importar" element={<AdminImport />} />
              <Route path="compradores" element={<AdminCompradores />} />
              <Route path="participantes" element={<AdminParticipants />} />
              <Route path="insights" element={<AdminInsights />} />
              <Route path="disparo" element={<AdminDispatch />} />
              <Route path="disparo-whatsapp" element={<AdminDispatchWhatsApp />} />
              <Route path="logs" element={<AdminLogs />} />
              <Route path="envios" element={<Navigate to="/admin/logs" replace />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </BrowserRouter>
    </AuthProvider>
  </AppProvider>
)

export default App
