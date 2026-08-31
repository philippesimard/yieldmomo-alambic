// La sortie de la sous-etape selectionnee : ce qu'elle a produit en image, en json, et ce
// qu'elle a coute. Le genre de l'apercu decide du rendu — jamais le nom de la sous-etape.

import {
  $,
  dureeEtape,
  dureeTotale,
  estSelection,
  etatVide,
  formaterMs,
  formaterPoids,
  GENRE_APERCU,
  jetonMeta,
  ligneMotif,
  remplirBadge,
  STATUT,
  statutEtape,
  statutSousEtape,
  traceDe,
} from './commun.js'

export function rendreInspecteur(etat) {
  rendreApercu(etat)
  rendreJson(etat)
  rendreChrono(etat)
}

function rendreApercu(etat) {
  const corps = $('apercu-corps')
  const badge = $('sortie-badge')
  corps.textContent = ''
  $('apercu-note').textContent = ''

  const trace = traceSelectionnee(etat)

  if (trace === undefined) {
    $('sortie-cible').textContent = 'aucune sous-étape sélectionnée'
    remplirBadge(badge, etat.enMarche ? STATUT.enCours : STATUT.enAttente)
    corps.append(etatVideDAccueil(etat))
    return
  }

  $('sortie-cible').textContent = `${trace.etape} / ${trace.sousEtape}`
  $('apercu-note').textContent = formaterMs(trace.dureeMs)
  remplirBadge(badge, trace.statut)

  if (trace.motif !== undefined) {
    const motif = ligneMotif(trace.statut, trace.motif, 14)
    motif.style.margin = '0 0 14px'
    corps.append(motif)
  }

  const image = trace.apercus.find((apercu) => apercu.genre === GENRE_APERCU.image)
  const cadres = trace.apercus.find((apercu) => apercu.genre === GENRE_APERCU.cadres)

  // Une etape qui declare des cadres ne retransmet pas d'image : on les pose sur la derniere
  // image recue. C'est ce qui evite au lecteur de savoir QUI parle pour savoir quoi dessiner.
  const support = image ?? (cadres === undefined ? undefined : derniereImageJusqua(etat))

  if (support === undefined) {
    corps.append(
      etatVide(
        'Pas de sortie visuelle',
        'Cette sous-étape ne produit aucune image — sa sortie est dans « Sortie brute ».',
      ),
    )
    return
  }

  const planche = construirePlanche(support, cadres)
  planche.addEventListener('click', () => ouvrirLoupe(planche))
  corps.append(planche, metaDe(support, image, cadres))
}

function etatVideDAccueil(etat) {
  if (etat.echec !== null) {
    return etatVide('Distillation en échec', `${etat.echec.code} — ${etat.echec.message}`)
  }
  if (etat.enMarche) {
    return etatVide('Distillation en cours', "Les sous-étapes s'allument au fil du flux.")
  }
  return etatVide(
    'Aucune sous-étape sélectionnée',
    'Lance une distillation, puis clique une sous-étape du pipeline pour voir ce quelle a produit.',
  )
}

function construirePlanche(support, cadres) {
  const planche = document.createElement('div')
  planche.className = 'planche'

  const image = document.createElement('img')
  image.src = `data:image/png;base64,${support.base64}`
  image.alt = 'Sortie de la sous-étape'
  planche.append(image)

  if (cadres === undefined) return planche

  const calque = document.createElement('div')
  calque.className = 'cadres'

  // En pourcentage, et non en pixels : les cadres sont donnes dans les dimensions reelles de
  // l'image, alors que la vignette affichee est reduite. C'est pour cela que chaque apercu
  // porte ses dimensions.
  for (const { cadre, texte, confiance } of cadres.cadres) {
    const boite = document.createElement('div')
    boite.className = 'cadre'
    boite.style.left = `${(cadre.x / cadres.largeur) * 100}%`
    boite.style.top = `${(cadre.y / cadres.hauteur) * 100}%`
    boite.style.width = `${(cadre.largeur / cadres.largeur) * 100}%`
    boite.style.height = `${(cadre.hauteur / cadres.hauteur) * 100}%`
    boite.style.opacity = String(0.35 + confiance * 0.65)
    boite.title = `${texte} — confiance ${confiance.toFixed(2)}`
    calque.append(boite)
  }

  planche.append(calque)
  return planche
}

function metaDe(support, image, cadres) {
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.append(jetonMeta('dimensions', `${support.largeur} × ${support.hauteur}`))

  if (image !== undefined) {
    // Un base64 pese quatre tiers de ce qu'il code : la taille reelle de la vignette s'en
    // deduit sans avoir a la decoder.
    meta.append(jetonMeta('vignette', `png · ${formaterPoids((image.base64.length * 3) / 4)}`))
  }

  if (cadres !== undefined) {
    const confiances = cadres.cadres.map((annote) => annote.confiance)
    const moyenne = confiances.reduce((somme, valeur) => somme + valeur, 0) / confiances.length
    meta.append(jetonMeta('cadres', String(cadres.cadres.length)))
    meta.append(jetonMeta('confiance moyenne', moyenne.toFixed(2)))
  }

  return meta
}

// La derniere image recue avant la selection, celle-ci comprise : les etapes se suivent, donc
// la plus recente est celle sur laquelle la sous-etape selectionnee a travaille.
function derniereImageJusqua(etat) {
  let derniere

  for (const definition of etat.plan.etapes) {
    for (const sousEtape of definition.sousEtapes) {
      const trace = traceDe(etat, definition.etape, sousEtape)
      const image = trace?.apercus.find((apercu) => apercu.genre === GENRE_APERCU.image)
      if (image !== undefined) derniere = image
      if (estSelection(etat, definition.etape, sousEtape)) return derniere
    }
  }

  return derniere
}

function rendreJson(etat) {
  const pre = $('json')
  const cible = $('json-cible')
  pre.textContent = ''

  const trace = traceSelectionnee(etat)
  if (trace === undefined) {
    cible.textContent = '—'
    pre.append(etatVide('Aucune sortie', 'Sélectionne une sous-étape pour lire ce quelle a rendu.'))
    return
  }

  const index = trace.apercus.findIndex((apercu) => apercu.genre === GENRE_APERCU.donnees)
  if (index === -1) {
    cible.textContent = `${trace.sousEtape} · aucun apercu`
    pre.append(etatVide('Aucune donnée', "Cette sous-étape n'a rendu aucun aperçu de données."))
    return
  }

  cible.textContent = `${trace.sousEtape} · apercus[${index}].valeur`
  pre.innerHTML = colorer(JSON.stringify(trace.apercus[index].valeur, null, 2))
}

function colorer(json) {
  return json
    .replace(/[&<>]/g, (caractere) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[caractere])
    .replace(/"([^"]+)":/g, '<span class="cle">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="txt">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="num">$1</span>')
}

function rendreChrono(etat) {
  const corps = $('chrono-corps')
  corps.textContent = ''

  const total = dureeTotale(etat)
  if (total === 0) {
    $('chrono-note').textContent = ''
    corps.append(
      etatVide('Aucune mesure', 'Les durées apparaissent au fur et à mesure de la distillation.'),
    )
    return
  }

  $('chrono-note').textContent = formaterMs(total)

  const chrono = document.createElement('div')
  chrono.className = 'chrono'

  for (const definition of etat.plan.etapes) {
    const tracees = definition.sousEtapes.filter(
      (sousEtape) => traceDe(etat, definition.etape, sousEtape) !== undefined,
    )
    // Une etape que la distillation n'a pas atteinte n'a pas coute 0 ms : elle n'a pas de
    // duree du tout, et lui donner une ligne a zero serait affirmer qu'elle a tourne.
    if (tracees.length === 0) continue

    chrono.append(
      ligneChrono({
        nom: definition.etape,
        ms: dureeEtape(etat, definition),
        total,
        statut: statutEtape(etat, definition),
      }),
    )

    for (const sousEtape of definition.sousEtapes) {
      const trace = traceDe(etat, definition.etape, sousEtape)
      if (trace === undefined) continue
      chrono.append(
        ligneChrono({
          nom: sousEtape,
          ms: trace.dureeMs,
          total,
          statut: statutSousEtape(etat, definition.etape, sousEtape),
          secondaire: true,
          actif: estSelection(etat, definition.etape, sousEtape),
        }),
      )
    }
  }

  corps.append(chrono, piedChrono(etat, total))
}

function ligneChrono({ nom, ms, total, statut, secondaire = false, actif = false }) {
  const ligne = document.createElement('div')
  ligne.className = `chrono-ligne${secondaire ? ' secondaire' : ''}${actif ? ' actif' : ''}`
  ligne.dataset.statut = statut

  const titre = document.createElement('span')
  titre.className = 'chrono-nom'
  titre.textContent = nom

  const piste = document.createElement('div')
  piste.className = 'chrono-piste'
  const part = document.createElement('div')
  part.className = 'chrono-part'
  // Un plancher de 2 % : une sous-etape a 0,1 ms doit rester visible, sinon la ligne semble
  // absente plutot que rapide.
  part.style.width = `${Math.max(2, (ms / total) * 100)}%`
  piste.append(part)

  const valeur = document.createElement('span')
  valeur.className = 'chrono-ms'
  valeur.textContent = formaterMs(ms)

  ligne.append(titre, piste, valeur)
  return ligne
}

function piedChrono(etat, total) {
  const pied = document.createElement('div')
  pied.className = 'chrono-pied'
  pied.append(paireLegende('total', formaterMs(total)))
  if (etat.fichier !== null) {
    pied.append(paireLegende('octets reçus', etat.fichier.size.toLocaleString('fr-CA')))
  }
  return pied
}

function paireLegende(nom, valeur) {
  const paire = document.createElement('span')
  const gras = document.createElement('b')
  gras.textContent = valeur
  paire.append(`${nom} `, gras)
  return paire
}

function traceSelectionnee(etat) {
  if (etat.selection === null) return undefined
  return traceDe(etat, etat.selection.etape, etat.selection.sousEtape)
}

function ouvrirLoupe(planche) {
  const loupe = $('loupe')
  loupe.textContent = ''
  loupe.append(planche.cloneNode(true))
  loupe.classList.add('ouverte')
}
