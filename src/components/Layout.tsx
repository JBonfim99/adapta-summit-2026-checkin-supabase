import { Outlet, Link, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useApp } from '@/contexts/app-context'
import { Button } from '@/components/ui/button'

export default function Layout() {
  const { buyer, logoutBuyer } = useApp()
  const navigate = useNavigate()

  const handleLogout = () => {
    logoutBuyer()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-7xl">
          <Link
            to={buyer ? '/meus-ingressos' : '/'}
            className="flex items-center gap-2 transition-transform hover:scale-105 shrink-0"
          >
            <span className="text-xl font-bold tracking-tight text-primary">
              Adapta Summit 2026
            </span>
          </Link>

          {buyer && (
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground hidden md:block font-medium">
                {buyer.email}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground hover:bg-muted font-sans font-medium transition-colors"
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
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground max-w-7xl space-y-1">
          <p>
            Seu ingresso garante acesso ao evento nos dois dias. A entrada no evento, incluindo seus
            ambientes internos, têm capacidade limitada por normas de segurança. Ao fazer o check-in
            no evento, você aceita as{' '}
            <a
              href="https://adapta.org/adapta-summit-termos"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Condições de Acesso e Lotação.
            </a>{' '}
            Seus dados são tratados conforme nossa{' '}
            <a
              href="/politica-de-privacidade"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Política de Privacidade
            </a>{' '}
            e usados apenas para fins de credenciamento e comunicação do evento.
          </p>
          <p>© 2026 Adapta Summit. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  )
}
