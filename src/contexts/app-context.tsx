import React, { createContext, useContext, useState, useEffect } from 'react'

interface Buyer {
  id: string
  nome: string
  email: string
  token: string
}

interface AppContextType {
  buyer: Buyer | null
  setBuyer: (b: Buyer | null) => void
  logoutBuyer: () => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [buyer, setBuyer] = useState<Buyer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('adapta_buyer')
    if (stored) {
      try {
        setBuyer(JSON.parse(stored))
      } catch {
        /* intentionally ignored */
      }
    }
    setLoading(false)
  }, [])

  const handleSetBuyer = (b: Buyer | null) => {
    if (b) localStorage.setItem('adapta_buyer', JSON.stringify(b))
    else localStorage.removeItem('adapta_buyer')
    setBuyer(b)
  }

  if (loading) return null

  return (
    <AppContext.Provider
      value={{ buyer, setBuyer: handleSetBuyer, logoutBuyer: () => handleSetBuyer(null) }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) throw new Error('useApp must be used within an AppProvider')
  return context
}
