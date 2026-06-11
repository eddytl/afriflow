import { useState, useRef } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Upload, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { contactsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const mutation = useMutation({
    mutationFn: () => contactsApi.import(file!),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast({ variant: 'success', title: 'Import réussi', description: `${data.imported ?? '?'} contacts importés` });
      onOpenChange(false);
      setFile(null);
    },
    onError: () => toast({ variant: 'destructive', title: 'Erreur import', description: 'Format de fichier invalide' }),
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.csv')) setFile(f);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setFile(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importer des contacts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
              file && 'border-emerald-400 bg-emerald-50',
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
            />
            {file ? (
              <>
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-2" />
                <p className="font-medium text-emerald-700">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} Ko</p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground/50 mb-2" />
                <p className="font-medium">Glissez votre fichier CSV ici</p>
                <p className="text-xs text-muted-foreground mt-1">ou cliquez pour parcourir</p>
              </>
            )}
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-medium">Format attendu du CSV</span>
            </div>
            <code className="block mt-1">first_name, last_name, email, phone, country</code>
            <p className="mt-1">La première ligne doit contenir les en-têtes. Seul l'email est obligatoire.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setFile(null); }}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
