// L'etat de la page, les evenements du DOM, et l'assemblage des deux. Le hublot se nourrit du
// pipeline, il ne le connait pas : tout ce qu'il sait vient du plan et des traces.

import { $, cle, formaterPoids, STATUT } from './commun.js'
import { chargerPlan, distiller, GENRE } from './flux.js'
import { rendreInspecteur } from './inspecteur.js'
import { rendrePipeline } from './pipeline.js'

const CODE_FLUX_INTERROMPU = 'flux_interrompu'

const etat = {
  plan: null,
  // Une seule Map : l'evenement recu porte deja statut, duree, motif et apercus. Une sous-etape
  // absente est en attente — rien a pre-remplir ni a tenir a jour.
  traces: new Map(),
  selection: null,
  // Le File est garde en memoire pour le bouton Relancer : le service etant sans etat, rien ne
  // subsiste d'une distillation a l'autre cote serveur.
  fichier: null,
  // Trois etats de plus, et pas un de moins : aucun ne se deduit des traces.
  enMarche: false,
  produit: null,
  echec: null,
  selectionner,
}

function selectionner(etape, sousEtape) {
  etat.selection = { etape, sousEtape }
  rendre()
}

function rendre() {
  if (etat.plan === null) return
  rendrePipeline(etat)
  rendreInspecteur(etat)
}

function rendreFanions() {
  const hote = $('fanions')
  hote.textContent = ''
  for (const texte of etat.plan.fanions) {
    const fanion = document.createElement('span')
    fanion.className = 'fanion'
    fanion.textContent = texte
    hote.append(fanion)
  }
}

function choisir(fichier) {
  etat.fichier = fichier
  $('source-nom').textContent = fichier.name
  $('source-note').textContent = `${formaterPoids(fichier.size)} · prêt`
  $('distiller').disabled = false
}

function noter(suffixe) {
  if (etat.fichier === null) return
  $('source-note').textContent = `${formaterPoids(etat.fichier.size)} · ${suffixe}`
}

// L'evenement arrive deja aplati et porte tout ce qu'il faut : on le range tel quel, sans le
// recomposer. Son champ `genre` reste attache, sans consequence.
function recevoir(evenement) {
  if (evenement.genre === GENRE.trace) {
    etat.traces.set(cle(evenement.etape, evenement.sousEtape), evenement)
    // La premiere sous-etape achevee s'ouvre d'elle-meme, et une erreur prend la main : dans
    // les deux cas, c'est ce qu'on veut avoir sous les yeux sans avoir a cliquer.
    if (etat.selection === null || evenement.statut === STATUT.enErreur) {
      etat.selection = { etape: evenement.etape, sousEtape: evenement.sousEtape }
    }
  } else if (evenement.genre === GENRE.fin) {
    etat.produit = evenement.produit
  } else {
    etat.echec = evenement
  }

  rendre()
}

async function lancer() {
  if (etat.fichier === null || etat.enMarche) return

  etat.traces = new Map()
  etat.selection = null
  etat.produit = null
  etat.echec = null
  etat.enMarche = true
  $('distiller').disabled = true
  $('relancer').disabled = true
  noter('distillation en cours')
  rendre()

  try {
    await distiller(etat.fichier, recevoir)
  } catch (erreur) {
    etat.echec = { code: CODE_FLUX_INTERROMPU, statut: 0, message: String(erreur) }
  }

  etat.enMarche = false
  $('distiller').disabled = false
  $('relancer').disabled = false
  noter(etat.echec === null ? 'distillé' : `échec — ${etat.echec.message}`)
  rendre()
}

// ------------------------------------------------------------------ les evenements du dom

$('source').addEventListener('click', () => $('fichier').click())

$('fichier').addEventListener('change', (evenement) => {
  const fichier = evenement.target.files?.[0]
  if (fichier === undefined) return
  choisir(fichier)
  lancer()
})

$('distiller').addEventListener('click', lancer)
$('relancer').addEventListener('click', lancer)

const actions = $('actions')

actions.addEventListener('dragover', (evenement) => {
  evenement.preventDefault()
  actions.classList.add('survol')
})

actions.addEventListener('dragleave', () => actions.classList.remove('survol'))

actions.addEventListener('drop', (evenement) => {
  evenement.preventDefault()
  actions.classList.remove('survol')
  const fichier = evenement.dataTransfer?.files?.[0]
  if (fichier === undefined) return
  choisir(fichier)
  lancer()
})

// Le texte du panneau plutot qu'une seconde source de verite : ce qui est copie est
// exactement ce qui est lu a l'ecran.
$('copier').addEventListener('click', () => {
  const bouton = $('copier')
  navigator.clipboard?.writeText($('json').textContent)
  bouton.textContent = 'Copié'
  setTimeout(() => {
    bouton.textContent = 'Copier'
  }, 1400)
})

const loupe = $('loupe')
loupe.addEventListener('click', () => loupe.classList.remove('ouverte'))
document.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Escape') loupe.classList.remove('ouverte')
})

// ------------------------------------------------------------------------- le demarrage
// Le plan d'abord : le squelette s'affiche en attente avant tout televersement, ce qui donne a
// voir le pipeline meme sans image sous la main.

try {
  etat.plan = await chargerPlan()
  rendreFanions()
  rendre()
} catch (erreur) {
  $('source-note').textContent = `plan indisponible — ${String(erreur)}`
}
