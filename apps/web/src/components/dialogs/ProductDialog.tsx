import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { salesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ProductDialog({ open, onOpenChange }: ProductDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', description: '', price: '', type: 'one_time', currency: 'XOF',
    billing_interval: 'monthly', active: true,
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () => salesApi.createProduct({
      ...form,
      price: parseFloat(form.price) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast({ variant: 'success', title: 'Produit créé', description: form.name });
      onOpenChange(false);
      setForm({ name: '', description: '', price: '', type: 'one_time', currency: 'XOF', billing_interval: 'monthly', active: true });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le produit' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau produit</DialogTitle>
          <DialogDescription>Créez un produit ou service à vendre</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom du produit <span className="text-destructive">*</span></Label>
            <Input placeholder="ex: Formation Marketing Digital" value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="Décrivez votre produit…" rows={2} value={form.description} onChange={set('description')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type <span className="text-destructive">*</span></Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">Paiement unique</SelectItem>
                  <SelectItem value="subscription">Abonnement</SelectItem>
                  <SelectItem value="payment_plan">Plan de paiement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Devise</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((p) => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="XOF">XOF (FCFA)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="MAD">MAD (DH)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prix <span className="text-destructive">*</span></Label>
              <Input type="number" placeholder="25000" value={form.price} onChange={set('price')} />
            </div>
            {form.type === 'subscription' && (
              <div className="space-y-1.5">
                <Label>Fréquence</Label>
                <Select value={form.billing_interval} onValueChange={(v) => setForm((p) => ({ ...p, billing_interval: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensuel</SelectItem>
                    <SelectItem value="yearly">Annuel</SelectItem>
                    <SelectItem value="weekly">Hebdomadaire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="active-switch">Produit actif</Label>
            <Switch
              id="active-switch"
              checked={form.active}
              onCheckedChange={(v) => setForm((p) => ({ ...p, active: v }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name || !form.price || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer le produit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
