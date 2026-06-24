import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

import AdminLogin from '@/pages/admin/Login'
import AdminDashboard from '@/pages/admin/Dashboard'
import AdminImport from '@/pages/admin/Importar'
import AdminParticipants from '@/pages/admin/Participantes'
import AdminWebhooks from '@/pages/admin/Envios'

const App = () => (
  <AppProvider>
    <AuthProvider>
      <BrowserRouter>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Login />} />
              <Route path="/acesso" element={<MagicLink />} />

              <Route path="/meus-ingressos" element={<BuyerDashboard />} />

              <Route path="/participante/obrigado" element={<ParticipantSuccess />} />
              <Route path="/participante/expirado" element={<ParticipantExpired />} />
              <Route path="/participante" element={<ParticipantForm />} />
            </Route>

            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="importar" element={<AdminImport />} />
              <Route path="participantes" element={<AdminParticipants />} />
              <Route path="envios" element={<AdminWebhooks />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </BrowserRouter>
    </AuthProvider>
  </AppProvider>
)

export default App
