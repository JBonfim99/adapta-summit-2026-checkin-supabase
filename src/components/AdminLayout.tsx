import { Outlet, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, Upload, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/contexts/app-context'
import { Navigate } from 'react-router-dom'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: Upload, label: 'Importar', path: '/admin/importar' },
  { icon: Users, label: 'Participantes', path: '/admin/participantes' },
  { icon: Webhook, label: 'Webhooks', path: '/admin/envios' },
]

export function AdminLayout() {
  const location = useLocation()
  const { user } = useApp()

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 animate-fade-in">
      <aside className="w-full md:w-64 shrink-0">
        <nav className="flex md:flex-col gap-2 overflow-x-auto pb-4 md:pb-0">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0 bg-white rounded-xl shadow-subtle border p-6">
        <Outlet />
      </div>
    </div>
  )
}
