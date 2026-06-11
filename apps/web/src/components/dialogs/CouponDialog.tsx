import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { salesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface CouponDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CouponDialog({ open, onOpenChange }: CouponDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', code: '', discount_type: 'percentage', discount_value: '',
    max_uses: '', expires_at: '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setForm((p) => ({ ...p, code }));
  };

  const mutation = useMutation({
    mutationFn: () => salesApi.createCoupon({
      name: form.name,
      code: form.code.toUpperCase(),
      discountType: form.discount_type as 'percentage' | 'fixed',
      discountAmount: Number(form.discount_value),
      ...(form.max_uses ? { maxUses: Number(form.max_uses) } : {}),
      ...(form.expires_at ? { expiresAt: new Date(form.expires_at).toISOString() } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coupons'] });
      toast({ variant: 'success', title: 'Coupon créé', description: form.code.toUpperCase() });
      setForm({ name: '', code: '', discount_type: 'percentage', discount_value: '', max_uses: '', expires_at: '' });
      onOpenChange(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de créer le coupon' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau coupon de réduction</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom du coupon <span className="text-destructive">*</span></Label>
            <Input placeholder="Promo été 2026" value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Code promo <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input placeholder="PROMO20" value={form.code} onChange={set('code')} className="uppercase" />
              <Button type="button" variant="outline" size="sm" onClick={generateCode}>Générer</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type de réduction</Label>
              <Select value={form.discount_type} onValueChange={(v) => setForm((p) => ({ ...p, discount_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Pourcentage (%)</SelectItem>
                  <SelectItem value="fixed">Montant fixe</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valeur <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                placeholder={form.discount_type === 'percentage' ? '20' : '5000'}
                value={form.discount_value}
                onChange={set('discount_value')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Utilisations max</Label>
              <Input type="number" placeholder="Illimité" value={form.max_uses} onChange={set('max_uses')} />
            </div>
            <div className="space-y-1.5">
              <Label>Date d'expiration</Label>
              <Input type="date" value={form.expires_at} onChange={set('expires_at')} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.code || !form.discount_value || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer le coupon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
