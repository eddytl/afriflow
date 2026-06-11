import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Zap, MoreHorizontal, Pause, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { automationsApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { AutomationDialog } from '@/components/dialogs/AutomationDialog';

interface Automation {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'draft';
  trigger_type: string;
  step_count: number;
  enrolled_count: number;
  created_at: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  contact_created: 'Nouveau contact',
  form_submitted: 'Formulaire soumis',
  tag_added: 'Tag ajouté',
  purchase_made: 'Achat effectué',
  email_opened: 'Email ouvert',
};

export function AutomationsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['automations'], queryFn: automationsApi.list });

  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) => automationsApi.toggle(id, status),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast({ variant: 'success', title: status === 'active' ? 'Automation activée' : 'Automation mise en pause' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de changer le statut' }),
  });

  const automations: Automation[] = data ?? [];
  const activeCount = automations.filter((a) => a.status === 'active').length;

  const columns: ColumnDef<Automation>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'trigger_type',
      label: 'Déclencheur',
      sortable: true,
      className: 'text-muted-foreground text-sm',
      render: (row) => TRIGGER_LABELS[row.trigger_type] ?? row.trigger_type,
    },
    {
      key: 'step_count',
      label: 'Étapes',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right text-muted-foreground',
      render: (row) => row.step_count,
    },
    {
      key: 'enrolled_count',
      label: 'Inscrits',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => row.enrolled_count.toLocaleString('fr-FR'),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : row.status === 'paused' ? 'warning' : 'secondary'}>
          {row.status === 'active' ? 'Active' : row.status === 'paused' ? 'En pause' : 'Brouillon'}
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
        title="Automations"
        subtitle={`${activeCount} active${activeCount !== 1 ? 's' : ''} sur ${automations.length}`}
        headerAction={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />Nouvelle automation
          </Button>
        }
        data={automations}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'trigger_type', 'status']}
        emptyIcon={<Zap className="h-10 w-10" />}
        emptyTitle="Aucune automation"
        emptyAction={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer une automation
          </Button>
        }
        bulkActions={[
          {
            icon: <Trash2 className="h-4 w-4" />,
            label: 'Supprimer',
            variant: 'destructive',
            onClick: () => {},
          },
        ]}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.status === 'active' ? (
                <DropdownMenuItem onClick={() => toggle.mutate({ id: row.id, status: 'paused' })}>
                  <Pause className="mr-2 h-4 w-4" />Mettre en pause
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => toggle.mutate({ id: row.id, status: 'active' })}>
                  <Play className="mr-2 h-4 w-4" />Activer
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <AutomationDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
