import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { crmApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { DealDialog } from '@/components/dialogs/DealDialog';

interface Deal {
  id: string;
  name: string;
  value: number;
  contact_name: string;
  probability?: number;
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

function DealCard({ deal }: { deal: Deal }) {
  return (
    <Card className="cursor-grab active:cursor-grabbing">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{deal.name}</p>
            <p className="truncate text-xs text-muted-foreground">{deal.contact_name}</p>
          </div>
          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 mt-0.5" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-semibold">{formatCurrency(deal.value)}</span>
          {deal.probability !== undefined && (
            <Badge variant="outline" className="text-xs">{deal.probability}%</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StageColumn({ stage, pipelineId, stages }: { stage: Stage; pipelineId: string; stages: Stage[] }) {
  const [showAddDeal, setShowAddDeal] = useState(false);

  return (
    <div className="flex min-w-[240px] max-w-[240px] flex-col gap-2">
      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color ?? '#6366f1' }} />
          <span className="text-sm font-medium">{stage.name}</span>
          <Badge variant="secondary" className="text-xs">{stage.deal_count}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatCurrency(Number(stage.total_value))}</span>
      </div>
      <div className="flex flex-col gap-2 min-h-[100px] rounded-md p-1">
        {(stage.deals ?? []).map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
        <Button
          variant="ghost" size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => setShowAddDeal(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />Ajouter un deal
        </Button>
      </div>
      <DealDialog
        open={showAddDeal}
        onOpenChange={setShowAddDeal}
        pipelineId={pipelineId}
        stages={stages}
      />
    </div>
  );
}

export function PipelinePage() {
  const { data, isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: crmApi.pipelines });
  const [showDeal, setShowDeal] = useState(false);
  const pipelines: Pipeline[] = data ?? [];
  const pipeline = pipelines[0];

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-[240px]">
            <Skeleton className="h-10 w-full rounded-md mb-2" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-20 w-full rounded-md" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Aucun pipeline configuré</p>
        <Button size="sm" onClick={() => crmApi.createPipeline({ name: 'Mon pipeline' })}>
          <Plus className="mr-2 h-4 w-4" />Créer un pipeline
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{pipeline.name}</h2>
        <Button size="sm" variant="outline" onClick={() => setShowDeal(true)}>
          <Plus className="mr-2 h-4 w-4" />Nouveau deal
        </Button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {pipeline.stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            pipelineId={pipeline.id}
            stages={pipeline.stages}
          />
        ))}
        <div className="flex min-w-[240px] items-start pt-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Plus className="mr-1 h-4 w-4" />Nouvelle étape
          </Button>
        </div>
      </div>
      <DealDialog
        open={showDeal}
        onOpenChange={setShowDeal}
        pipelineId={pipeline.id}
        stages={pipeline.stages}
      />
    </div>
  );
}
