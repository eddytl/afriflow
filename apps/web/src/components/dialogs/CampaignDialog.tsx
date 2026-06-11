import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { emailsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface CampaignDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CampaignDialog({ open, onOpenChange }: CampaignDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', subject: '', from_name: '', from_email: '', preview_text: '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => emailsApi.createCampaign(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast({ variant: 'success', title: 'Campagne créée', description: form.name });
      onOpenChange(false);
      setForm({ name: '', subject: '', from_name: '', from_email: '', preview_text: '' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer la campagne' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle campagne email</DialogTitle>
          <DialogDescription>Configurez les paramètres de votre campagne</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom de la campagne <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: Newsletter Juin 2026" value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Objet de l'email <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: 🚀 Découvrez nos nouveautés !" value={form.subject} onChange={set('subject')} />
          </div>
          <div className="space-y-1.5">
            <Label>Texte de prévisualisation</Label>
            <Input placeholder="Courte description visible dans la boîte mail…" value={form.preview_text} onChange={set('preview_text')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nom expéditeur <span className="text-destructive">*</span></Label>
              <Input placeholder="AfriFlow" value={form.from_name} onChange={set('from_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Email expéditeur <span className="text-destructive">*</span></Label>
              <Input type="email" placeholder="hello@afriflow.io" value={form.from_email} onChange={set('from_email')} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.subject || !form.from_name || !form.from_email || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer la campagne
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
