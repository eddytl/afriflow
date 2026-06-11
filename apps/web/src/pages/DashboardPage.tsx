import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Users, Mail, Zap, ShoppingBag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { analyticsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}

function MetricCard({ title, value, change, icon: Icon, loading }: MetricCardProps) {
  const positive = (change ?? 0) >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {change !== undefined && (
              <p className={`flex items-center gap-1 text-xs mt-1 ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
                {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {positive ? '+' : ''}{change.toFixed(1)}% vs mois précédent
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => analyticsApi.dashboard(),
  });

  const contacts = data?.contacts;
  const emails = data?.emails;
  const revenue = data?.revenue;
  const automations = data?.automations;

  const contactsChange = contacts?.total && contacts?.prevTotal
    ? ((contacts.newCount - contacts.prevCount) / (contacts.prevCount || 1)) * 100
    : undefined;

  const emailsChange = emails?.openRate && emails?.prevOpenRate
    ? emails.openRate - emails.prevOpenRate
    : undefined;

  const weeklyData = data?.weekly ?? [
    { day: 'Lun', contacts: 12, emails: 340 },
    { day: 'Mar', contacts: 18, emails: 280 },
    { day: 'Mer', contacts: 8, emails: 410 },
    { day: 'Jeu', contacts: 22, emails: 390 },
    { day: 'Ven', contacts: 15, emails: 520 },
    { day: 'Sam', contacts: 5, emails: 190 },
    { day: 'Dim', contacts: 3, emails: 120 },
  ];

  const monthlyRevenue = data?.monthlyRevenue ?? [
    { month: 'Jan', value: 0 }, { month: 'Fév', value: 0 }, { month: 'Mar', value: 0 },
    { month: 'Avr', value: 0 }, { month: 'Mai', value: 0 }, { month: 'Juin', value: 0 },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total contacts"
          value={isLoading ? '—' : (contacts?.total ?? 0).toLocaleString('fr-FR')}
          change={contactsChange}
          icon={Users}
          loading={isLoading}
        />
        <MetricCard
          title="Emails envoyés"
          value={isLoading ? '—' : (emails?.sent ?? 0).toLocaleString('fr-FR')}
          change={emailsChange}
          icon={Mail}
          loading={isLoading}
        />
        <MetricCard
          title="Chiffre d'affaires"
          value={isLoading ? '—' : formatCurrency(revenue?.total ?? 0)}
          change={revenue?.change}
          icon={ShoppingBag}
          loading={isLoading}
        />
        <MetricCard
          title="Automations actives"
          value={isLoading ? '—' : String(automations?.active ?? 0)}
          icon={Zap}
          loading={isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activité hebdomadaire</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend iconType="circle" iconSize={8} />
                <Bar dataKey="contacts" name="Contacts" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="emails" name="Emails" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenus (6 mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyRevenue}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Revenus"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#revenueGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Taux d'ouverture email</div>
            <div className="mt-1 text-2xl font-bold">{isLoading ? '—' : `${(emails?.openRate ?? 0).toFixed(1)}%`}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Taux de clic</div>
            <div className="mt-1 text-2xl font-bold">{isLoading ? '—' : `${(emails?.clickRate ?? 0).toFixed(1)}%`}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Nouveaux contacts ce mois</div>
            <div className="mt-1 text-2xl font-bold">{isLoading ? '—' : (contacts?.newCount ?? 0).toLocaleString('fr-FR')}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
