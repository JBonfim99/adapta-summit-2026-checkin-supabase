import { Outlet, Navigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import {
  LayoutDashboard,
  Users,
  Upload,
  Send,
  LogOut,
  ShoppingBag,
  Mail,
  BarChart3,
  MessageCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function AdminLayout() {
  const { isAuthenticated, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />

  const navItems = [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'Importar', path: '/admin/importar', icon: Upload },
    { name: 'Compradores', path: '/admin/compradores', icon: ShoppingBag },
    { name: 'Participantes', path: '/admin/participantes', icon: Users },
    { name: 'Insights', path: '/admin/insights', icon: BarChart3 },
    { name: 'Disparo', path: '/admin/disparo', icon: Mail },
    { name: 'Disparo WhatsApp', path: '/admin/disparo-whatsapp', icon: MessageCircle },
    { name: 'Logs', path: '/admin/logs', icon: Send },
  ]

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-white border-r flex flex-col flex-shrink-0">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-primary tracking-tight">Adapta Admin</h2>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                location.pathname === item.path
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium text-sm">{item.name}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-rose-50 text-rose-600 w-full text-left transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium text-sm">Sair</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
