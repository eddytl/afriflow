import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Package, ShoppingCart, RefreshCw, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { salesApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ProductDialog } from '@/components/dialogs/ProductDialog';
import { CouponDialog } from '@/components/dialogs/CouponDialog';

function ProductsTab() {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['products'], queryFn: salesApi.products });
  const products = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />Nouveau produit
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Prix</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              : products.length === 0
              ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-40 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Package className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-muted-foreground">Aucun produit pour le moment</p>
                      <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Créer un produit</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
              : products.map((p: { id: string; name: string; type: string; price: number; currency: string; status: string }) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.type === 'one_time' ? 'Paiement unique' : p.type === 'subscription' ? 'Abonnement' : p.type}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(p.price, p.currency ?? 'XOF')}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'active' ? 'success' : 'secondary'}>
                      {p.status === 'active' ? 'Actif' : 'Inactif'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>
      <ProductDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function OrdersTab() {
  const { data, isLoading } = useQuery({ queryKey: ['orders'], queryFn: salesApi.orders });
  const orders = data ?? [];
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Référence</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Produit</TableHead>
            <TableHead>Montant</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
              ))
            : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Aucune commande</TableCell>
                </TableRow>
              )
            : orders.map((o: { id: string; reference?: string; contact_name: string; product_name: string; amount: number; status: string; created_at: string }) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-sm">{o.reference ?? o.id.slice(0, 8).toUpperCase()}</TableCell>
                  <TableCell>{o.contact_name}</TableCell>
                  <TableCell>{o.product_name}</TableCell>
                  <TableCell>{formatCurrency(o.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'paid' ? 'success' : o.status === 'refunded' ? 'destructive' : 'secondary'}>
                      {o.status === 'paid' ? 'Payée' : o.status === 'refunded' ? 'Remboursée' : o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                </TableRow>
              ))
          }
        </TableBody>
      </Table>
    </Card>
  );
}

function SubscriptionsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['subscriptions'], queryFn: salesApi.subscriptions });
  const subs = data ?? [];
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Montant</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Prochain paiement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
              ))
            : subs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Aucun abonnement</TableCell>
                </TableRow>
              )
            : subs.map((s: { id: string; contact_name: string; plan_name: string; amount: number; interval: string; status: string; next_billing_date?: string }) => (
                <TableRow key={s.id}>
                  <TableCell>{s.contact_name}</TableCell>
                  <TableCell>{s.plan_name}</TableCell>
                  <TableCell>{formatCurrency(s.amount)}/{s.interval === 'monthly' ? 'mois' : 'an'}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === 'active' ? 'success' : 'secondary'}>
                      {s.status === 'active' ? 'Actif' : s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.next_billing_date ? formatDate(s.next_billing_date) : '—'}
                  </TableCell>
                </TableRow>
              ))
          }
        </TableBody>
      </Table>
    </Card>
  );
}

function CouponsTab() {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: salesApi.coupons });
  const coupons = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />Nouveau coupon
        </Button>
      </div>
      {isLoading ? (
        <Card><Table><TableBody>{Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>)}</TableBody></Table></Card>
      ) : coupons.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-lg border border-dashed">
          <Tag className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Aucun coupon de réduction</p>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Créer un coupon</Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Réduction</TableHead>
                <TableHead>Utilisations</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c: { id: string; code: string; discount_type: string; discount_value: number; uses_count: number; max_uses?: number; expires_at?: string; active: boolean }) => (
                <TableRow key={c.id}>
                  <TableCell><code className="text-sm font-mono font-medium">{c.code}</code></TableCell>
                  <TableCell>{c.discount_type === 'percent' ? `${c.discount_value}%` : formatCurrency(c.discount_value)}</TableCell>
                  <TableCell>{c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</TableCell>
                  <TableCell className="text-muted-foreground">{c.expires_at ? formatDate(c.expires_at) : 'Illimitée'}</TableCell>
                  <TableCell><Badge variant={c.active ? 'success' : 'secondary'}>{c.active ? 'Actif' : 'Inactif'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <CouponDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

export function SalesPage({ tab }: { tab?: string }) {
  const defaultTab = tab ?? 'products';
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="products"><Package className="mr-1.5 h-3.5 w-3.5" />Produits</TabsTrigger>
        <TabsTrigger value="orders"><ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Commandes</TabsTrigger>
        <TabsTrigger value="subscriptions"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Abonnements</TabsTrigger>
        <TabsTrigger value="coupons"><Tag className="mr-1.5 h-3.5 w-3.5" />Coupons</TabsTrigger>
      </TabsList>
      <TabsContent value="products" className="mt-4"><ProductsTab /></TabsContent>
      <TabsContent value="orders" className="mt-4"><OrdersTab /></TabsContent>
      <TabsContent value="subscriptions" className="mt-4"><SubscriptionsTab /></TabsContent>
      <TabsContent value="coupons" className="mt-4"><CouponsTab /></TabsContent>
    </Tabs>
  );
}
