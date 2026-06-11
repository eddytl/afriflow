import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useTheme } from '@/hooks/use-theme';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Tableau de bord',
  '/contacts': 'Contacts',
  '/funnels': 'Tunnels de vente',
  '/emails/campaigns': 'Campagnes email',
  '/emails/newsletters': 'Newsletters',
  '/emails/statistics': 'Statistiques email',
  '/sms': 'SMS',
  '/automations': 'Automations',
  '/crm/pipeline': 'Pipeline CRM',
  '/crm/calendar': 'Calendrier',
  '/sales/products': 'Produits',
  '/sales/orders': 'Commandes',
  '/sales/subscriptions': 'Abonnements',
  '/sales/coupons': 'Coupons',
  '/analytics': 'Analytics',
  '/ai': 'IA Assistant',
  '/settings/profile': 'Mon profil',
  '/settings/workspace': 'Workspace',
  '/settings/api-keys': 'Clés API',
  '/settings/webhooks': 'Webhooks',
  '/settings/integrations': 'Intégrations',
  '/settings/security': 'Sécurité',
};

function getTitle(pathname: string) {
  return PAGE_TITLES[pathname] ?? PAGE_TITLES[pathname.replace(/\/$/, '')] ?? 'AfriFlow';
}

export function AppLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Initialize theme on mount
  useTheme();

  const title = getTitle(location.pathname);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar as sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header title={title} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
