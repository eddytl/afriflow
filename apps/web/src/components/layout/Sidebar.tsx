import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Filter,
  Mail,
  MessageSquare,
  Zap,
  BarChart2,
  ShoppingBag,
  Bot,
  Settings,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Calendar,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string }[];
}

const NAV: NavItem[] = [
  { label: 'Tableau de bord', href: '/', icon: LayoutDashboard },
  {
    label: 'CRM',
    icon: TrendingUp,
    children: [
      { label: 'Contacts', href: '/contacts' },
      { label: 'Tags', href: '/crm/tags' },
      { label: 'Pipelines', href: '/crm/pipeline' },
      { label: 'Calendrier', href: '/crm/calendar' },
    ],
  },
  {
    label: 'Sites',
    icon: Globe,
    children: [
      { label: 'Sites web', href: '/sites/websites' },
      { label: 'Tunnels de vente', href: '/funnels' },
      { label: 'Pages créateur', href: '/sites/creator-pages' },
      { label: 'Blogs', href: '/sites/blogs' },
    ],
  },
  {
    label: 'Emails',
    icon: Mail,
    children: [
      { label: 'Campagnes', href: '/emails/campaigns' },
      { label: 'Newsletters', href: '/emails/newsletters' },
      { label: 'Statistiques', href: '/emails/statistics' },
    ],
  },
  {
    label: 'SMS',
    icon: MessageSquare,
    children: [
      { label: 'Templates SMS', href: '/sms/templates' },
      { label: 'Statistiques', href: '/sms/statistics' },
    ],
  },
  {
    label: 'Automations',
    icon: Zap,
    children: [
      { label: 'Règles', href: '/automations/rules' },
      { label: 'Workflows', href: '/automations/workflows' },
    ],
  },
  {
    label: 'Ventes',
    icon: ShoppingBag,
    children: [
      { label: 'Produits', href: '/sales/products' },
      { label: 'Commandes', href: '/sales/orders' },
      { label: 'Abonnements', href: '/sales/subscriptions' },
      { label: 'Coupons', href: '/sales/coupons' },
    ],
  },
  { label: 'Analytics', href: '/analytics', icon: BarChart2 },
  { label: 'IA Assistant', href: '/ai', icon: Bot },
];

const BOTTOM_NAV: NavItem[] = [
  { label: 'Paramètres', href: '/settings', icon: Settings },
];

function NavGroup({ item }: { item: NavItem }) {
  const location = useLocation();
  const isActive = item.children?.some((c) => location.pathname.startsWith(c.href));
  const [open, setOpen] = useState(isActive ?? false);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="ml-7 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
          {item.children!.map((child) => (
            <NavLink
              key={child.href}
              to={child.href}
              className={({ isActive }) =>
                cn(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )
              }
            >
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({ item }: { item: NavItem }) {
  if (item.children) return <NavGroup item={item} />;
  return (
    <NavLink
      to={item.href!}
      end={item.href === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const initials = user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'AF';

  return (
    <aside className="flex h-full w-60 flex-col bg-sidebar-background border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border shrink-0">
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-xs font-bold">AF</span>
        </div>
        <span className="font-semibold text-sidebar-foreground">AfriFlow</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((item) => (
          <NavItem key={item.label} item={item} />
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-sidebar-border px-2 py-2 space-y-0.5">
        {BOTTOM_NAV.map((item) => (
          <NavItem key={item.label} item={item} />
        ))}
        {/* User */}
        <div className="flex items-center gap-2 rounded-md px-3 py-2 mt-1">
          <Avatar className="h-7 w-7">
            <AvatarImage src={user?.avatar} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name ?? 'Mon compte'}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.workspaceName}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
