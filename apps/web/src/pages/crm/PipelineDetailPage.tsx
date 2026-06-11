import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { crmApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { PipelineContactDialog } from '@/components/dialogs/PipelineContactDialog';

interface Deal {
  id: string;
  title: string;
  value: number;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  deal_count: number;
  total_value: number;
  deals?: Deal[];
}

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

interface StageRow { id: string; name: string }

/* ── Filter config ─────────────────────────────────────────────── */
const FILTER_FIELDS = [
  'Email', 'Prénom', 'Nom', 'Adresse', 'Numéro de rue', 'Quartier',
  'Code postal', 'Ville', 'Région', 'Pays', 'Numéro de téléphone',
  'Tag', "Date d'ajout", 'Activité email', 'Etat du contact',
  "Nom de l'entreprise", "Numéro d'identification fiscale", "Envoyé par l'affilié",
];

const TEXT_OPS = [
  { value: 'exact',        label: 'Correspondance exacte' },
  { value: 'not_exact',    label: 'Ne correspond pas exactement' },
  { value: 'contains',     label: 'Contient' },
  { value: 'not_contains', label: 'Ne contient pas' },
  { value: 'starts_with',  label: 'Commence par' },
  { value: 'ends_with',    label: 'Se termine par' },
];

interface FilterCondition { operator: string; value: string }
interface FilterEntry     { conditions: FilterCondition[]   }
type ActiveFilters = Record<string, FilterEntry>;

/* ── Edit pipeline modal ───────────────────────────────────────── */
let editCounter = 100;

function EditPipelineModal({
  open, onOpenChange, pipeline,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipeline: Pipeline;
}) {
  const qc = useQueryClient();
  const [name, setName]     = useState(pipeline.name);
  const [stages, setStages] = useState<StageRow[]>(
    pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
  );
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setName(pipeline.name);
      setStages(pipeline.stages.map((s) => ({ id: s.id, name: s.name })));
    }
  }, [open, pipeline]);

  const save = useMutation({
    mutationFn: async () => {
      // Update pipeline name if changed
      if (name.trim() !== pipeline.name) {
        await crmApi.updatePipeline(pipeline.id, { name: name.trim() });
      }
      // For stage reordering/rename: update each stage
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i];
        const original = pipeline.stages.find((os) => os.id === s.id);
        if (original && (original.name !== s.name || original.position !== i)) {
          await crmApi.updateStage(pipeline.id, s.id, { name: s.name, position: i });
        } else if (!original) {
          // New stage (shouldn't happen in edit, but guard)
          await crmApi.createStage(pipeline.id, { name: s.name, position: i });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline', pipeline.id] });
      toast({ variant: 'success', title: 'Pipeline mis à jour' });
      onOpenChange(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur lors de la mise à jour' }),
  });

  const addStage = () =>
    setStages((p) => [...p, { id: `new-${++editCounter}`, name: '' }]);

  const removeStage = (id: string) => setStages((p) => p.filter((s) => s.id !== id));

  const updateStage = (id: string, val: string) =>
    setStages((p) => p.map((s) => (s.id === id ? { ...s, name: val } : s)));

  const onDragStart = (i: number) => { dragIdx.current = i; };
  const onDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    setStages((p) => {
      const next = [...p];
      const [item] = next.splice(dragIdx.current!, 1);
      next.splice(i, 0, item);
      dragIdx.current = i;
      return next;
    });
  };
  const onDragEnd = () => { dragIdx.current = null; };

  const canSave = name.trim() && stages.every((s) => s.name.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Éditer le pipeline</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nom du pipeline</label>
            <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-primary">Étapes</span>
              <button
                type="button"
                onClick={addStage}
                className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {stages.map((stage, i) => (
                <div
                  key={stage.id}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  className="flex items-center gap-2"
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 cursor-grab" />
                  <Input
                    className="flex-1 h-9"
                    value={stage.name}
                    onChange={(e) => updateStage(stage.id, e.target.value)}
                  />
                  {stages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStage(stage.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            Sauvegarder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Stage column ──────────────────────────────────────────────── */
function StageColumn({
  stage, pipelineId,
}: {
  stage: Stage;
  pipelineId: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const deals = stage.deals ?? [];

  return (
    <div className="flex shrink-0 flex-col w-[175px] bg-background rounded-xl border shadow-sm overflow-hidden">
      {/* Column header */}
      <div className="px-3 py-2.5 border-b">
        <span className="text-xs font-semibold">{stage.name}</span>
      </div>

      {/* Add contact button */}
      <div className="px-2 pt-2">
        <button
          onClick={() => setShowAdd(true)}
          className="w-full flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-2 py-1.5 text-xs text-primary hover:bg-primary/5 transition-colors"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Plus className="h-2.5 w-2.5" />
          </span>
          Ajouter un contact
        </button>
      </div>

      {/* Deals */}
      <div className="flex-1 px-2 py-2 space-y-1.5">
        {deals.map((deal) => (
          <div key={deal.id} className="rounded-md bg-muted/50 px-2.5 py-2 text-xs">
            <p className="font-medium truncate">{deal.title}</p>
            {deal.value > 0 && (
              <p className="text-muted-foreground mt-0.5">{formatCurrency(deal.value)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {deals.length === 0 && (
        <div className="flex-1 flex items-center justify-center pb-8">
          <p className="text-xs text-muted-foreground/60 text-center px-4">
            On dirait que l'étape est vide
          </p>
        </div>
      )}

      <PipelineContactDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        pipelineId={pipelineId}
        stageId={stage.id}
      />
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────── */
export function PipelineDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [showEdit, setShowEdit] = useState(false);

  const toggleField = (field: string, checked: boolean) => {
    setActiveFilters((p) => {
      if (!checked) { const n = { ...p }; delete n[field]; return n; }
      return { ...p, [field]: { conditions: [{ operator: 'exact', value: '' }] } };
    });
  };
  const addCondition = (field: string) =>
    setActiveFilters((p) => ({
      ...p,
      [field]: { conditions: [...(p[field]?.conditions ?? []), { operator: 'exact', value: '' }] },
    }));
  const removeCondition = (field: string, idx: number) =>
    setActiveFilters((p) => {
      const conds = (p[field]?.conditions ?? []).filter((_, i) => i !== idx);
      if (!conds.length) { const n = { ...p }; delete n[field]; return n; }
      return { ...p, [field]: { conditions: conds } };
    });
  const updateCondition = (field: string, idx: number, key: 'operator' | 'value', val: string) =>
    setActiveFilters((p) => ({
      ...p,
      [field]: {
        conditions: (p[field]?.conditions ?? []).map((c, i) => i === idx ? { ...c, [key]: val } : c),
      },
    }));
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };
    if (showFilter) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilter]);

  const { data: pipeline, isLoading } = useQuery({
    queryKey: ['pipeline', id],
    queryFn: () => crmApi.getPipeline(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-36" />
          </div>
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-[175px] shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-muted-foreground">Pipeline introuvable</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/crm/pipeline')}>Retour</Button>
      </div>
    );
  }

  const resetFilters = () => setActiveFilters({});
  const activeCount = Object.keys(activeFilters).length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pipelines</h1>

        <div className="flex items-center gap-2 relative" ref={filterRef}>
          {/* Filtre button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilter((v) => !v)}
          >
            {activeCount > 0 && (
              <span className="mr-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {activeCount}
              </span>
            )}
            Filtre
          </Button>

          {/* Éditer le pipeline */}
          <Button size="sm" onClick={() => setShowEdit(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Éditer le pipeline
          </Button>

          {/* Filter popover */}
          {showFilter && (
            <div className="absolute top-10 right-0 z-50 w-[280px] rounded-xl border bg-background shadow-xl">
              <div className="px-4 pt-3 pb-2 border-b">
                <h3 className="text-sm font-semibold">Filtrer par</h3>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {FILTER_FIELDS.map((field) => {
                  const entry = activeFilters[field];
                  const isActive = !!entry;
                  return (
                    <div key={field}>
                      {/* Field row: label left, checkbox right */}
                      <div className="flex items-center justify-between px-4 py-2 hover:bg-muted/30">
                        <span className="text-xs text-muted-foreground">{field}</span>
                        <Checkbox
                          checked={isActive}
                          onCheckedChange={(v) => toggleField(field, !!v)}
                        />
                      </div>

                      {/* Active: conditions */}
                      {isActive && (
                        <div className="px-4 pb-2 space-y-2">
                          {entry.conditions.map((cond, i) => (
                            <div key={i} className="space-y-1">
                              {/* Operator + X */}
                              <div className="flex items-center gap-1.5">
                                <Select
                                  value={cond.operator}
                                  onValueChange={(v) => updateCondition(field, i, 'operator', v)}
                                >
                                  <SelectTrigger className="h-7 flex-1 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TEXT_OPS.map((op) => (
                                      <SelectItem key={op.value} value={op.value} className="text-xs">
                                        {op.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <button
                                  onClick={() => removeCondition(field, i)}
                                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {/* Value + X */}
                              <div className="flex items-center gap-1.5">
                                <Input
                                  className="h-7 flex-1 text-xs"
                                  placeholder="Entrez la valeur de recherche"
                                  value={cond.value}
                                  onChange={(e) => updateCondition(field, i, 'value', e.target.value)}
                                />
                                <button
                                  onClick={() => updateCondition(field, i, 'value', '')}
                                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}

                          {/* Add condition */}
                          <button
                            onClick={() => addCondition(field)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline pt-0.5"
                          >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Plus className="h-2.5 w-2.5" />
                            </span>
                            Ajouter une condition
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="px-4 py-3 border-t">
                <Button size="sm" className="w-full" onClick={resetFilters}>
                  Réinitialiser
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Kanban board ── */}
      <div
        className="-mx-5 -mb-4 lg:-mx-8 bg-slate-50 dark:bg-muted/20 flex gap-3 overflow-x-auto px-5 lg:px-8 pb-8 pt-4"
        style={{ minHeight: 'calc(100vh - 120px)' }}
      >
        {(pipeline.stages ?? []).map((stage: Stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            pipelineId={pipeline.id}
          />
        ))}
      </div>

      {showEdit && (
        <EditPipelineModal
          open={showEdit}
          onOpenChange={setShowEdit}
          pipeline={pipeline}
        />
      )}
    </div>
  );
}
