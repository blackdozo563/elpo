# ELPODNA 0.2 — validation et parité

La version 0.2 reprend les fichiers d’interface et le moteur Flow de l’archive ViralDNA Auto Flow fournie par l’utilisateur, avec l’identité ELPODNA et sa palette menthe/or. Les dispositions, six onglets, cartes, réglages, associations, tris et dialogues métier proviennent de cette archive. Il ne s’agit plus de l’interface simplifiée 0.1.

## Correction du blocage signalé

Le compositeur principal est sélectionné par sa position horizontale lorsqu’un panneau agent ajoute un deuxième bouton `settings-trigger-button`. Flow Material v2 est traité avec `flow-prompt-box-settings`, les groupes radio et les icônes `image`, `videocam`, `crop_free` et `chrome_extension`. Les chemins legacy Radix du moteur fourni sont conservés. Le mode est appliqué avant le modèle, puis le format, la résolution, la durée et la quantité. Un modèle absent, un bouton désactivé, une sélection ambiguë ou un réglage non confirmé arrête le lot avant l’envoi. Le moteur source pouvait ignorer un échec d’application ; ce défaut est corrigé. Le panneau propose un diagnostic sans envoyer de prompt.

## Preuves de cette version

- `npm test` : 29 tests passés, aucun échec ni test ignoré. Inclut le démarrage simulé du worker classic effectivement déclaré dans le manifest et le chargement de son pont studio.
- `node tests/parity-browser.mjs` : 46 scénarios passés sur l’interface livrée et la fonction de réglages du moteur livré. Modèles image/vidéo, formats, quantités, usages vidéo, durées 4/6/8/10, résolutions 360p/720p, deuxième compositeur, refus des options absentes, navigation, blocs de prompts, import bibliothèque, associations manuelles/Auto-Tag, payload envoyé au worker, paires/chaînes, WAV/SRT, réponse Gemini atomique, clipboard refusé, export MP4, sauvegarde/restauration/reset/undo et migration 0.1.
- Export réellement produit par le studio : H.264 1280×720 et AAC, durée 2,043356 secondes ; inspection ffprobe. Les exports longs et tous les ratios ne sont pas déclarés validés par ce seul cas.
- Audit statique : les 88 sélecteurs statiques du moteur Flow et les 8 du content-script fournis sont conservés. Les 202 IDs du panneau sont conservés. Dans le studio, 121 des 132 IDs sont conservés ; les 11 supprimés concernent l’accès au service commercial de la référence. La présence d’un sélecteur n’est pas une preuve de correspondance avec le site Google actuel. Inventaire : `SELECTEURS_V02.json`.

Les comptes Chrome, scripts, IDs et requêtes Flow des tests sont simulés. Aucune génération Google réelle, aucune dépense et aucun appel au backend commercial ViralDNA n’ont été effectués. L’installation native reste interdite par la politique Chromium du cloud (`ExtensionInstallBlocklist: ["*"]`). Cette politique n’a pas été contournée. Les uploads réels, médias tardifs, téléchargements/upscales Google, suspension native du worker, compte authentifié et poids Whisper doivent encore être validés sur une machine autorisée. Le lien chatgpt.com/local fourni n’est pas accessible depuis ce cloud (proxy 403).

## Différences explicites

- ELPODNA utilise le compte Google déjà ouvert dans Flow ; aucun service d’authentification, abonnement, paiement ou solde de jetons ViralDNA n’est cloné. Le bouton de compte ouvre Flow. Le bouton + du studio ouvre la gestion de projets.
- Conception/réécriture Gemini : compte web de l’utilisateur, demande copiée (ou fichier texte si clipboard refusé), envoi confirmé sur Gemini et JSON validé avant remplacement. Cela conserve le parcours accepté dans la version précédente, au lieu d’appeler le serveur payant de la référence. La correction automatique préalable de transcription du service payant n’est pas reproduite ; les textes peuvent être corrigés sur Gemini puis réimportés en SRT/VTT.
- Export audio : encodeur AAC local déjà vérifié, pour fonctionner même si Chromium n’offre pas d’AAC natif.
- Anciennes données ELPODNA : migration non destructive vers le studio 0.2 et sa bibliothèque ; import `.elpodna` et `.afstory`. L’identité d’extension doit rester identique pour accéder aux données locales.

Le tableau fonction par fonction est `PARITE_V02.csv`. Les preuves 0.1 conservées dans `VALIDATION_V01.md` sont historiques, distinctes des essais de cette version. Aucune garantie de zéro bug ni de compatibilité future avec toutes les mises à jour Google n’est formulée.
