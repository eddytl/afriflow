import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { crmApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface Stage { id: string; name: string }
interface DealDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineId: string;
  stages: Stage[];
}

export function DealDialog({ open, onOpenChange, pipelineId, stages }: DealDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', contact_name: '', contact_email: '',
    value: '', stage_id: stages[0]?.id ?? '', probability: '50', notes: '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => crmApi.createDeal(pipelineId, {
      ...form,
      value: parseFloat(form.value) || 0,
      probability: parseInt(form.probability),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      toast({ variant: 'success', title: 'Deal créé', description: form.name });
      onOpenChange(false);
      setForm({ name: '', contact_name: '', contact_email: '', value: '', stage_id: stages[0]?.id ?? '', probability: '50', notes: '' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le deal' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Nom du deal <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: Contrat formation entreprise" value={form.name} onChange={set('name')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nom du contact</Label>
              <Input placeholder="Jean Dupont" value={form.contact_name} onChange={set('contact_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Email du contact</Label>
              <Input type="email" placeholder="jean@exemple.com" value={form.contact_email} onChange={set('contact_email')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Valeur (XOF)</Label>
              <Input type="number" placeholder="150000" value={form.value} onChange={set('value')} />
            </div>
            <div className="space-y-1.5">
              <Label>Probabilité (%)</Label>
              <Input type="number" min="0" max="100" value={form.probability} onChange={set('probability')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Étape</Label>
            <Select value={form.stage_id} onValueChange={(v) => setForm((p) => ({ ...p, stage_id: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea placeholder="Notes sur ce deal…" rows={2} value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
