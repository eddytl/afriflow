import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { automationsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface AutomationDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const TRIGGERS = [
  { value: 'contact_created', label: 'Nouveau contact créé' },
  { value: 'form_submitted', label: 'Formulaire soumis' },
  { value: 'tag_added', label: 'Tag ajouté à un contact' },
  { value: 'purchase_made', label: 'Achat effectué' },
  { value: 'email_opened', label: 'Email ouvert' },
  { value: 'link_clicked', label: 'Lien cliqué' },
];

const ACTION_TYPES = [
  { value: 'send_email', label: 'Envoyer un email' },
  { value: 'send_sms', label: 'Envoyer un SMS' },
  { value: 'add_tag', label: 'Ajouter un tag' },
  { value: 'remove_tag', label: 'Retirer un tag' },
  { value: 'wait', label: 'Attendre' },
  { value: 'update_contact', label: 'Mettre à jour le contact' },
  { value: 'webhook', label: 'Appeler un webhook' },
];

interface Step {
  id: string;
  type: string;
  label: string;
  config: string;
}

export function AutomationDialog({ open, onOpenChange }: AutomationDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('contact_created');
  const [steps, setSteps] = useState<Step[]>([]);

  const addStep = () => {
    setSteps((prev) => [...prev, { id: Date.now().toString(), type: 'send_email', label: '', config: '' }]);
  };

  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id));

  const updateStep = (id: string, field: keyof Step, value: string) =>
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));

  const mutation = useMutation({
    mutationFn: () => automationsApi.create({ name, trigger_type: trigger, steps }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast({ variant: 'success', title: 'Automation créée', description: name });
      onOpenChange(false);
      setName(''); setTrigger('contact_created'); setSteps([]);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer l\'automation' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle automation</DialogTitle>
          <DialogDescription>Définissez le déclencheur et les actions</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom de l'automation <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: Bienvenue nouveaux contacts" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <Label>Déclencheur</Label>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">QUAND</p>
              <Select value={trigger} onValueChange={setTrigger}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <Label>Actions ({steps.length})</Label>
            {steps.map((step, idx) => (
              <div key={step.id} className="relative rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">ÉTAPE {idx + 1}</span>
                  <button type="button" onClick={() => removeStep(step.id)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Select value={step.type} onValueChange={(v) => updateStep(step.id, 'type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {step.type === 'wait' ? (
                  <Input placeholder="ex: 2 jours" value={step.config} onChange={(e) => updateStep(step.id, 'config', e.target.value)} />
                ) : step.type === 'webhook' ? (
                  <Input placeholder="https://..." value={step.config} onChange={(e) => updateStep(step.id, 'config', e.target.value)} />
                ) : (
                  <Input placeholder={step.type === 'add_tag' || step.type === 'remove_tag' ? 'Nom du tag' : 'Détails…'} value={step.config} onChange={(e) => updateStep(step.id, 'config', e.target.value)} />
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addStep} className="w-full">
              <Plus className="mr-2 h-4 w-4" />Ajouter une action
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
