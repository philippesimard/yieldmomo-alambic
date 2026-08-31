// Televerse l'image et lit le flux d'evenements de la reponse.
//
// POST et non EventSource : il faut envoyer un fichier, et un EventSource ne fait que du GET.
// Un POST qui rend un flux se lit avec fetch et un lecteur de flux, et evite d'inventer un
// identifiant de session — le service reste sans etat.

const SEPARATEUR = '\n\n'
const PREFIXE_DONNEES = 'data:'

export const GENRE = {
  trace: 'trace',
  fin: 'fin',
  echec: 'echec',
}

export async function distiller(fichier, surEvenement) {
  const corps = new FormData()
  corps.append('image', fichier)

  const reponse = await fetch('distiller', { method: 'POST', body: corps })

  // Une requete jugee irrecevable repond comme partout ailleurs dans le service : un objet
  // { code, message }, sans flux. On lui redonne la forme d'un evenement pour que la page
  // n'ait qu'une seule branche a traiter.
  if (!reponse.ok) {
    const refus = await reponse.json().catch(() => ({ message: reponse.statusText }))
    surEvenement({ genre: GENRE.echec, statut: reponse.status, ...refus })
    return
  }

  const lecteur = reponse.body.getReader()
  const decodeur = new TextDecoder()
  let tampon = ''

  for (;;) {
    const { value, done } = await lecteur.read()
    if (done) break

    // stream: true : un caractere accentue peut etre coupe en deux entre deux morceaux, et le
    // decoder sans etat rendrait un caractere de remplacement au milieu d'un motif.
    tampon += decodeur.decode(value, { stream: true })

    const morceaux = tampon.split(SEPARATEUR)
    // Le dernier morceau est incomplet tant qu'un separateur ne l'a pas clos : il attend le
    // prochain paquet.
    tampon = morceaux.pop()

    for (const morceau of morceaux) {
      const ligne = morceau.trim()
      if (!ligne.startsWith(PREFIXE_DONNEES)) continue
      surEvenement(JSON.parse(ligne.slice(PREFIXE_DONNEES.length)))
    }
  }
}

export function chargerPlan() {
  return fetch('plan').then((reponse) => reponse.json())
}
