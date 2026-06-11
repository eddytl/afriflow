// Catalogue complet des déclencheurs et actions pour les règles d'automatisation globales

export interface TriggerDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  category: 'contacts' | 'sales' | 'email' | 'courses' | 'community' | 'events';
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
  type: 'text' | 'email' | 'url' | 'select' | 'textarea' | 'boolean' | 'resource' | 'number';
  required: boolean;
  resource?: string;
  options?: { value: string; label: string }[];
}

export const GLOBAL_TRIGGERS: TriggerDef[] = [
  // ── Contacts / Tags ──────────────────────────────────────
  {
    type: 'tag_added', category: 'contacts', icon: 'tag',
    label: 'Tag ajouté',
    description: 'Se produit lorsque le tag a été ajouté au contact',
    params: [{ key: 'tagName', label: 'Tag', type: 'resource', required: false, resource: 'tags' }],
  },
  {
    type: 'tag_removed', category: 'contacts', icon: 'tag_off',
    label: 'Tag supprimé',
    description: 'Se produit lorsque le tag a été supprimé du contact',
    params: [{ key: 'tagName', label: 'Tag', type: 'resource', required: false, resource: 'tags' }],
  },

  // ── Formulaires / Optins ─────────────────────────────────
  {
    type: 'optin', category: 'contacts', icon: 'form',
    label: 'Inscription sur la page (optin)',
    description: 'Se produit quand un contact vient de s\'inscrire à un formulaire',
    params: [
      { key: 'funnelId', label: 'Tunnel',       type: 'resource', required: false, resource: 'funnels' },
      { key: 'pageId',   label: 'Étape tunnel', type: 'resource', required: false, resource: 'funnel_pages' },
    ],
  },
  {
    type: 'website_form', category: 'contacts', icon: 'web',
    label: 'Formulaire d\'inscription au site web',
    description: 'Se produit lorsqu\'un contact vient de se souscrire via un formulaire',
    params: [
      { key: 'websiteId', label: 'Site web', type: 'resource', required: false, resource: 'websites' },
    ],
  },
  {
    type: 'blog_form', category: 'contacts', icon: 'blog',
    label: 'Formulaire souscrit sur une page de blog',
    description: 'Se produit lorsque quelqu\'un s\'inscrit sur le formulaire de cette page',
    params: [
      { key: 'blogId', label: 'Blog', type: 'resource', required: false, resource: 'blogs' },
    ],
  },
  {
    type: 'store_form', category: 'contacts', icon: 'store',
    label: 'Inscrit au formulaire d\'une page créateur',
    description: 'Se produit lorsqu\'un contact vient de s\'inscrire via la section « Capturer des emails » d\'une page créateur',
    params: [
      { key: 'storeId', label: 'Page créateur', type: 'resource', required: false, resource: 'stores' },
    ],
  },

  // ── Campagnes / Email ────────────────────────────────────
  {
    type: 'campaign_completed', category: 'email', icon: 'campaign',
    label: 'Campagne terminée',
    description: 'Se produit quand un contact vient de terminer une campagne',
    params: [
      { key: 'campaignId', label: 'Campagne', type: 'resource', required: false, resource: 'campaigns' },
    ],
  },
  {
    type: 'email_opened', category: 'email', icon: 'mail_open',
    label: 'Email ouvert',
    description: 'Se produit lorsqu\'un contact ouvre un email',
    params: [
      { key: 'campaignId', label: 'Campagne (optionnel)', type: 'resource', required: false, resource: 'campaigns' },
    ],
  },
  {
    type: 'email_link_clicked', category: 'email', icon: 'link',
    label: 'Lien Email cliqué',
    description: 'Se déclenche lorsqu\'un contact a cliqué sur un lien dans vos emails',
    params: [
      { key: 'url',        label: 'URL (optionnel)', type: 'url',      required: false },
      { key: 'campaignId', label: 'Campagne',        type: 'resource', required: false, resource: 'campaigns' },
    ],
  },

  // ── Ventes ───────────────────────────────────────────────
  {
    type: 'new_sale', category: 'sales', icon: 'shopping_cart',
    label: 'Nouvelle vente',
    description: 'Se produit quand un client achète une offre',
    params: [
      { key: 'pageId', label: 'Bon de commande (optionnel)', type: 'resource', required: false, resource: 'funnel_pages' },
    ],
  },
  {
    type: 'sale_cancelled', category: 'sales', icon: 'cancel',
    label: 'Vente annulée',
    description: 'Se produit lorsqu\'un paiement unique est remboursé ou qu\'un abonnement est annulé',
    params: [],
  },
  {
    type: 'subscription_payment_failed', category: 'sales', icon: 'payment_failed',
    label: 'Échec du paiement de l\'abonnement',
    description: 'Se produit lorsqu\'un paiement d\'abonnement échoue',
    params: [],
  },

  // ── Formations ───────────────────────────────────────────
  {
    type: 'webinar_registered', category: 'courses', icon: 'video',
    label: 'Enregistré pour le webinaire',
    description: 'Se produit lorsque le contact vient d\'être enregistré sur un webinaire',
    params: [
      { key: 'courseId', label: 'Webinaire', type: 'resource', required: false, resource: 'courses' },
    ],
  },
  {
    type: 'course_enrolled', category: 'courses', icon: 'school',
    label: 'Inscrit à la formation',
    description: 'Se produit quand le contact vient de s\'inscrire à une formation',
    params: [
      { key: 'courseId', label: 'Formation', type: 'resource', required: false, resource: 'courses' },
    ],
  },
  {
    type: 'course_completed', category: 'courses', icon: 'graduation',
    label: 'Formation terminée',
    description: 'Se produit quand un étudiant vient de terminer une formation',
    params: [
      { key: 'courseId', label: 'Formation', type: 'resource', required: false, resource: 'courses' },
    ],
  },
  {
    type: 'module_completed', category: 'courses', icon: 'module',
    label: 'Module terminé',
    description: 'Se produit quand un étudiant vient de terminer un module',
    params: [
      { key: 'courseId',  label: 'Formation', type: 'resource', required: false, resource: 'courses' },
      { key: 'moduleId',  label: 'Module',    type: 'resource', required: false, resource: 'course_modules' },
    ],
  },
  {
    type: 'chapter_completed', category: 'courses', icon: 'chapter',
    label: 'Chapitre terminé',
    description: 'Se produit quand un étudiant vient de terminer un chapitre',
    params: [
      { key: 'courseId',  label: 'Formation', type: 'resource', required: false, resource: 'courses' },
      { key: 'chapterId', label: 'Chapitre',  type: 'resource', required: false, resource: 'course_chapters' },
    ],
  },
  {
    type: 'course_pack_enrolled', category: 'courses', icon: 'pack',
    label: 'Inscrit au pack de formations',
    description: 'Se produit quand le contact vient de s\'inscrire à un pack de formations',
    params: [
      { key: 'packId', label: 'Pack', type: 'resource', required: false, resource: 'course_packs' },
    ],
  },

  // ── Communauté ───────────────────────────────────────────
  {
    type: 'community_joined', category: 'community', icon: 'group',
    label: 'Inscrit dans la communauté',
    description: 'Se produit lorsqu\'un contact vient de s\'inscrire dans une communauté',
    params: [
      { key: 'communityId', label: 'Communauté', type: 'resource', required: false, resource: 'communities' },
    ],
  },

  // ── Événements ───────────────────────────────────────────
  {
    type: 'page_visited', category: 'events', icon: 'visibility',
    label: 'Page visitée',
    description: 'Se produit quand une personne visite une page spécifique',
    params: [
      { key: 'pageId', label: 'Page', type: 'resource', required: false, resource: 'funnel_pages' },
    ],
  },
  {
    type: 'meeting_scheduled', category: 'events', icon: 'calendar',
    label: 'Réunion programmée',
    description: 'Se produit lorsqu\'un contact planifie une réunion',
    params: [
      { key: 'eventId', label: 'Événement calendrier', type: 'resource', required: false, resource: 'calendar_events' },
    ],
  },
];

export const GLOBAL_ACTIONS: ActionDef[] = [
  {
    type: 'subscribe_campaign',   icon: 'email',
    label: 'S\'abonner à la campagne',
    description: 'Inscrit le contact à la campagne',
    params: [{ key: 'campaignId', label: 'Campagne', type: 'resource', required: true, resource: 'campaigns' }],
  },
  {
    type: 'unsubscribe_campaign', icon: 'email_off',
    label: 'Désinscrire de la campagne',
    description: 'Désabonne le contact de la campagne',
    params: [{ key: 'campaignId', label: 'Campagne', type: 'resource', required: true, resource: 'campaigns' }],
  },
  {
    type: 'add_tag',    icon: 'tag',
    label: 'Ajouter un tag',
    description: 'Ajoute le tag au contact',
    params: [{ key: 'tagName', label: 'Tag', type: 'resource', required: true, resource: 'tags' }],
  },
  {
    type: 'remove_tag', icon: 'tag_off',
    label: 'Supprimer le tag',
    description: 'Supprime le tag du contact',
    params: [{ key: 'tagName', label: 'Tag', type: 'resource', required: true, resource: 'tags' }],
  },
  {
    type: 'send_email', icon: 'send',
    label: 'Envoyer un email',
    description: 'Envoie un email au contact',
    params: [
      { key: 'subject',  label: 'Objet',           type: 'text',     required: true },
      { key: 'body',     label: 'Corps',            type: 'textarea', required: true },
      { key: 'fromName', label: 'Nom expéditeur',   type: 'text',     required: false },
    ],
  },
  {
    type: 'send_email_specific', icon: 'forward_to_inbox',
    label: 'Envoyer un email à une adresse email spécifique',
    description: 'Envoie un email à une adresse spécifique',
    params: [
      { key: 'to',      label: 'Destinataire', type: 'email',    required: true },
      { key: 'subject', label: 'Objet',         type: 'text',    required: true },
      { key: 'body',    label: 'Corps',          type: 'textarea', required: true },
    ],
  },
  {
    type: 'send_sms', icon: 'sms',
    label: 'Envoyer un SMS',
    description: 'Envoie un SMS au contact',
    params: [{ key: 'message', label: 'Message', type: 'textarea', required: true }],
  },
  {
    type: 'enroll_course',   icon: 'school',
    label: 'Inscrire à une formation',
    description: 'Inscrit le contact à la formation',
    params: [{ key: 'courseId', label: 'Formation', type: 'resource', required: true, resource: 'courses' }],
  },
  {
    type: 'revoke_course',   icon: 'school_off',
    label: 'Supprimer l\'accès à une formation',
    description: 'Désinscrit un contact d\'une formation',
    params: [{ key: 'courseId', label: 'Formation', type: 'resource', required: true, resource: 'courses' }],
  },
  {
    type: 'call_webhook', icon: 'webhook',
    label: 'Appeler un webhook',
    description: 'Une requête HTTP sera envoyée à une URL lorsqu\'un événement se produit',
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
    type: 'grant_community',  icon: 'group_add',
    label: 'Donner accès à la communauté',
    description: 'Autorise un contact à rejoindre une communauté',
    params: [{ key: 'communityId', label: 'Communauté', type: 'resource', required: true, resource: 'communities' }],
  },
  {
    type: 'revoke_community', icon: 'group_remove',
    label: 'Supprimer l\'accès à une communauté',
    description: 'Retire l\'accès d\'un contact à une communauté',
    params: [{ key: 'communityId', label: 'Communauté', type: 'resource', required: true, resource: 'communities' }],
  },
  {
    type: 'enroll_course_pack',   icon: 'pack_add',
    label: 'Inscrire à un pack de formations',
    description: 'Donne accès à un contact à un pack de formations',
    params: [{ key: 'packId', label: 'Pack', type: 'resource', required: true, resource: 'course_packs' }],
  },
  {
    type: 'revoke_course_pack',   icon: 'pack_remove',
    label: 'Supprimer l\'accès à un pack de formations',
    description: 'Retire l\'accès d\'un contact d\'un pack de formations',
    params: [{ key: 'packId', label: 'Pack', type: 'resource', required: true, resource: 'course_packs' }],
  },
  {
    type: 'add_to_pipeline_stage', icon: 'pipeline',
    label: 'Ajouter à une étape du pipeline',
    description: 'Ajouter ou déplacer un contact vers une étape du pipeline',
    params: [
      { key: 'pipelineId', label: 'Pipeline', type: 'resource', required: true, resource: 'pipelines' },
      { key: 'stageId',    label: 'Étape',    type: 'resource', required: true, resource: 'pipeline_stages' },
      { key: 'dealTitle',  label: 'Titre du deal', type: 'text', required: false },
    ],
  },
];

export function getAutomationCatalog() {
  return { triggers: GLOBAL_TRIGGERS, actions: GLOBAL_ACTIONS };
}

// Grouper les déclencheurs par catégorie pour l'affichage frontend
export function getTriggersGrouped() {
  const groups: Record<string, typeof GLOBAL_TRIGGERS> = {};
  for (const t of GLOBAL_TRIGGERS) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  return groups;
}
