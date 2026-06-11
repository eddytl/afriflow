import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, GripVertical, GitBranch, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { crmApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Pipeline {
  id: string;
  name: string;
  created_at: string;
  stages: { id: string; name: string; deal_count: number }[];
}

interface StageRow {
  id: string;       // temp local id for key
  name: string;
}

const DEFAULT_STAGES: StageRow[] = [
  { id: '1', name: 'Premier contact établi' },
  { id: '2', name: 'Proposition envoyée' },
  { id: '3', name: 'Négociation' },
  { id: '4', name: 'Deal gagné' },
  { id: '5', name: 'Deal perdu' },
];

let stageCounter = 10;

function CreatePipelineModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [stages, setStages] = useState<StageRow[]>(DEFAULT_STAGES.map((s) => ({ ...s })));
  const dragIdx = useRef<number | null>(null);
  const overIdx  = useRef<number | null>(null);

  const createPipeline = useMutation({
    mutationFn: () => crmApi.createPipeline({
      name: name.trim(),
      stages: stages.map((s, i) => ({ name: s.name, position: i })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      toast({ variant: 'success', title: 'Pipeline créé' });
      onOpenChange(false);
      setName('');
      setStages(DEFAULT_STAGES.map((s) => ({ ...s })));
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le pipeline' }),
  });

  const addStage = () => {
    setStages((prev) => [...prev, { id: String(++stageCounter), name: '' }]);
  };

  const removeStage = (id: string) => setStages((prev) => prev.filter((s) => s.id !== id));

  const updateStage = (id: string, val: string) =>
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name: val } : s)));

  /* ── Drag-and-drop HTML5 ── */
  const onDragStart = (i: number) => { dragIdx.current = i; };
  const onDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    overIdx.current = i;
    if (dragIdx.current === null || dragIdx.current === i) return;
    setStages((prev) => {
      const next = [...prev];
      const [item] = next.splice(dragIdx.current!, 1);
      next.splice(i, 0, item);
      dragIdx.current = i;
      return next;
    });
  };
  const onDragEnd = () => { dragIdx.current = null; overIdx.current = null; };

  const canSave = name.trim() && stages.every((s) => s.name.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Créez votre pipeline</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {/* Pipeline name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nom du pipeline</label>
            <Input
              placeholder="Nom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Stages */}
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
                  className="flex items-center gap-2 cursor-default"
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
                  <Input
                    className="flex-1 h-9"
                    placeholder="Nom de l'étape"
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

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            disabled={!canSave || createPipeline.isPending}
            onClick={() => createPipeline.mutate()}
          >
            Sauvegarder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PipelinePage() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: crmApi.pipelines });
  const pipelines: Pipeline[] = data ?? [];

  const deletePipeline = useMutation({
    mutationFn: (id: string) => crmApi.deletePipeline(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      toast({ variant: 'success', title: 'Pipeline supprimé' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur lors de la suppression' }),
  });

  const columns: ColumnDef<Pipeline>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => (
        <span
          className="font-medium text-primary hover:underline cursor-pointer"
          onClick={() => navigate(`/crm/pipeline/${row.id}`)}
        >
          {row.name}
        </span>
      ),
    },
    {
      key: 'stages',
      label: 'Étapes',
      sortable: false,
      className: 'text-muted-foreground',
      render: (row) => {
        const n = row.stages?.length ?? 0;
        return `${n} étape${n !== 1 ? 's' : ''}`;
      },
    },
    {
      key: 'created_at',
      label: 'Date de création',
      sortable: true,
      className: 'text-muted-foreground',
      render: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <>
      <DataTable
        title="Pipelines"
        subtitle={`${pipelines.length} pipeline${pipelines.length !== 1 ? 's' : ''}`}
        headerAction={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Créer
          </Button>
        }
        data={pipelines}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Rechercher un pipeline…"
        searchKeys={['name']}
        emptyIcon={<GitBranch className="h-10 w-10" />}
        emptyTitle="Aucun pipeline créé"
        emptyAction={
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Créer le premier pipeline
          </Button>
        }
        bulkActions={[
          {
            icon: <Trash2 className="h-4 w-4" />,
            label: 'Supprimer',
            variant: 'destructive',
            onClick: (ids) => ids.forEach((id) => deletePipeline.mutate(id)),
          },
        ]}
        rowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => navigate(`/crm/pipeline/${row.id}`)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => deletePipeline.mutate(row.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      />

      <CreatePipelineModal open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
