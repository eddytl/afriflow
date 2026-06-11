// Catalogue complet des déclencheurs et actions disponibles pour les règles d'automatisation
// des tunnels de vente (inspiré Systeme.io)

export interface TriggerDef {
  type: string;
  label: string;
  description: string;
  params: ParamDef[];
}

export interface ActionDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  params: ParamDef[];
}

export interface ParamDef {
  key: string;
  label: string;
  type: 'text' | 'email' | 'url' | 'select' | 'textarea' | 'boolean' | 'resource';
  required: boolean;
  resource?: string; // nom de la ressource pour les selects dynamiques (campaigns, tags, pipelines…)
  options?: { value: string; label: string }[];
}

export const TRIGGERS: TriggerDef[] = [
  {
    type: 'optin',
    label: 'Inscription sur la page (optin)',
    description: 'Se produit quand un contact vient de s\'inscrire à un formulaire',
    params: [
      { key: 'funnelId', label: 'Tunnel',    type: 'resource', required: false, resource: 'funnels' },
      { key: 'pageId',   label: 'Étape',     type: 'resource', required: false, resource: 'funnel_pages' },
      { key: 'field',    label: 'Champ',     type: 'text',     required: false },
    ],
  },
  {
    type: 'page_view',
    label: 'Page visitée',
    description: 'Se produit quand une personne visite une page spécifique',
    params: [
      { key: 'pageId', label: 'Page', type: 'resource', required: true, resource: 'funnel_pages' },
    ],
  },
  {
    type: 'purchase',
    label: 'Achat effectué',
    description: 'Se produit quand un contact complète un paiement sur la page bon de commande',
    params: [
      { key: 'pageId', label: 'Bon de commande', type: 'resource', required: false, resource: 'funnel_pages' },
    ],
  },
];

export const ACTIONS: ActionDef[] = [
  {
    type: 'subscribe_campaign',
    label: 'S\'abonner à la campagne',
    description: 'Inscrit le contact à la campagne',
    icon: 'email',
    params: [
      { key: 'campaignId', label: 'Campagne', type: 'resource', required: true, resource: 'campaigns' },
    ],
  },
  {
    type: 'unsubscribe_campaign',
    label: 'Désinscrire de la campagne',
    description: 'Désabonne le contact de la campagne',
    icon: 'email_off',
    params: [
      { key: 'campaignId', label: 'Campagne', type: 'resource', required: true, resource: 'campaigns' },
    ],
  },
  {
    type: 'add_tag',
    label: 'Ajouter un tag',
    description: 'Ajoute le tag au contact',
    icon: 'tag',
    params: [
      { key: 'tagName', label: 'Tag', type: 'resource', required: true, resource: 'tags' },
    ],
  },
  {
    type: 'remove_tag',
    label: 'Supprimer le tag',
    description: 'Supprime le tag du contact',
    icon: 'tag_off',
    params: [
      { key: 'tagName', label: 'Tag', type: 'resource', required: true, resource: 'tags' },
    ],
  },
  {
    type: 'send_email',
    label: 'Envoyer un email',
    description: 'Envoie un email au contact',
    icon: 'send',
    params: [
      { key: 'subject',  label: 'Objet',      type: 'text',     required: true  },
      { key: 'body',     label: 'Corps',       type: 'textarea', required: true  },
      { key: 'fromName', label: 'Nom expéditeur', type: 'text', required: false },
    ],
  },
  {
    type: 'send_email_specific',
    label: 'Envoyer un email à une adresse spécifique',
    description: 'Envoie un email à une adresse email fixe (notification interne)',
    icon: 'forward_to_inbox',
    params: [
      { key: 'to',      label: 'Destinataire', type: 'email',    required: true  },
      { key: 'subject', label: 'Objet',         type: 'text',    required: true  },
      { key: 'body',    label: 'Corps',          type: 'textarea', required: true },
    ],
  },
  {
    type: 'call_webhook',
    label: 'Appeler un webhook',
    description: 'Envoie une requête HTTP à une URL externe quand l\'événement se produit',
    icon: 'webhook',
    params: [
      { key: 'url',     label: 'URL',     type: 'url',    required: true },
      { key: 'method',  label: 'Méthode', type: 'select', required: true,
        options: [
          { value: 'POST',  label: 'POST' },
          { value: 'GET',   label: 'GET' },
          { value: 'PUT',   label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
        ],
      },
      { key: 'headers',  label: 'Headers JSON',  type: 'textarea', required: false },
      { key: 'bodyTpl',  label: 'Body template', type: 'textarea', required: false },
    ],
  },
  {
    type: 'add_to_pipeline_stage',
    label: 'Ajouter à une étape du pipeline',
    description: 'Ajoute ou déplace le contact vers une étape de pipeline',
    icon: 'pipeline',
    params: [
      { key: 'pipelineId', label: 'Pipeline', type: 'resource', required: true, resource: 'pipelines' },
      { key: 'stageId',    label: 'Étape',    type: 'resource', required: true, resource: 'pipeline_stages' },
      { key: 'dealTitle',  label: 'Titre du deal (optionnel)', type: 'text', required: false },
    ],
  },
  {
    type: 'enroll_course',
    label: 'Inscrire à une formation',
    description: 'Inscrit le contact à la formation',
    icon: 'school',
    params: [
      { key: 'courseId', label: 'Formation', type: 'resource', required: true, resource: 'courses' },
    ],
  },
  {
    type: 'revoke_course',
    label: 'Supprimer l\'accès à une formation',
    description: 'Désinscrit le contact d\'une formation',
    icon: 'school_off',
    params: [
      { key: 'courseId', label: 'Formation', type: 'resource', required: true, resource: 'courses' },
    ],
  },
  {
    type: 'send_sms',
    label: 'Envoyer un SMS',
    description: 'Envoie un SMS au contact',
    icon: 'sms',
    params: [
      { key: 'message', label: 'Message', type: 'textarea', required: true },
    ],
  },
  {
    type: 'grant_community',
    label: 'Donner accès à la communauté',
    description: 'Autorise le contact à rejoindre une communauté',
    icon: 'group_add',
    params: [
      { key: 'communityId', label: 'Communauté', type: 'resource', required: true, resource: 'communities' },
    ],
  },
  {
    type: 'revoke_community',
    label: 'Supprimer l\'accès à une communauté',
    description: 'Retire l\'accès d\'un contact à une communauté',
    icon: 'group_remove',
    params: [
      { key: 'communityId', label: 'Communauté', type: 'resource', required: true, resource: 'communities' },
    ],
  },
];

export function getCatalog() {
  return { triggers: TRIGGERS, actions: ACTIONS };
}

export function validateTrigger(type: string, params: Record<string, unknown>): string | null {
  const def = TRIGGERS.find((t) => t.type === type);
  if (!def) return `Déclencheur inconnu: ${type}`;
  for (const p of def.params) {
    if (p.required && !params[p.key]) return `Paramètre requis manquant: ${p.key}`;
  }
  return null;
}

export function validateAction(type: string, params: Record<string, unknown>): string | null {
  const def = ACTIONS.find((a) => a.type === type);
  if (!def) return `Action inconnue: ${type}`;
  for (const p of def.params) {
    if (p.required && !params[p.key]) return `Paramètre requis manquant pour ${type}: ${p.key}`;
  }
  return null;
}
