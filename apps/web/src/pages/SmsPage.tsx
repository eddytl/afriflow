import { Plus, MessageSquare, Send, Users, FileText, BarChart2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SmsPageProps { tab?: 'templates' | 'statistics' }

function TemplatesTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates SMS</h1>
          <p className="text-sm text-muted-foreground">Gérez vos modèles de messages SMS</p>
        </div>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Créer un template</Button>
      </div>
      <div className="flex flex-col items-center justify-center h-64 gap-3 rounded-lg border border-dashed text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="font-medium">Aucun template SMS</p>
          <p className="text-sm text-muted-foreground">Créez des modèles réutilisables pour vos campagnes SMS</p>
        </div>
        <Button size="sm" variant="outline"><Plus className="mr-2 h-4 w-4" />Créer un template</Button>
      </div>
    </div>
  );
}

function StatisticsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Statistiques SMS</h1>
        <p className="text-sm text-muted-foreground">Analysez les performances de vos envois SMS</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">SMS envoyés</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">—</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de livraison</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">—</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Destinataires actifs</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">—</div></CardContent>
        </Card>
      </div>
      <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-lg border border-dashed text-center">
        <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Aucune donnée disponible pour cette période</p>
      </div>
    </div>
  );
}

export function SmsPage({ tab = 'templates' }: SmsPageProps) {
  return tab === 'statistics' ? <StatisticsTab /> : <TemplatesTab />;
}
