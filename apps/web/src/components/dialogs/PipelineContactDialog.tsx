import { useState, useRef, useEffect } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { contactsApi, crmApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Mode = 'existing' | 'new';
type Step = 'choose' | 'search' | 'create';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  country?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineId: string;
  stageId: string;
}

/* ── Radio option ──────────────────────────────────────────────── */
function RadioOption({
  checked, label, onChange,
}: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 w-full text-left"
      onClick={onChange}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          checked ? 'border-primary bg-primary' : 'border-muted-foreground/40',
        )}
      >
        {checked && (
          <svg viewBox="0 0 10 10" className="h-3 w-3 fill-primary-foreground">
            <path d="M1.5 5.5 L4 8 L8.5 2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={cn('text-sm', checked ? 'text-primary font-medium' : 'text-muted-foreground')}>
        {label}
      </span>
    </button>
  );
}

/* ── Main dialog ───────────────────────────────────────────────── */
export function PipelineContactDialog({ open, onOpenChange, pipelineId, stageId }: Props) {
  const qc = useQueryClient();
  const [step, setStep]   = useState<Step>('choose');
  const [mode, setMode]   = useState<Mode>('existing');

  /* search state */
  const [search, setSearch]             = useState('');
  const [searchOpen, setSearchOpen]     = useState(false);
  const [selectedContact, setSelected] = useState<Contact | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  /* create form state */
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '',
    country: '', region: '', phone: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  /* reset on open/close */
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep('choose'); setMode('existing');
        setSearch(''); setSelected(null); setSearchOpen(false);
        setForm({ first_name: '', last_name: '', email: '', country: '', region: '', phone: '' });
      }, 200);
    }
  }, [open]);

  /* close search dropdown on outside click */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    if (searchOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [searchOpen]);

  /* contact search query */
  const { data: searchData } = useQuery({
    queryKey: ['contacts-search', search],
    queryFn:  () => contactsApi.list({ search, limit: '10' }),
    enabled:  search.trim().length >= 3 && !selectedContact,
  });
  const results: Contact[] = searchData?.data ?? [];

  /* mutations */
  const saveExisting = useMutation({
    mutationFn: async () => {
      if (!selectedContact) throw new Error('no contact');
      await crmApi.createDeal(pipelineId, {
        stageId,
        title:     `${selectedContact.first_name} ${selectedContact.last_name}`.trim() || selectedContact.email,
        contactId: selectedContact.id,
        value:     0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      toast({ variant: 'success', title: 'Contact ajouté au pipeline' });
      onOpenChange(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur lors de l\'ajout' }),
  });

  const saveNew = useMutation({
    mutationFn: async () => {
      const contact = await contactsApi.create({
        first_name: form.first_name || undefined,
        last_name:  form.last_name  || undefined,
        email:      form.email      || undefined,
        country:    form.country    || undefined,
        phone:      form.phone      || undefined,
      });
      await crmApi.createDeal(pipelineId, {
        stageId,
        title:     `${form.first_name} ${form.last_name}`.trim() || form.email,
        contactId: contact.id,
        value:     0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast({ variant: 'success', title: 'Contact créé et ajouté au pipeline' });
      onOpenChange(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur lors de la création' }),
  });

  const isPending = saveExisting.isPending || saveNew.isPending;

  /* ── Render steps ── */
  const title = 'Contact';

  /* Step 1 — choose mode */
  if (step === 'choose') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <RadioOption
              checked={mode === 'existing'}
              label="Ajouter un contact existant"
              onChange={() => setMode('existing')}
            />
            <RadioOption
              checked={mode === 'new'}
              label="Créer un nouveau contact"
              onChange={() => setMode('new')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button onClick={() => setStep(mode === 'existing' ? 'search' : 'create')}>
              Suivant
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  /* Step 2a — search existing contact */
  if (step === 'search') {
    const displayValue = selectedContact
      ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim() || selectedContact.email
      : search;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="py-2" ref={searchRef}>
            <div className="relative flex items-center rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <input
                className="flex-1 h-9 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Saisissez au moins 3 caractères pour afficher les résultats correspondants"
                value={displayValue}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
              />
              {selectedContact ? (
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelected(null); setSearch(''); }}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <ChevronDown className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
              )}

              {/* Dropdown results */}
              {searchOpen && search.trim().length >= 3 && !selectedContact && (
                <div className="absolute top-10 left-0 right-0 z-50 rounded-md border bg-background shadow-lg max-h-48 overflow-y-auto">
                  {results.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Aucun résultat
                    </div>
                  ) : results.map((c) => (
                    <button
                      key={c.id}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setSelected(c); setSearchOpen(false); }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {c.first_name} {c.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button
              disabled={!selectedContact || isPending}
              onClick={() => saveExisting.mutate()}
            >
              Sauvegarder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  /* Step 2b — create new contact */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Prénom</Label>
              <Input placeholder="Prénom" value={form.first_name} onChange={set('first_name')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nom</Label>
              <Input placeholder="Nom" value={form.last_name} onChange={set('last_name')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Email<span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input type="email" placeholder="Email" value={form.email} onChange={set('email')} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Pays</Label>
            <div className="relative flex items-center rounded-md border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <input
                className="flex-1 h-8 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Pays"
                value={form.country}
                onChange={set('country')}
              />
              {form.country && (
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setForm((p) => ({ ...p, country: '' }))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronDown className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Région</Label>
            <Input placeholder="Région" value={form.region} onChange={set('region')} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Numéro de téléphone</Label>
            <Input placeholder="Numéro de téléphone" value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            disabled={!form.email || isPending}
            onClick={() => saveNew.mutate()}
          >
            Sauvegarder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
