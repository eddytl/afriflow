import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, BarChart2, Globe, MoreHorizontal, Trash2, Copy, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { funnelsApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { FunnelDialog } from '@/components/dialogs/FunnelDialog';

interface Funnel {
  id: string;
  name: string;
  status: 'draft' | 'published';
  slug: string;
  page_count: number;
  total_views: number;
  total_submissions: number;
  created_at: string;
}

function conversionRate(views: number, subs: number) {
  if (!views) return '0%';
  return `${((subs / views) * 100).toFixed(1)}%`;
}

export function FunnelsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['funnels'], queryFn: funnelsApi.list });

  const publishFunnel = useMutation({
    mutationFn: (id: string) => funnelsApi.publish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funnels'] });
      toast({ variant: 'success', title: 'Tunnel publié' });
    },
  });

  const deleteFunnel = useMutation({
    mutationFn: (id: string) => funnelsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funnels'] });
      toast({ variant: 'success', title: 'Tunnel supprimé' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de supprimer ce tunnel' }),
  });

  const funnels: Funnel[] = data ?? [];

  const columns: ColumnDef<Funnel>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'page_count',
      label: 'Pages',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right text-muted-foreground',
      render: (row) => row.page_count,
    },
    {
      key: 'total_views',
      label: 'Vues',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => row.total_views.toLocaleString('fr-FR'),
    },
    {
      key: 'total_submissions',
      label: 'Soumissions',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => row.total_submissions.toLocaleString('fr-FR'),
    },
    {
      key: 'conversion',
      label: 'Conversion',
      headerClassName: 'text-right',
      className: 'text-right font-medium',
      render: (row) => conversionRate(row.total_views, row.total_submissions),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'published' ? 'success' : 'secondary'}>
          {row.status === 'published' ? 'Publié' : 'Brouillon'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      label: 'Créé le',
      sortable: true,
      className: 'text-muted-foreground text-sm',
      render: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <>
      <DataTable
        title="Tunnels de vente"
        subtitle={`${funnels.length} tunnel${funnels.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />Nouveau tunnel
          </Button>
        }
        data={funnels}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'slug', 'status']}
        emptyIcon={<Filter className="h-10 w-10" />}
        emptyTitle="Aucun tunnel de vente"
        emptyAction={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer mon premier tunnel
          </Button>
        }
        bulkActions={[
          {
            icon: <Trash2 className="h-4 w-4" />,
            label: 'Supprimer',
            variant: 'destructive',
            onClick: (ids) => ids.forEach((id) => deleteFunnel.mutate(id)),
          },
        ]}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem><BarChart2 className="mr-2 h-4 w-4" />Voir analytics</DropdownMenuItem>
              {row.status === 'draft' && (
                <DropdownMenuItem onClick={() => publishFunnel.mutate(row.id)}>
                  <Globe className="mr-2 h-4 w-4" />Publier
                </DropdownMenuItem>
              )}
              <DropdownMenuItem><Copy className="mr-2 h-4 w-4" />Dupliquer</DropdownMenuItem>
              {row.status === 'published' && (
                <DropdownMenuItem asChild>
                  <a href={`/${row.slug}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />Voir en ligne
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={() => deleteFunnel.mutate(row.id)}>
                <Trash2 className="mr-2 h-4 w-4" />Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <FunnelDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
