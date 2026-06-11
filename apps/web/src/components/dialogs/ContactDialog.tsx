import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { contactsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: {
    id: string; first_name: string; last_name: string;
    email: string; phone?: string; country?: string;
  } | null;
}

const COUNTRIES = ['Cameroun', 'Sénégal', 'Côte d\'Ivoire', 'Mali', 'Burkina Faso', 'Niger',
  'Togo', 'Bénin', 'Gabon', 'Congo', 'RDC', 'Madagascar', 'Maroc', 'Tunisie', 'Algérie'];

export function ContactDialog({ open, onOpenChange, contact }: ContactDialogProps) {
  const qc = useQueryClient();
  const isEdit = !!contact;

  const [form, setForm] = useState({
    first_name: contact?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    country: contact?.country ?? '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      isEdit ? contactsApi.update(contact!.id, form) : contactsApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast({ variant: 'success', title: isEdit ? 'Contact modifié' : 'Contact créé', description: `${form.first_name} ${form.last_name}` });
      onOpenChange(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de sauvegarder le contact' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le contact' : 'Nouveau contact'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prénom</Label>
              <Input placeholder="Jean" value={form.first_name} onChange={set('first_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Nom</Label>
              <Input placeholder="Dupont" value={form.last_name} onChange={set('last_name')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email <span className="text-destructive">*</span></Label>
            <Input type="email" placeholder="jean@exemple.com" value={form.email} onChange={set('email')} required />
          </div>
          <div className="space-y-1.5">
            <Label>Téléphone</Label>
            <Input type="tel" placeholder="+237 6XX XXX XXX" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="space-y-1.5">
            <Label>Pays</Label>
            <Select value={form.country} onValueChange={(v) => setForm((p) => ({ ...p, country: v }))}>
              <SelectTrigger><SelectValue placeholder="Sélectionner un pays" /></SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.email || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
