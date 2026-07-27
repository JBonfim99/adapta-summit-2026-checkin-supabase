import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import InsightsResumo from '@/components/admin/InsightsResumo'
import RespostasFeed from '@/components/admin/RespostasFeed'

export default function AdminInsights() {
  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-bold">Insights</h2>
        <p className="text-muted-foreground">
          Resumo agregado e respostas individuais do check-in.
        </p>
      </div>

      <Tabs defaultValue="resumo" className="space-y-6">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="respostas">Respostas</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-0 focus-visible:outline-none">
          <InsightsResumo />
        </TabsContent>

        <TabsContent value="respostas" className="mt-0 focus-visible:outline-none">
          <RespostasFeed />
        </TabsContent>
      </Tabs>
    </div>
  )
}
