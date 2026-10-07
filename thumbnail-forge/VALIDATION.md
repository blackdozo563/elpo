# Validation Thumbnail Forge 5.1.5

Base : archive Thumbnail-Forge-V5.1.4 GPT6 ASTRA.zip fournie par l’utilisateur. Les documents de cette archive servent de contexte ; la demande utilisateur définit les corrections.

## Corrections

- start() ne crée plus systématiquement un onglet. Le premier projet est réutilisé et mémorisé dans flowProjectUrl pour toutes les miniatures.
- Le projet est enregistré au checkpoint project-ready, avant les imports ; sa vérification ne dépend plus de la réception de résultats.
- Une création du premier projet déjà demandée est mémorisée dans flowCreationPending. La reprise après une navigation réexpédie uniquement la préparation non soumise ; elle ne redemande pas un nouveau projet.
- L’éditeur attend son identité de projet, son prompt, ses contrôles de génération et son bouton de réglages avant la préparation.
- Fermeture du panneau Material par son déclencheur, menus imbriqués par Échap, et vérification de fermeture avant prompt/envoi.
- Sélection exacte Pro / 2 Lite / 2.1 ; choix persistant dans le studio et les paramètres. L’ancien défaut 2 est migré vers 2.1.
- Snapshots de préparation pour reprendre sans doubler les références et remplacer les anciennes références Forge avant une autre génération dans le même projet. Les brouillons étrangers restent protégés.
- Les clics vérifient la visibilité de leur cible. Le projet est contrôlé avant l’import et les actions suivantes. Les checkpoints d’envoi et refus d’une resoumission automatique sont conservés.

## Essais du code livré

- validation/background-5.1.5.json : 252 vérifications passées du worker avec API Chrome simulée. Réutilisation du projet après changement de référence, projet enregistré avant résultats, réouverture de son URL si l’onglet est fermé, navigation initiale et absence de relance après soumission, création en attente, exports et téléchargements simulés.
- validation/flow-5.1.5.json : 19 scénarios Chromium passés. Accueil vers premier projet, menus Material ignorants Échap, modèles exacts, reprise d’un brouillon Forge, deux générations dans un projet, brouillon utilisateur protégé, changement de projet, obstruction complète, bouton désactivé, ambiguïté, checkpoint refusé, duplication et parcours existants.
- validation/ui-5.1.5.json : 26 contrôles passés de l’interface et des données partagées, incluant la persistance des trois modèles et les largeurs du panneau. Les contrôles shared font aussi l’objet du rapport partagé ; ces comptes ne sont pas présentés comme des tests indépendants additionnables.
- validation/result-reader-5.1.5.json : 36 scénarios passés du lecteur d’images. DOM, canvas, CORS, fetch, cache CDP et navigation sont exercés avec ressources locales. Le transport chrome.scripting reste simulé.

Les fixtures utilisent Chromium réel pour les DOM, événements, saisies et canvas, mais reproduisent une interface Flow synthétique. Elles ne constituent pas une capture du DOM Google actuel. Les API de l’extension sont simulées. Aucun compte Google, crédit, endpoint privé ni génération externe n’a été utilisé.

Le cloud impose un blocage du chargement natif des extensions Chrome. Cette politique n’a pas été contournée. Restent à confirmer sur un navigateur autorisé : le compte authentifié, les chargements réels de Flow, ses uploads, la durée de génération et les téléchargements natifs. Les pièces de preuve historiques 5.1.4 de l’archive fournie ne sont pas des preuves du correctif actuel.

## Reproduire les essais

Node et Playwright, avec Chromium disponible :

```sh
node validation/test-background.cjs
node validation/test-shared.cjs
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/chemin/node_modules CHROMIUM_EXECUTABLE=/chemin/chromium node validation/test-flow-5.1.5.cjs
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/chemin/node_modules CHROMIUM_EXECUTABLE=/chemin/chromium node validation/test-browser.cjs
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/chemin/node_modules CHROMIUM_EXECUTABLE=/chemin/chromium node validation/test-result-reader.cjs
```

Les fixtures peuvent aussi résoudre Playwright installé normalement dans node_modules. Les tests n’envoient pas de requêtes de génération Google.
