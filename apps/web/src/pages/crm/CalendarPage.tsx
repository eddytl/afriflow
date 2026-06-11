import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Filter, Video, Phone, MapPin, Pencil, Trash2, Power, Save, Search, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────

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

interface Booking {
  id: string;
  event_id: string;
  event_name: string;
  invitee_name: string;
  invitee_email: string;
  start_at: string;
  end_at: string;
  status: 'confirmed' | 'cancelled';
  timezone: string;
}

interface TimeSlot { startTime: string; endTime: string; }
interface DayAvail  { enabled: boolean; slots: TimeSlot[]; }

// ── Constants ────────────────────────────────────────────────

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const LOCATION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  video:     { label: 'Réunion vidéo', icon: Video },
  phone:     { label: 'Appel',          icon: Phone },
  in_person: { label: 'Face à face',    icon: MapPin },
};

// ── Helpers ──────────────────────────────────────────────────

function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function defaultWeekDays(): DayAvail[] {
  return Array.from({ length: 7 }, () => ({ enabled: false, slots: [] }));
}

// ── Tab: Evénements ──────────────────────────────────────────

function EventsTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

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
    onError: () => toast({ variant: 'destructive', title: 'Erreur' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/calendar/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ variant: 'success', title: 'Événement supprimé' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur' }),
  });

  const filtered = events.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {/* Sub-header */}
      <div className="flex items-center justify-between px-6 py-3 border-b">
        <h2 className="font-semibold">Evénements</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              className="h-8 pl-8 w-44 text-sm"
              placeholder="Recherche"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm">
            <Filter className="mr-1.5 h-3.5 w-3.5" />Filtres
          </Button>
          <Button size="sm" onClick={() => navigate('/crm/calendar/new')}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Créer un nouvel événement
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-16 text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucun événement créé</p>
            <Button size="sm" onClick={() => navigate('/crm/calendar/new')}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Créer un nouvel événement
            </Button>
          </div>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Nom</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Durée</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lieu</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Réservations</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Statut</th>
                  <th className="px-4 py-2.5 w-28" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((event) => {
                  const loc   = LOCATION_LABELS[event.location_type] ?? LOCATION_LABELS.video;
                  const Icon  = loc.icon;
                  return (
                    <tr key={event.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium">{event.name}</p>
                        <p className="text-xs text-muted-foreground">/{event.slug}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDuration(Number(event.duration_minutes))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className="h-3.5 w-3.5" />
                          {loc.label}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {Number(event.booking_count).toLocaleString('fr-FR')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={event.is_active ? 'default' : 'secondary'}>
                          {event.is_active ? 'Actif' : 'Inactif'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title={event.is_active ? 'Désactiver' : 'Activer'}
                            onClick={() => toggle.mutate(event.id)}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Modifier"
                            onClick={() => navigate(`/crm/calendar/${event.id}/edit`)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Supprimer"
                            onClick={() => remove.mutate(event.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Tab: Réservations ────────────────────────────────────────

function BookingsTab() {
  const [eventFilter, setEventFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar-events'],
    queryFn: () => api.get('/crm/calendar/events').then((r) => r.data),
  });

  const { data: bookings = [], isLoading } = useQuery<Booking[]>({
    queryKey: ['calendar-bookings', eventFilter, statusFilter],
    queryFn: () => api.get('/crm/calendar/bookings', {
      params: {
        event_id: eventFilter  || undefined,
        status:   statusFilter || undefined,
      },
    }).then((r) => r.data),
  });

  return (
    <>
      <div className="flex items-center justify-between px-6 py-3 border-b">
        <h2 className="font-semibold">Réservations</h2>
        <div className="flex items-center gap-2">
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-8 w-52 text-sm">
              <SelectValue placeholder="Nom de l'événement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous les événements</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              <SelectItem value="confirmed">Confirmé</SelectItem>
              <SelectItem value="cancelled">Annulé</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <Filter className="mr-1.5 h-3.5 w-3.5" />Filtres
          </Button>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-16 text-sm">Chargement…</div>
        ) : bookings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune réservation</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Invité</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Événement</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date &amp; heure</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Statut</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.invitee_name}</p>
                      <p className="text-xs text-muted-foreground">{b.invitee_email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{b.event_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(b.start_at)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={b.status === 'confirmed' ? 'default' : 'secondary'}>
                        {b.status === 'confirmed' ? 'Confirmé' : 'Annulé'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Tab: Disponibilité ───────────────────────────────────────

function AvailabilityTab() {
  const [weekDays, setWeekDays] = useState<DayAvail[]>(defaultWeekDays());

  const toggleDay = (idx: number) => {
    setWeekDays((prev) => {
      const next  = [...prev];
      const day   = { ...next[idx] };
      day.enabled = !day.enabled;
      if (day.enabled)  day.slots = [{ startTime: '09:00', endTime: '17:00' }];
      else              day.slots = [];
      next[idx] = day;
      return next;
    });
  };

  const addSlot = (dayIdx: number) => {
    setWeekDays((prev) => {
      const next = [...prev];
      next[dayIdx] = { ...next[dayIdx], slots: [...next[dayIdx].slots, { startTime: '09:00', endTime: '17:00' }] };
      return next;
    });
  };

  const removeSlot = (dayIdx: number, slotIdx: number) => {
    setWeekDays((prev) => {
      const next = [...prev];
      const slots = next[dayIdx].slots.filter((_, i) => i !== slotIdx);
      next[dayIdx] = { ...next[dayIdx], enabled: slots.length > 0, slots };
      return next;
    });
  };

  const updateSlot = (dayIdx: number, slotIdx: number, field: 'startTime' | 'endTime', value: string) => {
    setWeekDays((prev) => {
      const next  = [...prev];
      const slots = [...next[dayIdx].slots];
      slots[slotIdx] = { ...slots[slotIdx], [field]: value };
      next[dayIdx] = { ...next[dayIdx], slots };
      return next;
    });
  };

  return (
    <>
      <div className="flex items-center justify-between px-6 py-3 border-b">
        <h2 className="font-semibold">Disponibilité</h2>
        <Button size="sm" onClick={() => toast({ variant: 'success', title: 'Disponibilité sauvegardée' })}>
          <Save className="mr-1.5 h-3.5 w-3.5" />Sauvegarder
        </Button>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          {/* Left: weekly grid */}
          <div className="rounded-md border bg-background">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium text-primary">Disponibilité hebdomadaire</h3>
            </div>
            <div className="divide-y">
              {weekDays.map((day, dayIdx) => (
                <div key={dayIdx} className="flex items-start gap-3 px-4 py-3 min-h-[52px]">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={() => toggleDay(dayIdx)}
                    className="h-4 w-4 shrink-0 mt-0.5 cursor-pointer accent-primary"
                  />
                  <span className={cn(
                    'w-8 text-sm font-medium shrink-0',
                    day.enabled ? 'text-foreground' : 'text-muted-foreground',
                  )}>
                    {DAY_LABELS[dayIdx]}
                  </span>

                  {!day.enabled ? (
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm text-muted-foreground">Indisponible</span>
                      <button
                        type="button"
                        onClick={() => toggleDay(dayIdx)}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        + Ajouter un créneau
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col gap-1.5">
                      {day.slots.map((slot, slotIdx) => (
                        <div key={slotIdx} className="flex items-center gap-2">
                          <input
                            type="time"
                            className="h-8 w-28 rounded-md border border-input px-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                            value={slot.startTime}
                            onChange={(e) => updateSlot(dayIdx, slotIdx, 'startTime', e.target.value)}
                          />
                          <span className="text-muted-foreground">–</span>
                          <input
                            type="time"
                            className="h-8 w-28 rounded-md border border-input px-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                            value={slot.endTime}
                            onChange={(e) => updateSlot(dayIdx, slotIdx, 'endTime', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => removeSlot(dayIdx, slotIdx)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addSlot(dayIdx)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline w-fit"
                      >
                        <Plus className="h-3 w-3" />Ajouter un créneau
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: date-specific & absences */}
          <div className="space-y-4">
            <div className="rounded-md border bg-background p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Disponibilité selon la date</h3>
                <button className="text-xs text-primary hover:underline">
                  + Ajouter une nouvelle date
                </button>
              </div>
              <p className="text-xs text-muted-foreground italic">Aucune date ajoutée</p>
            </div>
            <div className="rounded-md border bg-background p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Absence</h3>
                <button className="text-xs text-primary hover:underline">
                  + Ajouter une nouvelle date
                </button>
              </div>
              <p className="text-xs text-muted-foreground italic">Aucune absence ajoutée</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main CalendarPage ─────────────────────────────────────────

type Tab = 'events' | 'bookings' | 'availability';

const TABS: { id: Tab; label: string }[] = [
  { id: 'events',       label: 'Evénements' },
  { id: 'bookings',     label: 'Réservations' },
  { id: 'availability', label: 'Disponibilité' },
];

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) ?? 'events';

  return (
    <div className="-mx-5 -my-4 lg:-mx-8">
      {/* Tab bar */}
      <div className="border-b bg-background px-6">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSearchParams({ tab: t.id })}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'events'       && <EventsTab />}
      {tab === 'bookings'     && <BookingsTab />}
      {tab === 'availability' && <AvailabilityTab />}
    </div>
  );
}
