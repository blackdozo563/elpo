# 5.1.5

Projet commun persistant, ouverture initiale attendue et sans demande répétée, fermeture vérifiée des préférences, modèles image sélectionnables, checkpoints de préparation et protection du projet courant. Voir VALIDATION.md.

# Version 5.1.4 — lecture du résultat exact et crédits

- Suppression du refus d’export fondé sur le projet mémorisé, le chemin de l’onglet ou une URL de navigation transitoire.
- Lecture liée au document Chrome et à l’adresse exacte de l’image rendue dans le cadre principal de l’onglet du lot ; la page courante doit être Flow.
- Erreurs distinctes : onglet fermé, document remplacé, page hors Flow, résultat absent, lecteur Chrome indisponible. L’échec d’accès au lecteur Chrome ne provoque pas de nouvelle requête pouvant perdre le cache.
- Version d’exécution enregistrée par tentative ; anciens messages identifiés dans le studio.
- Version installée visible et crédits : MADE BY ELPO 00228 71 82 59 18.
- Numérotation, PNG, logo et mécanisme de génération conservés.

# Version 5.1.3 — faux changement de projet pendant l’export

- URL du projet issue de location.href au moment des résultats ; sender.url n’est plus utilisé comme adresse de projet.
- Comparaison de l’identifiant de projet, avec ses vues de détail et slash final.
- Récupération des anciens lots par preuve de l’image exacte dans l’onglet du lot, puis confirmation du projet ; les métadonnées historiques non vérifiées ne bloquent plus la reprise.
- Contrôle du DOM courant avant/après lecture du cache ; l’ancienne route portée par le cache ne constitue plus une preuve de changement de projet.
- Diagnostic : identité enregistrée et actuelle, confirmation, code et phase du refus ; disparition de l’image distincte d’une navigation.
- Aucun nouveau clic de génération ni permission supplémentaire.

# Version 5.1.2 — récupération des images Flow

- Repli de lecture depuis l’onglet du lot lorsque l’adresse de résultat est inaccessible directement : canvas, ressource image déjà chargée dans Chrome, puis fetch de page autorisé par CORS si nécessaire.
- Reprise des exports échoués de la génération courante, sans relancer de génération ; noms numérotés, logo et anti-doublons conservés.
- Lecture limitée à la source exacte du résultat affiché, avec contrôle d’onglet/projet, de format et de taille ; aucune permission de site supplémentaire.
- Protection contre le détachement du débogueur pendant la lecture du cache.
- Diagnostic des exports : protocole/hôte, état et méthode de récupération, sans paramètres d’URL signée.
- Contrôleur de génération 5.1.1 conservé ; nouveau lecteur indépendant d’un ancien script déjà présent dans Flow.

# 5.1.1 — Correction du blocage à l’étape 3

Diagnostic reçu : prompt DIV trouvé, bouton génération absent, liste de contrôles locale vide, aucune pièce jointe détectée, mais Nano Banana 2 / 16:9 / x4 reconnus globalement.

- Suppression des limites de hauteur 70 % et profondeur 7 dans la recherche du compositeur ; la recherche suit les ancêtres pertinents avec une borne de 24.
- Conservation d’un panneau identifié après l’agrandissement du prompt.
- Recherche commune des boutons, réglages et pièces jointes, y compris lorsque le formulaire entoure seulement le champ.
- Détection des noms accessibles, de contrôles identifiés et icônes de génération ; absence de fallback aveugle sur un submit ou sur la touche Entrée.
- Arrêt en cas d’ambiguïté entre deux boutons ; exclusion des actions de projet, vidéo, menus, résultats, sauvegarde et suppression.
- Attente de disponibilité de 20 secondes ; distinction bouton absent / ambigu / désactivé.
- Diagnostic enrichi : conteneur, candidats et contrôles proches, sans recopier le prompt ni les données image.
- État de soumission sauvegardé avant le clic, vérifications du brouillon et des références maintenues.

La cause est déduite du diagnostic et reproduite sur des pages locales. Le DOM réel du compte n’a pas été capturé. Voir `validation/flow-5.1.1.json` et `VALIDATION.md`.

---

# 5.1.0 — Exports numérotés et logo de chaîne

- Téléchargement automatique configurable des résultats détectés, sans dépendre de l’ouverture du studio.
- Numéro de lancement persistant et numéro de résultat en préfixe : `0001_01_miniature.png`.
- Nom de base personnalisable ; conversion réelle en PNG.
- États de téléchargement persistants, confirmation par Chrome et reprise manuelle des erreurs sans régénération.
- Bouton pour télécharger les résultats manquants.
- Logo existant rendu plus visible : activer/désactiver, remplacer, supprimer, choisir coin et taille.
- Mode historique intégré par Flow conservé ; mode optionnel logo fidèle par incrustation locale à l’export.
- Instantané des réglages et du logo au lancement.
- Moteur Flow V5.0.1 conservé, notamment les garde-fous contre un double envoi payant.
- Nouveaux accès limités aux serveurs d’images Google pour la conversion PNG lorsque nécessaire.
- Documentation de mise à jour avec préservation des données.

Les essais exécutés pour cette livraison sont documentés dans `VALIDATION.md` ; les notes ci-dessous sont l’historique original fourni.

---

# 5.0.1 — Correctif de compatibilité Flow

Diagnostic utilisateur : Flow présente un éditeur DIV, le modèle Nano Banana 2 sélectionné, un contrôle Settings trigger indiquant crop_16_9 et x4, et un bouton Start generation. Aucun bouton Image distinct n’est présent.

- Le modèle Nano Banana 2 déjà sélectionné dans la barre du composeur prouve le mode Image; une option non sélectionnée dans un menu ne suffit pas.
- Reconnaissance de Start generation et Lancer la génération, ainsi que de l’icône arrow_forward dans le composeur.
- Reconnaissance de crop_16_9, crop_9_16 et crop_square comme valeurs de format.
- Le mot ratio doit être complet : il ne peut plus faire correspondre le bouton geneRATION au réglage du format.
- Conservation des paramètres déjà vérifiés, sans ouvrir inutilement le menu des modèles.
- Le vrai bouton Settings est préféré au sous-menu Select model family.
- Si Agent est explicitement activé, une tentative de désactivation est vérifiée avant l’envoi; un état restant actif bloque la génération.
- Diagnostic enrichi avec le contrôle utilisé pour chaque réglage et l’origine de la détection du mode Image.

Les vérifications de référence jointe, prompt conservé, quatre sorties et anti-doublons restent en place.

# 5.0.0 — 27 septembre 2026

Refonte du studio et du parcours d’automatisation Flow.

## Corrections V3/V4

- La capture n’est plus limitée à l’URL de la vidéo ouverte : gestion des cartes YouTube et navigations SPA.
- Les textes A/B/C sont saisis dans l’extension et intégrés dans un seul prompt avec la référence.
- L’action principale lance une tâche persistante; elle ne se contente plus d’ouvrir Flow.
- Le transfert d’un fichier n’est plus considéré réussi sur le seul acquittement d’un événement DOM.
- Le modèle, le format, le mode Image et quatre sorties font l’objet de contrôles explicites.
- Les zones sont sauvegardées avant le lancement. Le prompt et les fichiers sont figés pour la tâche.
- Une erreur d’écriture ne bloque pas toutes les écritures suivantes.
- Une tâche est marquée prise en charge avant transmission pour éviter une relance après un acquittement perdu.
- Un arrêt reste terminal même si une réponse tardive arrive.

## Interface

Palette graphite et citron, formulaires lisibles, référence visible, galerie, import, logo, aperçu prompt, formats, studio grand écran, résultats, historique, diagnostics et messages d’erreur persistants.

## Limite

Automatisation de l’interface web, sans API privée. Les mises à jour Google peuvent exiger une adaptation des sélecteurs. Installation et tests locaux : voir VALIDATION.md; pas de génération réelle authentifiée dans cette livraison.
