import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Send, Eye, MousePointerClick, AlertTriangle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { emailsApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { CampaignDialog } from '@/components/dialogs/CampaignDialog';

interface EmailStat {
  id: string;
  subject: string;
  from_name: string;
  from_email: string;
  sent_at: string;
  sent_count: number;
  opened: number;
  clicked: number;
  bounced: number;
  spam: number;
}

function rate(n: number, d: number) {
  if (!d) return '0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function CampaignStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { variant: 'success' | 'info' | 'secondary' | 'warning'; label: string }> = {
    sent: { variant: 'success', label: 'Envoyée' },
    sending: { variant: 'info', label: 'En cours' },
    draft: { variant: 'secondary', label: 'Brouillon' },
    scheduled: { variant: 'warning', label: 'Planifiée' },
  };
  const { variant, label } = cfg[status] ?? { variant: 'secondary', label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

function CampaignsTab() {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: emailsApi.campaigns });
  const campaigns = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />Nouvelle campagne
        </Button>
      </div>
      {isLoading ? (
        <Card><Table><TableBody>{Array.from({ length: 4 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}</TableBody></Table></Card>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-lg border border-dashed">
          <Mail className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Aucune campagne email</p>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Créer une campagne</Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Destinataires</TableHead>
                <TableHead>Date d'envoi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c: { id: string; name: string; subject: string; status: string; recipient_count: number; scheduled_at?: string }) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{c.subject}</TableCell>
                  <TableCell><CampaignStatusBadge status={c.status} /></TableCell>
                  <TableCell>{(c.recipient_count ?? 0).toLocaleString('fr-FR')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.scheduled_at ? formatDate(c.scheduled_at) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <CampaignDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function NewslettersTab() {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['newsletters'], queryFn: emailsApi.newsletters });
  const newsletters = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />Nouvelle newsletter
        </Button>
      </div>
      {isLoading ? (
        <Card><Table><TableBody>{Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>)}</TableBody></Table></Card>
      ) : newsletters.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-lg border border-dashed">
          <Mail className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Aucune newsletter</p>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Créer une newsletter</Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sujet</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Envoyés</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newsletters.map((n: { id: string; subject: string; status: string; sent_count: number; sent_at?: string }) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.subject}</TableCell>
                  <TableCell><CampaignStatusBadge status={n.status} /></TableCell>
                  <TableCell className="text-right">{(n.sent_count ?? 0).toLocaleString('fr-FR')}</TableCell>
                  <TableCell className="text-muted-foreground">{n.sent_at ? formatDate(n.sent_at) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <CampaignDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function StatisticsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['email-statistics'], queryFn: emailsApi.statistics });
  const rows: EmailStat[] = data?.rows ?? [];
  const overview = data?.overview;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Emails envoyés', value: (overview?.totalSent ?? 0).toLocaleString('fr-FR'), icon: Send },
          { label: 'Taux ouverture', value: `${(overview?.openRate ?? 0).toFixed(1)}%`, icon: Eye },
          { label: 'Taux de clic', value: `${(overview?.clickRate ?? 0).toFixed(1)}%`, icon: MousePointerClick },
          { label: 'Taux de bounce', value: `${(overview?.bounceRate ?? 0).toFixed(1)}%`, icon: AlertTriangle },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-20" /> : <div className="text-2xl font-bold">{kpi.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sujet</TableHead>
              <TableHead>Envoyé le</TableHead>
              <TableHead className="text-right">Envoyés</TableHead>
              <TableHead className="text-right">Ouvertures</TableHead>
              <TableHead className="text-right">Clics</TableHead>
              <TableHead className="text-right">Bounces</TableHead>
              <TableHead className="text-right">Spam</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Aucune statistique disponible</TableCell></TableRow>
                )
              : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.subject}</div>
                      <div className="text-xs text-muted-foreground">{r.from_name} &lt;{r.from_email}&gt;</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.sent_at)}</TableCell>
                    <TableCell className="text-right">{r.sent_count.toLocaleString('fr-FR')}</TableCell>
                    <TableCell className="text-right">
                      {Number(r.opened).toLocaleString('fr-FR')}
                      <span className="ml-1 text-xs text-muted-foreground">({rate(Number(r.opened), r.sent_count)})</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(r.clicked).toLocaleString('fr-FR')}
                      <span className="ml-1 text-xs text-muted-foreground">({rate(Number(r.clicked), r.sent_count)})</span>
                    </TableCell>
                    <TableCell className="text-right text-amber-600">{Number(r.bounced).toLocaleString('fr-FR')}</TableCell>
                    <TableCell className="text-right text-red-500">{Number(r.spam).toLocaleString('fr-FR')}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export function EmailsPage() {
  return (
    <Tabs defaultValue="campaigns">
      <TabsList>
        <TabsTrigger value="campaigns">Campagnes</TabsTrigger>
        <TabsTrigger value="newsletters">Newsletters</TabsTrigger>
        <TabsTrigger value="statistics">Statistiques</TabsTrigger>
      </TabsList>
      <TabsContent value="campaigns" className="mt-4"><CampaignsTab /></TabsContent>
      <TabsContent value="newsletters" className="mt-4"><NewslettersTab /></TabsContent>
      <TabsContent value="statistics" className="mt-4"><StatisticsTab /></TabsContent>
    </Tabs>
  );
}
