import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, MoreHorizontal, Trash2, Edit, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { contactsApi } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { ContactDialog } from '@/components/dialogs/ContactDialog';
import { ImportContactsDialog } from '@/components/dialogs/ImportContactsDialog';
import { cn } from '@/lib/utils';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  country?: string;
  tags?: string[];
  unsubscribed: boolean;
  bounced: boolean;
  created_at: string;
}

interface FilterState {
  operator: string;
  value: string;
}
type ActiveFilters = Record<string, FilterState>;

const FILTER_FIELDS = [
  { key: 'email',      label: 'Email',              type: 'text'   },
  { key: 'first_name', label: 'Prénom',              type: 'text'   },
  { key: 'last_name',  label: 'Nom',                 type: 'text'   },
  { key: 'country',    label: 'Pays',                type: 'text'   },
  { key: 'tag',        label: 'Tag',                 type: 'tag'    },
  { key: 'status',     label: 'Etat du contact',     type: 'status' },
] as const;

const TEXT_OPS = [
  { value: 'contains',     label: 'Contient' },
  { value: 'not_contains', label: 'Ne contient pas' },
  { value: 'exact',        label: 'Correspondance exacte' },
  { value: 'not_exact',    label: 'Ne correspond pas exactement' },
  { value: 'starts_with',  label: 'Commence par' },
  { value: 'ends_with',    label: 'Se termine par' },
];
const TAG_OPS = [
  { value: 'in',     label: 'Contact marqué avec' },
  { value: 'not_in', label: 'Contact non marqué avec' },
];
const STATUS_OPTIONS = [
  { value: 'active',        label: 'Actif' },
  { value: 'unsubscribed',  label: 'Désabonné' },
  { value: 'bounced',       label: 'Bounced' },
];

function getOperators(type: string) {
  if (type === 'tag') return TAG_OPS;
  if (type === 'status') return [{ value: 'equals', label: 'Est' }];
  return TEXT_OPS;
}
function defaultOp(type: string) {
  if (type === 'tag') return 'in';
  return 'contains';
}

function buildParams(filters: ActiveFilters, page: number, limit: number): Record<string, string> {
  const p: Record<string, string> = { page: String(page), limit: String(limit) };
  for (const [key, state] of Object.entries(filters)) {
    if (!state.value.trim()) continue;
    switch (key) {
      case 'email':      p.email      = state.value; p.email_op      = state.operator; break;
      case 'first_name': p.first_name = state.value; p.first_name_op = state.operator; break;
      case 'last_name':  p.last_name  = state.value; p.last_name_op  = state.operator; break;
      case 'country':    p.country    = state.value; p.country_op    = state.operator; break;
      case 'tag':        p.tag        = state.value; p.tag_op        = state.operator; break;
      case 'status':     p.status     = state.value; break;
    }
  }
  return p;
}

function StatusBadge({ contact }: { contact: Contact }) {
  if (contact.bounced)      return <Badge variant="destructive" className="text-xs">Bounced</Badge>;
  if (contact.unsubscribed) return <Badge variant="secondary"   className="text-xs">Désabonné</Badge>;
  return <Badge variant="success" className="text-xs">Actif</Badge>;
}

const PAGE_SIZE = 50;

export function ContactsPage() {
  const qc = useQueryClient();
  const [sidebarTab, setSidebarTab] = useState<'filter' | 'saved'>('filter');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const params = buildParams(activeFilters, page, PAGE_SIZE);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', params],
    queryFn: () => contactsApi.list(params),
  });

  const deleteContact = useMutation({
    mutationFn: (id: string) => contactsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast({ variant: 'success', title: 'Contact supprimé' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de supprimer ce contact' }),
  });

  const contacts: Contact[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleFilter = (key: string, checked: boolean) => {
    setActiveFilters((prev) => {
      if (!checked) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const field = FILTER_FIELDS.find((f) => f.key === key);
      return { ...prev, [key]: { operator: defaultOp(field?.type ?? 'text'), value: '' } };
    });
    setPage(1);
  };

  const updateFilter = (key: string, field: 'operator' | 'value', val: string) => {
    setActiveFilters((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
    if (field === 'value') setPage(1);
  };

  const resetFilters = () => { setActiveFilters({}); setPage(1); };

  return (
    <div className="-mx-5 -my-4 lg:-mx-8 flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Filter sidebar ───────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r bg-background flex flex-col">

        {/* Tabs */}
        <div className="flex shrink-0 border-b">
          {(['filter', 'saved'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSidebarTab(t)}
              className={cn(
                'flex-1 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                sidebarTab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'filter' ? 'Filtrer par' : 'Filtres enregistrés'}
            </button>
          ))}
        </div>

        {sidebarTab === 'filter' ? (
          <>
            <div className="flex-1 overflow-y-auto">
              {FILTER_FIELDS.map((field) => {
                const active = activeFilters[field.key];
                const ops    = getOperators(field.type);
                return (
                  <div key={field.key} className="px-3 py-2 border-b border-border/30">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`f-${field.key}`}
                        checked={!!active}
                        onCheckedChange={(v) => toggleFilter(field.key, !!v)}
                      />
                      <label htmlFor={`f-${field.key}`} className="text-xs cursor-pointer select-none">
                        {field.label}
                      </label>
                    </div>

                    {active && (
                      <div className="mt-2 ml-5 space-y-1.5">
                        <Select value={active.operator} onValueChange={(v) => updateFilter(field.key, 'operator', v)}>
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ops.map((op) => (
                              <SelectItem key={op.value} value={op.value} className="text-xs">
                                {op.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {field.type === 'status' ? (
                          <Select value={active.value} onValueChange={(v) => updateFilter(field.key, 'value', v)}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Sélectionner..." />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="h-7 text-xs"
                            placeholder="Valeur..."
                            value={active.value}
                            onChange={(e) => updateFilter(field.key, 'value', e.target.value)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="px-3 py-2">
                <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Plus className="h-3 w-3" />
                  Ajouter une condition
                </button>
              </div>
            </div>

            <div className="shrink-0 border-t p-3 flex gap-2">
              <Button
                variant="outline" size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => toast({ title: 'Fonctionnalité à venir' })}
              >
                Enregistrer filtre
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={resetFilters}>
                Réinitialiser
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xs text-muted-foreground text-center">Aucun filtre enregistré</p>
          </div>
        )}
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Page header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b">
          <h1 className="text-lg font-semibold">Contacts</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Importer des contacts
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Ajouter un contact
            </Button>
          </div>
        </div>

        {/* Sub-header */}
        <div className="shrink-0 flex items-center gap-4 px-5 border-b">
          <span className="py-2 text-xs text-muted-foreground">
            {total.toLocaleString('fr-FR')} contact{total !== 1 ? 's' : ''}
          </span>
          <button className="py-2 text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground border-b-2 border-transparent transition-colors">
            <Trash className="h-3 w-3" />
            Récemment supprimé
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-3"><Checkbox /></TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Pays</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Ajouté</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : contacts.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-52 text-center">
                      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                        <p className="text-sm">Aucun contact trouvé</p>
                        {Object.keys(activeFilters).length > 0 && (
                          <button className="text-xs text-primary hover:underline" onClick={resetFilters}>
                            Réinitialiser les filtres
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
                : contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="px-3"><Checkbox /></TableCell>
                    <TableCell className="font-medium">{c.first_name} {c.last_name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone ?? '—'}</TableCell>
                    <TableCell>{c.country ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.tags?.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                        ))}
                        {(c.tags?.length ?? 0) > 2 && (
                          <Badge variant="outline" className="text-xs">+{(c.tags?.length ?? 0) - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge contact={c} /></TableCell>
                    <TableCell className="text-muted-foreground text-xs" title={formatDate(c.created_at)}>
                      {formatRelative(c.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(c)}>
                            <Edit className="mr-2 h-4 w-4" />Modifier
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteContact.mutate(c.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="shrink-0 border-t px-5 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page} / {totalPages} — {total.toLocaleString('fr-FR')} résultats</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage(1)}>«</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
            </div>
          </div>
        )}
      </div>

      <ContactDialog open={showCreate} onOpenChange={setShowCreate} />
      <ContactDialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} contact={editing} />
      <ImportContactsDialog open={showImport} onOpenChange={setShowImport} />
    </div>
  );
}
