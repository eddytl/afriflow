import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, GitBranch, MoreHorizontal, Trash2, Play, Pause, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'draft';
  node_count: number;
  enrollment_count: number;
  created_at: string;
}

export function WorkflowsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: () => api.get('/workflows').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/workflows', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      toast({ variant: 'success', title: 'Workflow créé' });
      setForm({ name: '', description: '' });
      setOpen(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le workflow' }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
      api.patch(`/workflows/${id}`, { status }),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      toast({ variant: 'success', title: status === 'active' ? 'Workflow activé' : 'Workflow mis en pause' });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      toast({ variant: 'success', title: 'Workflow supprimé' });
    },
  });

  const columns: ColumnDef<Workflow>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{row.description}</p>}
        </div>
      ),
    },
    {
      key: 'node_count',
      label: 'Étapes',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right text-muted-foreground',
      render: (row) => row.node_count ?? 0,
    },
    {
      key: 'enrollment_count',
      label: 'Inscrits',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => (row.enrollment_count ?? 0).toLocaleString('fr-FR'),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : row.status === 'paused' ? 'warning' : 'secondary'}>
          {row.status === 'active' ? 'Actif' : row.status === 'paused' ? 'En pause' : 'Brouillon'}
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
        title="Workflows"
        subtitle={`${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Nouveau workflow
          </Button>
        }
        data={workflows}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'description', 'status']}
        emptyIcon={<GitBranch className="h-10 w-10" />}
        emptyTitle="Aucun workflow"
        emptyAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer un workflow
          </Button>
        }
        bulkActions={[
          {
            icon: <Trash2 className="h-4 w-4" />,
            label: 'Supprimer',
            variant: 'destructive',
            onClick: (ids) => ids.forEach((id) => remove.mutate(id)),
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
              <DropdownMenuItem><Copy className="mr-2 h-4 w-4" />Dupliquer</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => remove.mutate(row.id)}>
                <Trash2 className="mr-2 h-4 w-4" />Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouveau workflow</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nom <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Mon workflow"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="Description optionnelle"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button disabled={!form.name || create.isPending} onClick={() => create.mutate()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
