// Les primitives que le pipeline et l'inspecteur partagent : statuts, pastilles, icones,
// etats vides. Elles vivent ici plutot que dans l'un des deux, qui devrait alors importer
// l'autre — et un cycle d'imports pour deux pastilles serait cher paye.

export const STATUT = {
  enAttente: 'en_attente',
  enCours: 'en_cours',
  reussi: 'reussi',
  degrade: 'degrade',
  enErreur: 'en_erreur',
}

export const GENRE_APERCU = {
  image: 'image',
  cadres: 'cadres',
  donnees: 'donnees',
}

export const LIBELLE_STATUT = {
  [STATUT.enAttente]: 'En attente',
  [STATUT.enCours]: 'En cours',
  [STATUT.reussi]: 'Réussi',
  [STATUT.degrade]: 'Dégradé',
  [STATUT.enErreur]: 'En erreur',
}

export const LIBELLE_COMPTE = {
  [STATUT.reussi]: (n) => (n > 1 ? 'réussies' : 'réussie'),
  [STATUT.degrade]: (n) => (n > 1 ? 'dégradées' : 'dégradée'),
  [STATUT.enErreur]: () => 'en erreur',
}

// Un signe par verdict, en plus de la couleur : lisible en niveaux de gris, et lisible pour
// qui ne distingue pas l'ambre du vert.
export const SIGNE = {
  [STATUT.reussi]: 'M3.5 8.4 6.4 11.2 12.5 5',
  [STATUT.degrade]: 'M8 4.4v4.2M8 11.3v.02',
  [STATUT.enErreur]: 'M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4',
}

export const FLECHE = 'M2.5 8h11M9.5 4l4 4-4 4'
export const ALERTE =
  'M8 5.4v3.2M8 11.1v.02M6.8 2.4 1.6 11.2A1.4 1.4 0 0 0 2.8 13.4h10.4a1.4 1.4 0 0 0 1.2-2.2L9.2 2.4a1.4 1.4 0 0 0-2.4 0z'

export const $ = (id) => document.getElementById(id)

export const cle = (etape, sousEtape) => `${etape}/${sousEtape}`

export const acheve = (statut) => statut !== STATUT.enAttente && statut !== STATUT.enCours

export function formaterPoids(octets) {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`
  return `${(octets / 1024 / 1024).toFixed(2)} Mo`
}

// Le meme json colore partout ou du json s'affiche : la sortie brute de l'inspecteur et les
// tableaux deplies du produit doivent se lire pareil.
export function colorerJson(json) {
  return json
    .replace(/[&<>]/g, (caractere) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[caractere])
    .replace(/"([^"]+)":/g, '<span class="cle">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="txt">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="num">$1</span>')
}

// Deux decimales sous la milliseconde : au dixieme, toutes les sous-etapes rapides
// s'afficheraient a 0,0 ms et deviendraient incomparables entre elles.
export const formaterMs = (ms) => `${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`

export function icone(chemin, taille = 13) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', taille)
  svg.setAttribute('height', taille)
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const trace = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  trace.setAttribute('d', chemin)
  svg.append(trace)
  return svg
}

export function remplirBadge(badge, statut) {
  badge.dataset.statut = statut
  badge.textContent = ''
  if (SIGNE[statut] !== undefined) badge.append(icone(SIGNE[statut], 12))
  badge.append(LIBELLE_STATUT[statut])
  return badge
}

export function badgeStatut(statut) {
  const badge = document.createElement('span')
  badge.className = 'badge'
  return remplirBadge(badge, statut)
}

// Une pastille pleine PORTANT UN SIGNE, jamais un simple point colore.
export function pastilleStatut(statut, taille = 17) {
  const puce = document.createElement('span')
  puce.className = 'puce'
  puce.style.width = `${taille}px`
  puce.style.height = `${taille}px`
  if (statut === STATUT.enAttente) puce.classList.add('creuse')
  else if (statut === STATUT.enCours) puce.classList.add('tourne')
  else puce.append(icone(SIGNE[statut], Math.round(taille * 0.66)))
  return puce
}

// Sous sa ligne, exactement a sa largeur, texte aligne sous le nom : c'est la mise en page qui
// dit a quoi le message se rapporte.
export function ligneMotif(statut, texte, taille = 13) {
  const motif = document.createElement('p')
  motif.className = statut === STATUT.enErreur ? 'motif grave' : 'motif'
  motif.append(icone(ALERTE, taille), texte)
  return motif
}

export function etatVide(titre, texte) {
  const vide = document.createElement('div')
  vide.className = 'vide'
  const fort = document.createElement('strong')
  fort.textContent = titre
  const paragraphe = document.createElement('p')
  paragraphe.textContent = texte
  vide.append(fort, paragraphe)
  return vide
}

export function jetonMeta(nom, valeur) {
  const jeton = document.createElement('span')
  jeton.className = 'jeton-meta'
  const gras = document.createElement('b')
  gras.textContent = valeur
  jeton.append(`${nom}`, gras)
  return jeton
}

// ------------------------------------------------------------- lecture de l'avancement
// Le plan dit ce qui doit arriver, les traces disent ce qui est arrive : tout l'etat visible
// se deduit de ces deux-la, et de rien d'autre.

export const traceDe = (etat, etape, sousEtape) => etat.traces.get(cle(etape, sousEtape))

// La premiere sous-etape du plan dont aucune trace n'est arrivee. Le pipeline est sequentiel :
// tant qu'il tourne, c'est donc elle qui travaille. Sans cette deduction, rien ne pourrait
// s'afficher « en cours », puisqu'un evenement n'arrive qu'une fois la sous-etape terminee.
export function prochaineSousEtape(etat) {
  for (const definition of etat.plan.etapes) {
    for (const sousEtape of definition.sousEtapes) {
      if (traceDe(etat, definition.etape, sousEtape) === undefined) {
        return cle(definition.etape, sousEtape)
      }
    }
  }
  return null
}

// Une sous-etape absente de la Map est en attente : l'evenement recu porte deja son statut, sa
// duree, son motif et ses apercus, donc rien a pre-remplir ni a tenir a jour.
export function statutSousEtape(etat, etape, sousEtape) {
  const trace = traceDe(etat, etape, sousEtape)
  if (trace !== undefined) return trace.statut
  if (etat.enMarche && prochaineSousEtape(etat) === cle(etape, sousEtape)) return STATUT.enCours
  return STATUT.enAttente
}

// Le verdict de l'etape est celui de ses sous-etapes : la pire l'emporte, parce que c'est elle
// qui demande une action.
export function statutEtape(etat, definition) {
  const statuts = definition.sousEtapes.map((sousEtape) =>
    statutSousEtape(etat, definition.etape, sousEtape),
  )
  if (statuts.includes(STATUT.enErreur)) return STATUT.enErreur
  if (statuts.includes(STATUT.enCours)) return STATUT.enCours
  if (statuts.every((statut) => statut === STATUT.enAttente)) return STATUT.enAttente
  if (statuts.includes(STATUT.degrade)) return STATUT.degrade
  if (statuts.every((statut) => statut === STATUT.reussi)) return STATUT.reussi
  return STATUT.enCours
}

export function dureeEtape(etat, definition) {
  return definition.sousEtapes.reduce((somme, sousEtape) => {
    const trace = traceDe(etat, definition.etape, sousEtape)
    return somme + (trace === undefined ? 0 : trace.dureeMs)
  }, 0)
}

export function dureeTotale(etat) {
  return etat.plan.etapes.reduce((somme, definition) => somme + dureeEtape(etat, definition), 0)
}

export const estSelection = (etat, etape, sousEtape) =>
  etat.selection !== null &&
  etat.selection.etape === etape &&
  etat.selection.sousEtape === sousEtape
