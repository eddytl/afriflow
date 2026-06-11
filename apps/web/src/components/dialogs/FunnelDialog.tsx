import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { funnelsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface FunnelDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const TEMPLATES = [
  { id: 'blank', label: 'Page blanche', desc: 'Partir de zéro' },
  { id: 'optin', label: 'Capture de leads', desc: 'Page opt-in + confirmation' },
  { id: 'sales', label: 'Page de vente', desc: 'VSL + formulaire de commande' },
  { id: 'webinar', label: 'Webinaire', desc: 'Inscription + replay' },
];

export function FunnelDialog({ open, onOpenChange }: FunnelDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('blank');

  const mutation = useMutation({
    mutationFn: () => funnelsApi.create({ name, description, template }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funnels'] });
      toast({ variant: 'success', title: 'Tunnel créé', description: name });
      onOpenChange(false);
      setName('');
      setDescription('');
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le tunnel' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau tunnel de vente</DialogTitle>
          <DialogDescription>Choisissez un modèle et donnez un nom à votre tunnel</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom du tunnel <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: Funnel Formation Marketing" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optionnel)</Label>
            <Textarea placeholder="Décrivez l'objectif de ce tunnel…" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Modèle de départ</Label>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${template === t.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                >
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer le tunnel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
