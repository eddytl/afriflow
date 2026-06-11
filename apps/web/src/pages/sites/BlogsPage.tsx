import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, BookOpen, ExternalLink, MoreHorizontal, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface Blog {
  id: string;
  name: string;
  url_path?: string;
  post_count?: number;
  created_at: string;
}

export function BlogsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });

  const { data: blogs = [], isLoading } = useQuery<Blog[]>({
    queryKey: ['blogs'],
    queryFn: () => api.get('/sites/blogs').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/sites/blogs', { name: form.name, urlPath: form.slug || form.name.toLowerCase().replace(/\s+/g, '-') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blogs'] });
      toast({ variant: 'success', title: 'Blog créé' });
      setForm({ name: '', slug: '' });
      setOpen(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le blog' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sites/blogs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blogs'] }); toast({ variant: 'success', title: 'Blog supprimé' }); },
  });

  const columns: ColumnDef<Blog>[] = [
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
      key: 'post_count',
      label: 'Articles',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => (
        <span className="flex items-center justify-end gap-1 text-muted-foreground text-sm">
          <FileText className="h-3.5 w-3.5" />
          {row.post_count ?? 0}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Blogs"
        subtitle={`${blogs.length} blog${blogs.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Créer
          </Button>
        }
        data={blogs}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Filtrer par nom..."
        searchKeys={['name', 'url_path']}
        emptyIcon={<BookOpen className="h-10 w-10" />}
        emptyTitle="Aucun blog"
        emptyAction={<Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Créer un blog</Button>}
        bulkActions={[{ icon: <Trash2 className="h-4 w-4" />, label: 'Supprimer', variant: 'destructive', onClick: (ids) => ids.forEach((id) => remove.mutate(id)) }]}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem><ExternalLink className="mr-2 h-4 w-4" />Voir le blog</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => remove.mutate(row.id)}>
                <Trash2 className="mr-2 h-4 w-4" />Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouveau blog</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nom <span className="text-destructive">*</span></Label>
              <Input placeholder="Mon blog" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug URL</Label>
              <Input placeholder="mon-blog" value={form.slug} onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))} />
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
