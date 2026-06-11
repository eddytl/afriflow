import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Video, Phone, MapPin, Plus, Trash2, Clock, User,
  Upload, Globe, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface TimeSlot {
  startTime: string;
  endTime: string;
}

interface DayAvail {
  enabled: boolean;
  slots: TimeSlot[];
}

type LocationType = 'video' | 'phone' | 'in_person';
type AvailWindow = 'unlimited' | 'days' | 'range';

interface FormState {
  name: string;
  slug: string;
  hostName: string;
  hostEmail: string;
  durationMinutes: string;
  locationType: LocationType;
  locationDetails: string;
  description: string;
  // Availability window
  availWindow: AvailWindow;
  availDays: string;
  availFrom: string;
  availTo: string;
  // Timing
  minNoticeHours: string;
  cancelNoticeHours: string;
  slotFrequencyMin: string;
  dailyLimit: string;
  bufferBeforeMin: string;
  bufferAfterMin: string;
  detectTimezone: boolean;
}

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const DURATION_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 heure' },
  { value: '90', label: '1h30' },
  { value: '120', label: '2 heures' },
];

const FREQUENCY_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 heure' },
];

const BUFFER_OPTIONS = [
  { value: '0', label: 'Aucun' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 heure' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function defaultWeekDays(): DayAvail[] {
  return Array.from({ length: 7 }, (_, i) => ({
    enabled: i >= 1 && i <= 5, // Mon–Fri enabled by default
    slots: [{ startTime: '09:00', endTime: '17:00' }],
  }));
}

function toAvailabilityArray(weekDays: DayAvail[]) {
  const result: { dayOfWeek: number; startTime: string; endTime: string }[] = [];
  weekDays.forEach((day, idx) => {
    if (day.enabled) {
      day.slots.forEach((s) => {
        result.push({ dayOfWeek: idx, startTime: s.startTime, endTime: s.endTime });
      });
    }
  });
  return result;
}

function fromAvailabilityArray(arr: { day_of_week: number; start_time: string; end_time: string }[]) {
  const days = defaultWeekDays().map((d) => ({ ...d, enabled: false, slots: [] as TimeSlot[] }));
  arr.forEach((row) => {
    const day = days[row.day_of_week];
    day.enabled = true;
    day.slots.push({ startTime: row.start_time, endTime: row.end_time });
  });
  days.forEach((day) => {
    if (day.enabled && day.slots.length === 0) {
      day.slots.push({ startTime: '09:00', endTime: '17:00' });
    }
  });
  return days;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CalendarEventFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [form, setForm] = useState<FormState>({
    name: '',
    slug: '',
    hostName: currentUser?.name ?? '',
    hostEmail: currentUser?.email ?? '',
    durationMinutes: '30',
    locationType: 'video',
    locationDetails: '',
    description: '',
    availWindow: 'unlimited',
    availDays: '30',
    availFrom: '',
    availTo: '',
    minNoticeHours: '2',
    cancelNoticeHours: '0',
    slotFrequencyMin: '30',
    dailyLimit: '',
    bufferBeforeMin: '0',
    bufferAfterMin: '0',
    detectTimezone: true,
  });

  const [weekDays, setWeekDays] = useState<DayAvail[]>(defaultWeekDays());
  const [slugManual, setSlugManual] = useState(false);

  // Load event for edit
  const { data: existingEvent } = useQuery({
    queryKey: ['calendar-event', id],
    queryFn: () => api.get(`/crm/calendar/events/${id}`).then((r) => r.data),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existingEvent) return;
    const e = existingEvent;
    setSlugManual(true);
    setForm({
      name: e.name ?? '',
      slug: e.slug ?? '',
      hostName: e.host_name ?? '',
      hostEmail: e.host_email ?? '',
      durationMinutes: String(e.duration_minutes ?? 30),
      locationType: (e.location_type as LocationType) ?? 'video',
      locationDetails: e.location_details ?? '',
      description: e.description ?? '',
      availWindow: e.availability_from ? 'range' : e.availability_to ? 'range' : 'unlimited',
      availDays: '30',
      availFrom: e.availability_from?.slice(0, 10) ?? '',
      availTo: e.availability_to?.slice(0, 10) ?? '',
      minNoticeHours: String(e.min_notice_hours ?? 2),
      cancelNoticeHours: String(e.cancel_notice_hours ?? 0),
      slotFrequencyMin: String(e.slot_frequency_min ?? 30),
      dailyLimit: e.daily_limit ? String(e.daily_limit) : '',
      bufferBeforeMin: String(e.buffer_before_min ?? 0),
      bufferAfterMin: String(e.buffer_after_min ?? 0),
      detectTimezone: e.detect_timezone ?? true,
    });
    if (e.availability?.length) {
      setWeekDays(fromAvailabilityArray(e.availability));
    }
  }, [existingEvent]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !slugManual) {
        next.slug = toSlug(value as string);
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const availability = toAvailabilityArray(weekDays);
      const payload: Record<string, unknown> = {
        name: form.name,
        slug: form.slug || toSlug(form.name),
        hostName: form.hostName,
        hostEmail: form.hostEmail,
        durationMinutes: Number(form.durationMinutes),
        locationType: form.locationType,
        locationDetails: form.locationDetails || undefined,
        description: form.description || undefined,
        minNoticeHours: Number(form.minNoticeHours),
        cancelNoticeHours: Number(form.cancelNoticeHours),
        slotFrequencyMin: Number(form.slotFrequencyMin),
        dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : undefined,
        bufferBeforeMin: Number(form.bufferBeforeMin),
        bufferAfterMin: Number(form.bufferAfterMin),
        detectTimezone: form.detectTimezone,
        availability,
      };
      if (form.availWindow === 'days') {
        const d = new Date();
        d.setDate(d.getDate() + Number(form.availDays));
        payload.availabilityTo = d.toISOString().slice(0, 10);
      } else if (form.availWindow === 'range') {
        payload.availabilityFrom = form.availFrom || undefined;
        payload.availabilityTo = form.availTo || undefined;
      }
      if (isEdit) {
        return api.patch(`/crm/calendar/events/${id}`, payload).then((r) => r.data);
      }
      return api.post('/crm/calendar/events', payload).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ variant: 'success', title: isEdit ? 'Événement mis à jour' : 'Événement créé' });
      navigate('/crm/calendar');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast({ variant: 'destructive', title: 'Erreur', description: msg ?? 'Impossible de sauvegarder l\'événement' });
    },
  });

  const canSave = form.name.trim() && form.hostName.trim() && form.hostEmail.trim();

  // ── Day row helpers ───────────────────────────────────────────────────────

  const toggleDay = (idx: number) => {
    setWeekDays((prev) => {
      const next = [...prev];
      const day = { ...next[idx] };
      day.enabled = !day.enabled;
      if (day.enabled && day.slots.length === 0) {
        day.slots = [{ startTime: '09:00', endTime: '17:00' }];
      }
      next[idx] = day;
      return next;
    });
  };

  const addSlot = (dayIdx: number) => {
    setWeekDays((prev) => {
      const next = [...prev];
      const day = { ...next[dayIdx], slots: [...next[dayIdx].slots] };
      day.slots.push({ startTime: '09:00', endTime: '17:00' });
      next[dayIdx] = day;
      return next;
    });
  };

  const removeSlot = (dayIdx: number, slotIdx: number) => {
    setWeekDays((prev) => {
      const next = [...prev];
      const day = { ...next[dayIdx], slots: next[dayIdx].slots.filter((_, i) => i !== slotIdx) };
      if (day.slots.length === 0) day.enabled = false;
      next[dayIdx] = day;
      return next;
    });
  };

  const updateSlotTime = (dayIdx: number, slotIdx: number, field: 'startTime' | 'endTime', value: string) => {
    setWeekDays((prev) => {
      const next = [...prev];
      const day = { ...next[dayIdx], slots: [...next[dayIdx].slots] };
      day.slots[slotIdx] = { ...day.slots[slotIdx], [field]: value };
      next[dayIdx] = day;
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 lg:px-8">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <button
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigate('/crm/calendar')}
          >
            <ChevronLeft className="h-4 w-4" />
            Evénements
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">
            {isEdit ? 'Modifier l\'événement' : 'Créer un nouvel événement individuel'}
          </span>
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
        >
          {save.isPending ? 'Sauvegarde...' : 'Sauvegarder et aperçu'}
        </Button>
      </div>

      {/* ── Section 1: Détails ───────────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-base font-semibold mb-5">Détails de l'événement</h2>
        <div className="space-y-5">

          {/* Nom */}
          <div className="grid grid-cols-[200px_1fr] items-start gap-4">
            <Label className="pt-2">Nom <span className="text-destructive">*</span></Label>
            <div className="space-y-1.5">
              <Input
                placeholder="ex: Appel de découverte 30 minutes"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Lien :</span>
                <Input
                  className="h-7 text-xs"
                  value={form.slug}
                  onChange={(e) => { setSlugManual(true); setField('slug', e.target.value); }}
                  placeholder="mon-evenement"
                />
              </div>
            </div>
          </div>

          {/* Durée */}
          <div className="grid grid-cols-[200px_1fr] items-center gap-4">
            <Label>Durée de l'événement <span className="text-destructive">*</span></Label>
            <Select value={form.durationMinutes} onValueChange={(v) => setField('durationMinutes', v)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Hôte */}
          <div className="grid grid-cols-[200px_1fr] items-start gap-4">
            <Label className="pt-2">Nom de l'hôte <span className="text-destructive">*</span></Label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
              <Input
                className="flex-1"
                placeholder="Votre nom"
                value={form.hostName}
                onChange={(e) => setField('hostName', e.target.value)}
              />
            </div>
          </div>

          {/* Email hôte */}
          <div className="grid grid-cols-[200px_1fr] items-center gap-4">
            <Label>Adresse email de l'hôte</Label>
            <Input
              type="email"
              placeholder="email@example.com"
              value={form.hostEmail}
              onChange={(e) => setField('hostEmail', e.target.value)}
            />
          </div>

          {/* Lieu */}
          <div className="grid grid-cols-[200px_1fr] items-start gap-4">
            <Label className="pt-2">Lieu <span className="text-destructive">*</span></Label>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(
                  [
                    { value: 'video', icon: Video, label: 'Réunion' },
                    { value: 'phone', icon: Phone, label: 'Appel' },
                    { value: 'in_person', icon: MapPin, label: 'Face à face' },
                  ] as const
                ).map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setField('locationType', value)}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors',
                      form.locationType === value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
              {(form.locationType === 'video' || form.locationType === 'in_person') && (
                <Input
                  placeholder={form.locationType === 'video' ? 'Lien de réunion (Zoom, Meet…)' : 'Adresse du lieu'}
                  value={form.locationDetails}
                  onChange={(e) => setField('locationDetails', e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Logo */}
          <div className="grid grid-cols-[200px_1fr] items-center gap-4">
            <Label>Logo personnalisé</Label>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors">
                <Upload className="h-4 w-4" />
                Choisir un fichier
                <input type="file" accept="image/*" className="sr-only" />
              </label>
              <span className="text-xs text-muted-foreground">PNG, JPG jusqu'à 2 Mo</span>
            </div>
          </div>

          {/* Description */}
          <div className="grid grid-cols-[200px_1fr] items-start gap-4">
            <Label className="pt-2">Description</Label>
            <Textarea
              placeholder="Décrivez votre événement pour vos invités…"
              rows={4}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* ── Section 2: Disponibilité ─────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-base font-semibold mb-5">Disponibilité</h2>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          {/* Left column */}
          <div className="space-y-6">

            {/* Fenêtre de réservation */}
            <div>
              <Label className="mb-3 block">Les invités peuvent réserver <span className="text-destructive">*</span></Label>
              <div className="space-y-2.5">
                {(
                  [
                    { value: 'unlimited', label: 'Sans limite de temps' },
                    { value: 'days', label: 'jours dans le futur' },
                    { value: 'range', label: 'Sur une période définie' },
                  ] as const
                ).map(({ value, label }) => (
                  <label key={value} className="flex cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="availWindow"
                      checked={form.availWindow === value}
                      onChange={() => setField('availWindow', value)}
                      className="h-4 w-4 accent-primary"
                    />
                    {value === 'days' ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          className="h-8 w-20"
                          value={form.availDays}
                          onChange={(e) => setField('availDays', e.target.value)}
                          onClick={() => setField('availWindow', 'days')}
                        />
                        <span className="text-sm">{label}</span>
                      </div>
                    ) : value === 'range' ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{label}</span>
                        {form.availWindow === 'range' && (
                          <>
                            <Input
                              type="date"
                              className="h-8 w-40"
                              value={form.availFrom}
                              onChange={(e) => setField('availFrom', e.target.value)}
                            />
                            <span className="text-sm text-muted-foreground">–</span>
                            <Input
                              type="date"
                              className="h-8 w-40"
                              value={form.availTo}
                              onChange={(e) => setField('availTo', e.target.value)}
                            />
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm">{label}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Délai minimum + Annulation */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Délai minimum avant l'événement
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    className="w-20"
                    value={form.minNoticeHours}
                    onChange={(e) => setField('minNoticeHours', e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">heures</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Date limite d'annulation
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    className="w-20"
                    value={form.cancelNoticeHours}
                    onChange={(e) => setField('cancelNoticeHours', e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">heures</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Disponibilité hebdomadaire */}
            <div>
              <h3 className="text-sm font-medium mb-3">Disponibilité hebdomadaire</h3>
              <div className="space-y-1">
                {weekDays.map((day, dayIdx) => (
                  <div key={dayIdx} className={cn(
                    'rounded-md px-3 py-2.5',
                    day.enabled ? 'bg-muted/30' : '',
                  )}>
                    <div className="flex items-center gap-3 min-h-[36px]">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={() => toggleDay(dayIdx)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                      />
                      {/* Day label */}
                      <span className={cn(
                        'w-8 text-sm font-medium shrink-0',
                        day.enabled ? 'text-foreground' : 'text-muted-foreground',
                      )}>
                        {DAY_LABELS[dayIdx]}
                      </span>

                      {!day.enabled ? (
                        <span className="text-sm text-muted-foreground italic">Indisponible</span>
                      ) : (
                        <div className="flex flex-1 flex-col gap-1">
                          {day.slots.map((slot, slotIdx) => (
                            <div key={slotIdx} className="flex items-center gap-2">
                              <Input
                                type="time"
                                className="h-8 w-28"
                                value={slot.startTime}
                                onChange={(e) => updateSlotTime(dayIdx, slotIdx, 'startTime', e.target.value)}
                              />
                              <span className="text-muted-foreground">–</span>
                              <Input
                                type="time"
                                className="h-8 w-28"
                                value={slot.endTime}
                                onChange={(e) => updateSlotTime(dayIdx, slotIdx, 'endTime', e.target.value)}
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
                            <Plus className="h-3 w-3" />
                            Ajouter un créneau
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">

            {/* Disponibilité selon la date */}
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Disponibilité selon la date
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Bloquez des dates spécifiques ou ajoutez des créneaux exceptionnels.
              </p>
              <button
                type="button"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une nouvelle date
              </button>
            </div>

            <Separator />

            {/* Fréquence */}
            <div className="space-y-1.5">
              <Label>Fréquence des rendez-vous <span className="text-destructive">*</span></Label>
              <Select value={form.slotFrequencyMin} onValueChange={(v) => setField('slotFrequencyMin', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Limite journalière */}
            <div className="space-y-1.5">
              <Label>Limite journalière</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="Illimitée"
                  className="w-full"
                  value={form.dailyLimit}
                  onChange={(e) => setField('dailyLimit', e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">Laissez vide pour aucune limite</p>
            </div>

            {/* Buffer */}
            <div className="space-y-1.5">
              <Label>Temps entre 2 rendez-vous</Label>
              <Select value={form.bufferAfterMin} onValueChange={(v) => setField('bufferAfterMin', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUFFER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Fuseau horaire */}
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                Affichage du fuseau horaire
              </h3>
              <div className="space-y-2.5">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="timezone"
                    checked={form.detectTimezone}
                    onChange={() => setField('detectTimezone', true)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Afficher les horaires dans le fuseau horaire du visiteur</span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="timezone"
                    checked={!form.detectTimezone}
                    onChange={() => setField('detectTimezone', false)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Afficher les horaires dans votre fuseau horaire</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Bottom save ─────────────────────────────────────────────────────── */}
      <div className="flex justify-end pb-8">
        <Button
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
          size="lg"
        >
          {save.isPending ? 'Sauvegarde...' : 'Sauvegarder et aperçu'}
        </Button>
      </div>
    </div>
  );
}
