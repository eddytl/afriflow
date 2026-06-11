import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Globe, ExternalLink, MoreHorizontal, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface Website {
  id: string;
  name: string;
  url_path?: string;
  status: 'active' | 'draft' | 'inactive';
  created_at: string;
}

export function WebsitesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });

  const { data: websites = [], isLoading } = useQuery<Website[]>({
    queryKey: ['websites'],
    queryFn: () => api.get('/sites/websites').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/sites/websites', { name: form.name, urlPath: form.slug || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['websites'] });
      toast({ variant: 'success', title: 'Site créé' });
      setForm({ name: '', slug: '' });
      setOpen(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le site' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sites/websites/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); toast({ variant: 'success', title: 'Site supprimé' }); },
  });

  const columns: ColumnDef<Website>[] = [
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
        title="Sites web"
        subtitle={`${websites.length} site${websites.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer
          </Button>
        }
        data={websites}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'url_path']}
        emptyIcon={<Globe className="h-10 w-10" />}
        emptyTitle="Aucun site web"
        emptyAction={<Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Créer un site</Button>}
        bulkActions={[{ icon: <Trash2 className="h-4 w-4" />, label: 'Supprimer', variant: 'destructive', onClick: (ids) => ids.forEach((id) => remove.mutate(id)) }]}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem><ExternalLink className="mr-2 h-4 w-4" />Voir le site</DropdownMenuItem>
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
          <DialogHeader><DialogTitle>Nouveau site web</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nom <span className="text-destructive">*</span></Label>
              <Input placeholder="Mon site" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug URL</Label>
              <Input placeholder="mon-site" value={form.slug} onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))} />
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
