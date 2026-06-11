import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCircle, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface CreatorPage {
  id: string;
  name: string;
  url_path?: string;
  status: 'active' | 'draft';
  created_at: string;
}

export function CreatorPagesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });

  const { data: pages = [], isLoading } = useQuery<CreatorPage[]>({
    queryKey: ['creator-pages'],
    queryFn: () => api.get('/sites/stores').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/sites/stores', { name: form.name, urlPath: form.slug || form.name.toLowerCase().replace(/\s+/g, '-') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator-pages'] });
      toast({ variant: 'success', title: 'Page créée' });
      setForm({ name: '', slug: '' });
      setOpen(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer la page' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sites/stores/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['creator-pages'] }); toast({ variant: 'success', title: 'Page supprimée' }); },
  });

  const columns: ColumnDef<CreatorPage>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'url_path',
      label: 'URL',
      className: 'text-muted-foreground text-sm',
      render: (row) => row.url_path ?? '—',
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : 'secondary'}>
          {row.status === 'active' ? 'Actif' : 'Brouillon'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Pages créateur"
        subtitle={`${pages.length} page${pages.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer
          </Button>
        }
        data={pages}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'url_path']}
        emptyIcon={<UserCircle className="h-10 w-10" />}
        emptyTitle="Aucune page créateur"
        emptyAction={<Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Créer une page</Button>}
        bulkActions={[{ icon: <Trash2 className="h-4 w-4" />, label: 'Supprimer', variant: 'destructive', onClick: (ids) => ids.forEach((id) => remove.mutate(id)) }]}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem><ExternalLink className="mr-2 h-4 w-4" />Voir la page</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => remove.mutate(row.id)}>
                <Trash2 className="mr-2 h-4 w-4" />Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouvelle page créateur</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nom <span className="text-destructive">*</span></Label>
              <Input placeholder="Ma page" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug URL</Label>
              <Input placeholder="ma-page" value={form.slug} onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))} />
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
