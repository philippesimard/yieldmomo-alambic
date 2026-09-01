// Le rail : une carte par etape du plan, puis le produit qui le ferme. Rien ici ne sait
// combien d'etapes existent ni comment elles s'appellent — le plan le dit, la page le dessine.

import {
  $,
  acheve,
  badgeStatut,
  colorerJson,
  dureeEtape,
  estSelection,
  FLECHE,
  formaterMs,
  icone,
  LIBELLE_COMPTE,
  LIBELLE_STATUT,
  ligneMotif,
  pastilleStatut,
  STATUT,
  statutEtape,
  statutSousEtape,
  traceDe,
} from './commun.js'

export function rendrePipeline(etat) {
  rendreJauge(etat)
  rendreRail(etat)
  rendreNote(etat)
}

function rendreNote(etat) {
  const sousEtapes = etat.plan.etapes.flatMap((definition) => definition.sousEtapes)
  const faites = etat.traces.size

  $('pipeline-note').textContent =
    faites > 0
      ? `${faites} / ${sousEtapes.length} sous-étapes`
      : `${etat.plan.etapes.length} étapes · ${sousEtapes.length} sous-étapes`
}

function rendreJauge(etat) {
  const cases = $('cases')
  cases.textContent = ''

  for (const definition of etat.plan.etapes) {
    for (const sousEtape of definition.sousEtapes) {
      const statut = statutSousEtape(etat, definition.etape, sousEtape)
      const case_ = document.createElement('span')
      case_.className = 'case'
      case_.dataset.statut = statut
      case_.title = `${definition.etape} / ${sousEtape} — ${LIBELLE_STATUT[statut]}`
      cases.append(case_)
    }
  }

  const comptes = $('comptes')
  comptes.textContent = ''
  const verdicts = [...etat.traces.values()].map((trace) => trace.statut)

  // Seuls les verdicts acquis sont comptes : afficher « 0 en erreur » avant d'avoir distille
  // dirait quelque chose de faux.
  for (const statut of [STATUT.reussi, STATUT.degrade, STATUT.enErreur]) {
    const nombre = verdicts.filter((verdict) => verdict === statut).length
    if (nombre === 0) continue

    const compte = document.createElement('span')
    compte.className = 'compte'
    compte.dataset.statut = statut
    const pastille = document.createElement('span')
    pastille.className = 'pastille-legende'
    const nombreAffiche = document.createElement('b')
    nombreAffiche.textContent = String(nombre)
    compte.append(pastille, nombreAffiche, ` ${LIBELLE_COMPTE[statut](nombre)}`)
    comptes.append(compte)
  }
}

function rendreRail(etat) {
  const rail = $('rail')
  rail.textContent = ''

  etat.plan.etapes.forEach((definition, index) => {
    if (index > 0) rail.append(connecteur(etat, etat.plan.etapes[index - 1]))
    rail.append(carteEtape(etat, definition))
  })

  // Le produit ferme le rail : il n'est pas une etape, mais ce que la derniere d'entre elles
  // fabrique. Il reprend donc son verdict, au lieu d'en porter un a lui.
  const derniere = etat.plan.etapes.at(-1)
  if (derniere === undefined) return
  rail.append(connecteur(etat, derniere), carteProduit(etat, derniere))
}

function connecteur(etat, precedente) {
  const statut = statutEtape(etat, precedente)
  const flux = document.createElement('span')
  flux.className = 'flux'
  flux.dataset.actif = String(acheve(statut) && statut !== STATUT.enErreur)
  flux.append(icone(FLECHE, 15))
  return flux
}

function carteEtape(etat, definition) {
  const statut = statutEtape(etat, definition)

  const carte = document.createElement('article')
  carte.className = 'etape'
  carte.dataset.statut = statut

  const bande = document.createElement('span')
  bande.className = 'bande'

  const tete = document.createElement('div')
  tete.className = 'etape-tete'
  const titre = document.createElement('h3')
  titre.className = 'etape-nom'
  titre.textContent = definition.etape
  tete.append(titre, badgeStatut(statut))

  const chiffres = document.createElement('div')
  chiffres.className = 'etape-chiffres'
  const commencee = definition.sousEtapes.some(
    (sousEtape) => traceDe(etat, definition.etape, sousEtape) !== undefined,
  )
  chiffres.append(paireContrat(definition), paireMs(dureeEtape(etat, definition), commencee))

  carte.append(bande, tete, chiffres, listeSousEtapes(etat, definition))
  return carte
}

function listeSousEtapes(etat, definition) {
  const liste = document.createElement('ul')
  liste.className = 'sous-etapes'

  for (const sousEtape of definition.sousEtapes) {
    const statut = statutSousEtape(etat, definition.etape, sousEtape)
    const trace = traceDe(etat, definition.etape, sousEtape)

    const item = document.createElement('li')
    item.dataset.statut = statut

    const bouton = document.createElement('button')
    bouton.className = 'sous-etape'
    bouton.type = 'button'
    bouton.disabled = trace === undefined
    if (estSelection(etat, definition.etape, sousEtape)) bouton.setAttribute('aria-current', 'true')
    bouton.addEventListener('click', () => etat.selectionner(definition.etape, sousEtape))

    const nom = document.createElement('span')
    nom.className = 'sous-nom'
    nom.textContent = sousEtape

    const duree = document.createElement('span')
    duree.className = 'sous-ms'
    duree.textContent = trace === undefined ? '' : formaterMs(trace.dureeMs)

    bouton.append(pastilleStatut(statut), nom, duree)
    item.append(bouton)

    if (trace?.motif !== undefined) item.append(ligneMotif(statut, trace.motif))

    liste.append(item)
  }

  return liste
}

function paireContrat({ entree, sortie }) {
  const paire = document.createElement('span')
  const gauche = document.createElement('b')
  gauche.textContent = entree
  const droite = document.createElement('b')
  droite.textContent = sortie
  paire.append(gauche, ' → ', droite)
  return paire
}

// Un tiret tant que rien n'a tourne, une duree des qu'une sous-etape a rendu son verdict :
// une etape mesuree a 0,00 ms est une information, une etape sans mesure en est une autre.
function paireMs(ms, commencee) {
  const paire = document.createElement('span')
  paire.style.marginLeft = 'auto'
  if (!commencee) {
    paire.textContent = '—'
    return paire
  }
  const gras = document.createElement('b')
  gras.textContent = formaterMs(ms)
  paire.append(gras)
  return paire
}

// La carte du produit est agnostique : elle affiche les cles de l'objet recu, sans savoir ce
// qu'est cet objet. Son titre et son schema viennent du plan, jamais d'ici.
function carteProduit(etat, derniere) {
  const carte = document.createElement('article')
  carte.className = 'etape produit'
  carte.dataset.statut = statutEtape(etat, derniere)

  const bande = document.createElement('span')
  bande.className = 'bande'

  const tete = document.createElement('div')
  tete.className = 'etape-tete'
  const titre = document.createElement('h3')
  titre.className = 'etape-nom'
  titre.textContent = etat.plan.produit.nom
  tete.append(titre)

  const champs = etat.produit === null ? [] : Object.entries(etat.produit)
  const renseignes = champs.filter(([, valeur]) => estRenseigne(valeur)).length

  const chiffres = document.createElement('div')
  chiffres.className = 'etape-chiffres'
  const schema = document.createElement('span')
  const nomSchema = document.createElement('b')
  nomSchema.textContent = etat.plan.produit.schema
  schema.append(nomSchema)
  const compte = document.createElement('span')
  compte.style.marginLeft = 'auto'
  const nombre = document.createElement('b')
  nombre.textContent = champs.length === 0 ? '—' : `${renseignes} / ${champs.length}`
  compte.append(nombre, ' champs')
  chiffres.append(schema, compte)

  carte.append(bande, tete, chiffres)

  if (champs.length === 0) {
    const attente = document.createElement('p')
    attente.className = 'produit-attente'
    attente.textContent = 'Le produit apparaît quand la distillation aboutit.'
    carte.append(attente)
    return carte
  }

  const grille = document.createElement('dl')
  grille.className = 'produit-grille'

  for (const [nom, valeur] of champs) {
    const terme = document.createElement('dt')
    terme.textContent = nom
    const definition = document.createElement('dd')
    definition.className = estRenseigne(valeur) ? 'reconnu' : 'nul'
    if (Array.isArray(valeur) && valeur.length > 0) {
      definition.append(deroulantTableau(valeur))
    } else {
      definition.textContent = texteValeur(valeur)
    }
    grille.append(terme, definition)
  }

  carte.append(grille)
  return carte
}

const estRenseigne = (valeur) =>
  valeur !== null &&
  valeur !== undefined &&
  valeur !== '' &&
  !(Array.isArray(valeur) && valeur.length === 0)

// Un tableau (taxes, articles) se deplie sur place : son compte seul cacherait justement ce
// qu'on vient verifier. Le contenu se rend en json structure, colore comme la sortie brute de
// l'inspecteur : un seul format de lecture pour tout le hublot.
function deroulantTableau(valeurs) {
  const deroulant = document.createElement('details')
  const resume = document.createElement('summary')
  resume.textContent = `[${valeurs.length}]`

  const json = document.createElement('pre')
  json.className = 'produit-json'
  json.innerHTML = colorerJson(JSON.stringify(valeurs, null, 2))

  deroulant.append(resume, json)
  return deroulant
}

// Rendre lisible une valeur dont on ne sait rien : un tableau donne son compte, un objet plat
// ses valeurs separees, un nombre s'arrondit a l'affichage, tout le reste se lit tel quel.
function texteValeur(valeur) {
  if (valeur === null || valeur === undefined) return 'null'
  if (Array.isArray(valeur)) return valeur.length === 0 ? '[]' : `[${valeur.length}]`
  if (typeof valeur === 'object') return Object.values(valeur).map(texteValeur).join(' · ')
  if (typeof valeur === 'number') return String(Math.round(valeur * 10000) / 10000)
  return String(valeur)
}
