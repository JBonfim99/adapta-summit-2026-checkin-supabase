import { Outlet, Link, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useApp } from '@/contexts/app-context'
import { Button } from '@/components/ui/button'

export default function Layout() {
  const { user, buyer, logout } = useApp()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-7xl">
          <Link
            to={buyer ? '/meus-ingressos' : '/'}
            className="flex items-center gap-2 transition-transform hover:scale-105"
          >
            <img
              src="https://drive.google.com/uc?export=view&id=1r4vxmkHX_HWaDV6MaZshIJXLpr7vRCxs"
              alt="Adapta Summit 2026"
              className="h-8 w-auto object-contain"
            />
          </Link>

          {user && (
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground hidden md:block">{user.email}</div>
              {user.role === 'admin' && (
                <Link to="/admin" className="text-sm font-medium hover:text-accent">
                  Admin
                </Link>
              )}
              {user.role === 'buyer' && (
                <Link to="/meus-ingressos" className="text-sm font-medium hover:text-accent">
                  Ingressos
                </Link>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sair
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl animate-fade-in">
        <Outlet />
      </main>

      <footer className="border-t bg-white py-6 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground max-w-7xl">
          <p>© 2026 Adapta Summit. Todos os direitos reservados.</p>
          <div className="mt-2 space-x-4">
            <a href="#" className="hover:text-primary transition-colors">
              Suporte
            </a>
            <a href="#" className="hover:text-primary transition-colors">
              Termos
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
