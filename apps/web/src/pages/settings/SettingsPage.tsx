import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User, Building2, KeyRound, Webhook, Puzzle, ShieldCheck, Copy, Plus, Trash2, ExternalLink, Check } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

const TABS = [
  { id: 'profile', label: 'Profil', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'api-keys', label: 'Clés API', icon: KeyRound },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'integrations', label: 'Intégrations', icon: Puzzle },
  { id: 'security', label: 'Sécurité', icon: ShieldCheck },
];

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations personnelles</CardTitle>
        <CardDescription>Mettez à jour vos informations de profil</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-1.5"><Label>Nom complet</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <Button onClick={() => toast({ variant: 'success', title: 'Profil enregistré' })}>Enregistrer</Button>
      </CardContent>
    </Card>
  );
}

function WorkspaceTab() {
  const user = useAuthStore((s) => s.user);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paramètres du workspace</CardTitle>
        <CardDescription>Configurez votre espace de travail</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-1.5"><Label>Nom du workspace</Label><Input defaultValue={user?.workspaceName} /></div>
        <div className="space-y-1.5"><Label>Identifiant (slug)</Label><Input defaultValue={user?.workspaceSlug} /></div>
        <Button onClick={() => toast({ variant: 'success', title: 'Workspace enregistré' })}>Enregistrer</Button>
      </CardContent>
    </Card>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost" size="icon" className="h-7 w-7"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ApiKeysTab() {
  const { data, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: settingsApi.apiKeys });
  const keys = isLoading ? [] : (data ?? []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Clés API</CardTitle>
            <CardDescription>Accédez à l'API AfriFlow depuis vos applications</CardDescription>
          </div>
          <Button size="sm" onClick={() => toast({ title: 'Bientôt disponible', description: 'Création de clé API' })}>
            <Plus className="mr-2 h-4 w-4" />Créer une clé
          </Button>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune clé API pour le moment</p>
          ) : (
            <div className="space-y-3">
              {keys.map((k: { id: string; name: string; prefix: string; created_at: string; last_used_at?: string }) => (
                <div key={k.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{k.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs text-muted-foreground">{k.prefix}••••••••••••</code>
                      <CopyButton value={k.prefix} />
                    </div>
                    <p className="text-xs text-muted-foreground">Créée le {formatDate(k.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {k.last_used_at && <Badge variant="outline" className="text-xs">Utilisée</Badge>}
                    <Button variant="destructive" size="sm">Révoquer</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WebhooksTab() {
  const { data } = useQuery({ queryKey: ['webhooks'], queryFn: settingsApi.webhooks });
  const webhooks = data ?? [];

  const EVENTS = ['contact.created', 'contact.updated', 'form.submitted', 'order.paid', 'subscription.created'];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Webhooks</CardTitle>
            <CardDescription>Recevez des notifications en temps réel sur vos endpoints</CardDescription>
          </div>
          <Button size="sm"><Plus className="mr-2 h-4 w-4" />Nouveau webhook</Button>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Aucun webhook configuré</p>
              <div className="rounded-md bg-muted/50 p-4">
                <p className="text-sm font-medium mb-2">Événements disponibles :</p>
                <div className="flex flex-wrap gap-1.5">
                  {EVENTS.map((e) => (
                    <code key={e} className="rounded bg-background border px-2 py-0.5 text-xs">{e}</code>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((w: { id: string; url: string; events: string[]; active: boolean; last_triggered_at?: string }) => (
                <div key={w.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm truncate">{w.url}</code>
                        <Badge variant={w.active ? 'success' : 'secondary'}>{w.active ? 'Actif' : 'Inactif'}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {w.events.map((e) => <code key={e} className="text-xs text-muted-foreground">{e}</code>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={w.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface Integration {
  id: string;
  name: string;
  desc: string;
  logo: string;
  category: string;
  connected: boolean;
}

const INTEGRATIONS: Integration[] = [
  { id: 'stripe', name: 'Stripe', desc: 'Paiements en ligne', logo: '💳', category: 'Paiement', connected: false },
  { id: 'paypal', name: 'PayPal', desc: 'Paiements internationaux', logo: '🅿', category: 'Paiement', connected: false },
  { id: 'cinetpay', name: 'CinetPay', desc: 'Mobile Money Afrique', logo: '📱', category: 'Paiement', connected: false },
  { id: 'orange-money', name: 'Orange Money', desc: 'Paiement mobile Orange', logo: '🟠', category: 'Paiement', connected: false },
  { id: 'twilio', name: 'Twilio', desc: 'SMS & communications', logo: '📞', category: 'SMS', connected: false },
  { id: 'whatsapp', name: 'WhatsApp Business', desc: 'Messages WhatsApp', logo: '💬', category: 'Messagerie', connected: false },
  { id: 'zapier', name: 'Zapier', desc: 'Automatisations externes', logo: '⚡', category: 'Automation', connected: false },
  { id: 'google-analytics', name: 'Google Analytics', desc: 'Analyse de trafic', logo: '📊', category: 'Analytics', connected: false },
  { id: 'facebook-pixel', name: 'Facebook Pixel', desc: 'Tracking conversions Meta', logo: '📘', category: 'Marketing', connected: false },
  { id: 'wordpress', name: 'WordPress', desc: 'Plugin WordPress', logo: '🔵', category: 'CMS', connected: false },
];

const CATEGORIES = [...new Set(INTEGRATIONS.map((i) => i.category))];

function IntegrationsTab() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());

  const filtered = activeCategory ? INTEGRATIONS.filter((i) => i.category === activeCategory) : INTEGRATIONS;

  return (
    <div className="space-y-4">
      {/* Categories */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeCategory === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveCategory(null)}
        >
          Tout
        </Button>
        {CATEGORIES.map((cat) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </Button>
        ))}
      </div>

      {/* Integrations grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((integ) => (
          <Card key={integ.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{integ.logo}</span>
                  <div>
                    <p className="text-sm font-semibold">{integ.name}</p>
                    <p className="text-xs text-muted-foreground">{integ.desc}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">{integ.category}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className={`text-xs ${connected.has(integ.id) ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}`}>
                  {connected.has(integ.id) ? '✓ Connecté' : 'Non connecté'}
                </span>
                <Button
                  variant={connected.has(integ.id) ? 'outline' : 'default'}
                  size="sm"
                  onClick={() => {
                    setConnected((prev) => {
                      const next = new Set(prev);
                      if (next.has(integ.id)) next.delete(integ.id);
                      else next.add(integ.id);
                      return next;
                    });
                    toast({ variant: 'success', title: connected.has(integ.id) ? `${integ.name} déconnecté` : `${integ.name} connecté` });
                  }}
                >
                  {connected.has(integ.id) ? 'Déconnecter' : 'Connecter'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Changer de mot de passe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-1.5"><Label>Mot de passe actuel</Label><Input type="password" /></div>
          <div className="space-y-1.5"><Label>Nouveau mot de passe</Label><Input type="password" /></div>
          <div className="space-y-1.5"><Label>Confirmer le mot de passe</Label><Input type="password" /></div>
          <Button onClick={() => toast({ variant: 'success', title: 'Mot de passe modifié' })}>Changer le mot de passe</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Authentification à deux facteurs</CardTitle>
          <CardDescription>Renforcez la sécurité avec une application TOTP (Google Authenticator, Authy…)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Application d'authentification</p>
              <p className="text-xs text-muted-foreground">Utilisez une application TOTP</p>
            </div>
            <Switch onCheckedChange={(v) => toast({ title: v ? '2FA activée' : '2FA désactivée' })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Codes de secours</p>
              <p className="text-xs text-muted-foreground">Génération de codes de récupération</p>
            </div>
            <Button variant="outline" size="sm">Générer</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sessions actives</CardTitle>
          <CardDescription>Gérez vos sessions de connexion actives</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Session actuelle</p>
              <p className="text-xs text-muted-foreground">Chrome — Abidjan, CI · Maintenant</p>
            </div>
            <Badge variant="success">Actuelle</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TAB_CONTENT: Record<string, React.ComponentType> = {
  profile: ProfileTab,
  workspace: WorkspaceTab,
  'api-keys': ApiKeysTab,
  webhooks: WebhooksTab,
  integrations: IntegrationsTab,
  security: SecurityTab,
};

export function SettingsPage() {
  const navigate = useNavigate();
  const { section = 'profile' } = useParams<{ section: string }>();
  const ActiveTab = TAB_CONTENT[section] ?? ProfileTab;

  return (
    <div className="flex gap-6">
      <nav className="w-48 shrink-0">
        <ul className="space-y-1">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button
                onClick={() => navigate(`/settings/${tab.id}`)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  section === tab.id
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground',
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <Separator orientation="vertical" className="h-auto" />
      <div className="flex-1 min-w-0">
        <ActiveTab />
      </div>
    </div>
  );
}
