import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, Video, Phone, MapPin, Pencil, Trash2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface CalendarEvent {
  id: string;
  name: string;
  slug: string;
  type: 'individual' | 'group';
  duration_minutes: number;
  location_type: 'video' | 'phone' | 'in_person';
  is_active: boolean;
  booking_count: number;
  created_at: string;
}

const LOCATION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  video:     { label: 'Réunion vidéo', icon: Video },
  phone:     { label: 'Appel',          icon: Phone },
  in_person: { label: 'Face à face',    icon: MapPin },
};

function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events'],
    queryFn: () => api.get('/crm/calendar/events').then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/crm/calendar/events/${id}/toggle`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ variant: 'success', title: 'Statut mis à jour' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de changer le statut' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/calendar/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ variant: 'success', title: 'Événement supprimé' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de supprimer l\'événement' }),
  });

  const columns: ColumnDef<CalendarEvent>[] = [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">/{row.slug}</p>
        </div>
      ),
    },
    {
      key: 'duration_minutes',
      label: 'Durée',
      sortable: true,
      render: (row) => (
        <span className="text-sm">{formatDuration(Number(row.duration_minutes))}</span>
      ),
    },
    {
      key: 'location_type',
      label: 'Lieu',
      render: (row) => {
        const loc = LOCATION_LABELS[row.location_type] ?? LOCATION_LABELS.video;
        const Icon = loc.icon;
        return (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {loc.label}
          </div>
        );
      },
    },
    {
      key: 'booking_count',
      label: 'Réservations',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right text-muted-foreground',
      render: (row) => Number(row.booking_count).toLocaleString('fr-FR'),
    },
    {
      key: 'is_active',
      label: 'Statut',
      render: (row) => (
        <Badge variant={row.is_active ? 'default' : 'secondary'}>
          {row.is_active ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      title="Calendrier"
      subtitle={`${events.length} événement${events.length !== 1 ? 's' : ''}`}
      headerAction={
        <Button size="sm" onClick={() => navigate('/crm/calendar/new')}>
          <Plus className="mr-2 h-4 w-4" />Créer un événement
        </Button>
      }
      data={events}
      columns={columns}
      isLoading={isLoading}
      searchPlaceholder="Filtrer par nom..."
      searchKeys={['name', 'slug']}
      emptyIcon={<Calendar className="h-10 w-10" />}
      emptyTitle="Aucun événement créé"
      emptyAction={
        <Button size="sm" onClick={() => navigate('/crm/calendar/new')}>
          <Plus className="mr-2 h-4 w-4" />Créer un événement
        </Button>
      }
      bulkActions={[
        {
          icon: <Trash2 className="h-4 w-4" />,
          label: 'Supprimer',
          variant: 'destructive',
          onClick: (ids) => ids.forEach((id) => remove.mutate(id)),
        },
      ]}
      rowActions={(row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={row.is_active ? 'Désactiver' : 'Activer'}
            onClick={() => toggle.mutate(row.id)}
          >
            <Power className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Modifier"
            onClick={() => navigate(`/crm/calendar/${row.id}/edit`)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
            title="Supprimer"
            onClick={() => remove.mutate(row.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    />
  );
}
