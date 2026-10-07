# Thumbnail Forge 5.1.5

Correctif du démarrage Flow et utilisation d’un seul projet pour toutes les générations.

## Installer la mise à jour

1. Garder une copie de votre dossier actuel et, si souhaité, exporter la sauvegarde Forge.
2. Extraire le ZIP et copier son contenu dans le même dossier déjà chargé dans Chrome, en remplaçant les fichiers.
3. Cliquer sur Recharger dans chrome://extensions pour Thumbnail Forge, puis actualiser l’onglet Flow. Garder le même dossier conserve l’identité Chrome et le stockage de l’extension.

## Un projet pour toutes vos miniatures

Au premier lancement, Forge réutilise un projet Flow ouvert. Si aucun projet n’est ouvert, il utilise l’onglet d’accueil existant, ou en ouvre un, et demande un premier projet une seule fois. L’éditeur doit être prêt avant toute préparation.

L’URL du projet est mémorisée avant l’import des images. Toutes les générations suivantes, même avec une autre miniature de référence, reviennent dans ce projet. Si son onglet a été fermé, Forge ouvre son URL : il ne crée pas un nouveau projet.

Pour choisir explicitement un autre projet, coller son URL complète dans l’adresse Flow des paramètres. Cette URL a priorité sur le projet mémorisé. Pour réutiliser votre projet actuel lors de la première mise à jour, ouvrir d’abord ce projet dans Flow.

Si une demande de création du premier projet a été interrompue, Forge garde cette demande en mémoire et ne clique pas une nouvelle fois sur Nouveau projet. Attendre la navigation ou ouvrir manuellement le projet dans l’onglet Flow, puis relancer.

## Modèles et préparation

Modèle sélectionnable dans le studio et les paramètres : Nano Banana Pro, Nano Banana 2 Lite, Nano Banana 2.1. Le défaut est 2.1. L’ancien réglage Nano Banana 2 est migré vers 2.1. Le nombre de résultats reste fixé à quatre.

Le panneau de préférences est fermé par son bouton avant la saisie du prompt et avant l’envoi. Les menus imbriqués utilisent Échap. Les clics doivent atteindre une portion visible du contrôle ; une obstruction complète arrête le processus.

Forge mémorise le prompt et les références effectivement préparés. Une préparation interrompue peut reprendre si les entrées et le brouillon correspondent exactement. Les anciennes références d’une génération Forge terminée sont retirées individuellement avant la suivante. Une image ou un brouillon modifié manuellement n’est pas écrasé : le message demande de vider le brouillon dans le même projet.

Un changement de projet pendant la tâche arrête le contrôleur. Une génération dont l’envoi est déjà enregistré n’est pas soumise à nouveau automatiquement après un rechargement.

## Validation

Voir VALIDATION.md. Les essais locaux passent ; l’intégration Google authentifiée, le DOM exact de votre compte et les téléchargements Chrome natifs ne sont pas déclarés vérifiés. Aucun tarif fixe n’est déduit du « 0 crédits » de la capture : le tarif applicable est celui affiché par votre compte Flow.
