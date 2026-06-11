import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface ContactTag {
  id: string;
  name: string;
  color?: string;
  total_count: number;
  today_count: number;
  yesterday_count: number;
  deleted_count: number;
  total_sales: number;
  created_at: string;
}

function formatCurrency(value: number) {
  if (!value) return '0,00 €';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

export function TagsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const { data: tags = [], isLoading } = useQuery<ContactTag[]>({
    queryKey: ['tags'],
    queryFn: () => api.get('/crm/tags').then((r) => r.data),
  });

  const add = useMutation({
    mutationFn: () => api.post('/crm/tags', { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      toast({ variant: 'success', title: 'Tag créé' });
      setName('');
      setOpen(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le tag' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/tags/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      toast({ variant: 'success', title: 'Tag supprimé' });
    },
  });

  const columns: ColumnDef<ContactTag>[] = [
    {
      key: 'name',
      label: 'Nom du tag',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.color ?? '#6c63ff' }}
          />
          <span className="font-medium text-primary hover:underline cursor-pointer">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'today_count',
      label: "Aujourd'hui",
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      render: (row) => Number(row.today_count ?? 0).toLocaleString('fr-FR'),
    },
    {
      key: 'yesterday_count',
      label: 'Hier',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      render: (row) => Number(row.yesterday_count ?? 0).toLocaleString('fr-FR'),
    },
    {
      key: 'total_count',
      label: 'Total',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums font-medium',
      render: (row) => Number(row.total_count ?? 0).toLocaleString('fr-FR'),
    },
    {
      key: 'deleted_count',
      label: 'Supprimé',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      render: (row) => Number(row.deleted_count ?? 0).toLocaleString('fr-FR'),
    },
    {
      key: 'total_sales',
      label: 'Total des ventes',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums',
      render: (row) => formatCurrency(Number(row.total_sales ?? 0)),
    },
    {
      key: 'id',
      label: 'Ventes par contact',
      sortable: false,
      headerClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      render: (row) => {
        const total = Number(row.total_count ?? 0);
        const sales = Number(row.total_sales ?? 0);
        return formatCurrency(total > 0 ? sales / total : 0);
      },
    },
  ];

  return (
    <>
      <DataTable
        title="Tags"
        subtitle={`${tags.length} tag${tags.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer
          </Button>
        }
        data={tags}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Recherche..."
        searchKeys={['name']}
        emptyIcon={<Tag className="h-10 w-10" />}
        emptyTitle="Aucun tag créé"
        emptyAction={
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer le premier tag
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
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => remove.mutate(row.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Créer un tag</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input
              placeholder="Nom du tag"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name && add.mutate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button disabled={!name || add.isPending} onClick={() => add.mutate()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
