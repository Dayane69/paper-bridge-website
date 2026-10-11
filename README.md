# Pont de papier

Interface à projeter en classe pour le défi du pont en papier : chaque groupe dispose d'un budget, achète son matériel (feuilles, scotch, coups de ciseaux…) sur un marché dont les prix montent quand le stock baisse, et peut revendre ce qu'il n'utilise pas à moitié prix.

Le professeur est seul à saisir les opérations, sur l'ordinateur relié au vidéoprojecteur. Il n'y a ni serveur ni compte : tout est enregistré dans le navigateur.

## Lancer l'interface

- **Sans internet** : télécharger le dépôt et ouvrir `index.html` dans Chrome, Edge ou Firefox. (Sans connexion, les polices sont remplacées par celles du système.)
- **En ligne avec Vercel** : sur vercel.com, *Add New… → Project*, importer ce dépôt GitHub, laisser *Framework Preset* sur **Other**, sans commande de build ni dossier de sortie, puis *Deploy*. C'est un site statique : aucune configuration n'est nécessaire. Chaque push sur `main` redéploie le site.
- **En ligne avec GitHub Pages** : Settings → Pages → *Deploy from a branch* → `main` / `root`. L'adresse sera `https://<compte>.github.io/paper-bridge-website/`.

Les données restent dans le navigateur de l'ordinateur utilisé. Elles survivent à un rechargement de la page ou à un redémarrage, mais pas à un changement d'ordinateur ou de navigateur. Même en ligne, chaque PC de salle a donc sa propre séance : il faut mener toute la séance sur le même PC.

## Pendant la séance

| Vue | À quoi elle sert |
| --- | --- |
| **Marché** | Écran à projeter : cours de chaque article, stock restant, solde de chaque groupe et ce qu'il possède. Cliquer sur un groupe ouvre sa caisse. |
| **Caisse d'un groupe** | Choisir la quantité, puis *Acheter* ou *Revendre*. Le montant exact est affiché sur le bouton. *Ajustement* permet de donner ou retirer de l'argent (bonus, pénalité). |
| **Résultats** | Saisir le poids tenu par chaque pont (en grammes). Le classement se calcule tout seul : **score = grammes tenus ÷ euros dépensés**. |
| **Réglages** | Distance, poids à tenir, budget, taux de revente, groupes, articles et prix. Journal de toutes les opérations. Remise à zéro. |

Bandeau du bas : dernières opérations, bouton **↶ Annuler** (ou Ctrl+Z), taille du texte (**A− / A+**), thème clair/sombre et plein écran.

La distance et le poids à tenir s'affichent « ? » tant qu'ils ne sont pas saisis dans Réglages.

## Comment les prix évoluent

Chaque article a un prix de départ, un stock initial et une hausse maximale (en %).

- Stock plein → prix de départ.
- Stock vide → prix de départ × (1 + hausse) (prix maximal, jamais tout à fait atteint).
- Entre les deux, le prix monte de façon régulière à chaque unité achetée, quel que soit le groupe acheteur.
- Revendre rend l'unité au stock (ce qui fait redescendre le prix) et rapporte 50 % du prix actuel (réglable).
- Un article sans stock initial est illimité, à prix fixe (par exemple le coup de ciseaux).

Exemple avec les réglages d'origine : 50 feuilles A4 à 0,50 € avec une hausse de 150 % coûtent 0,50 € au début, 1,10 € quand il en reste 10 et 1,23 € pour la dernière.

Réglages d'origine :

| Article | Prix de départ | Stock | Hausse max | Revendable |
| --- | --- | --- | --- | --- |
| Feuille A4 | 0,50 € | 50 | 150 % | oui |
| Scotch 5 cm | 0,15 € | 60 | 100 % | oui |
| Scotch 10 cm | 0,30 € | 40 | 100 % | oui |
| Coup de ciseaux | 0,40 € | illimité | – | non |

Budget : 5 € par groupe, 6 groupes.

## Fichiers

- `index.html` : structure de la page
- `style.css` : mise en forme (grands caractères, lisible au vidéoprojecteur)
- `app.js` : logique du marché, des groupes et du classement
