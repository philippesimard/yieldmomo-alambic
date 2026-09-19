import type { SousCategorie } from '@alambic/noyau'
import { normaliser } from './commun'
import { MOTS_CLES } from './mots-cles-categories'

// Tout ce qui n'est ni lettre ni chiffre separe deux mots. « TIM HORTONS #1234 » devient donc
// les mots tim, hortons, 1234 — et le numero de succursale ne colle plus a l'enseigne.
const SEPARATEURS = /[^\p{L}\p{N}]+/u

// L'apostrophe du possessif anglais colle au mot (« HARVEY'S » : harveys) ; toute autre
// apostrophe separe, comme celle de l'elision francaise (« L'EPICIER » : l, epicier).
const POSSESSIF = /(\p{L})['’]s(?!\p{L})/gu

// Index des mots-cles, construit une fois au chargement : le nom d'une enseigne est court, la
// table ne l'est pas. On interroge des fenetres de mots plutot que de balayer toute la table.
// Chaque cle passe par le meme decoupage que le texte du recu : « couche-tard » s'y range sous
// « couche tard », et une cle a trait d'union n'est plus hors d'atteinte.
const INDEX = new Map<string, SousCategorie[]>()

// Les cles a esperluette (« a&w », « h&m ») ne se decoupent pas : elles deviendraient deux
// lettres isolees que n'importe quelles initiales imprimeraient (« A.W. PLOMBERIE »). On les
// cherche sur le texte normalise, esperluette comprise, espaces tolerees autour. Leur taille est
// celle de leur decoupage, pour qu'elles se mesurent aux autres fenetres.
type CleEsperluette = { motif: RegExp; taille: number; sousCategories: SousCategorie[] }
const ESPERLUETTES = new Map<string, CleEsperluette>()

// Sur : MOTS_CLES est un Record<SousCategorie, readonly string[]>, donc ses cles sont
// exactement les SousCategorie. Object.entries les elargit en string, c'est tout.
for (const [sousCategorie, motsCles] of Object.entries(MOTS_CLES) as [
  SousCategorie,
  readonly string[],
][]) {
  for (const motCle of motsCles) {
    if (motCle.includes('&')) indexerEsperluette(motCle, sousCategorie)
    else indexer(decouper(motCle).join(' '), sousCategorie)
  }
}

// Le plus long mot-cle de la table, en nombre de mots : la plus grande fenetre a essayer.
// Derive de la table et non fixe a la main, pour qu'un mot-cle plus long reste trouvable.
const FENETRE_MAXIMUM = Math.max(
  ...[...INDEX.keys()].map((motCle) => motCle.split(' ').length),
  ...[...ESPERLUETTES.values()].map((cle) => cle.taille),
)

// « BIENVENUE CHEZIGA » : l'ocr colle la formule d'accueil a l'enseigne. Un mot qui commence
// par l'une d'elles, et dont le reste est une cle connue d'au moins trois lettres, en est separe.
const FORMULES_COLLEES = ['chez', 'bienvenue'] as const
const RESTE_MINIMUM = 3

// « 3 UNI QLO » : l'ocr coupe un nom en deux. Deux mots voisins se recollent quand leur
// concatenation est une cle d'un seul mot assez longue pour ne pas tenir du hasard, et qu'aucun
// des deux n'est une cle a lui seul ni un mot trop court pour compter (« LA FLEUR » ne devient
// pas Lafleur).
const JONCTION_MINIMUM = 6
const MORCEAU_MINIMUM = 3

// Un site imprime sur le recu nomme l'enseigne quand sa ligne est illisible. Une adresse web
// complete seulement (www. ou http), jamais un courriel — un commerce ecrit volontiers depuis
// une adresse videotron.ca —, et jamais une plateforme de paiement, de livraison ou un reseau
// social, que le commerce imprime sans en etre un.
const SITE = /(?:https?:\/\/|www\.)(?:www\.)?([a-z0-9-]+)\.(?:com|ca|net|org|quebec)\b/
const PLATEFORMES: ReadonlySet<string> = new Set([
  'clover',
  'square',
  'squareup',
  'moneris',
  'paypal',
  'facebook',
  'instagram',
  'google',
  'uber',
  'ubereats',
  'doordash',
  'skipthedishes',
  'tripadvisor',
])

// Les sous-categories designees par la plus longue correspondance trouvee dans le texte. La
// longueur d'abord parce qu'un mot-cle long est plus specifique qu'un court : « costco essence »
// l'emporte sur « costco », qui dirait epicerie.
export function sousCategoriesDe(texte: string): SousCategorie[] {
  const mots = recoller(decoller(decouper(texte)))
  const normalise = normaliser(texte)
  for (let taille = Math.min(FENETRE_MAXIMUM, mots.length); taille >= 1; taille--) {
    const trouvees = new Set<SousCategorie>()
    for (let debut = 0; debut + taille <= mots.length; debut++) {
      for (const sousCategorie of INDEX.get(mots.slice(debut, debut + taille).join(' ')) ?? []) {
        trouvees.add(sousCategorie)
      }
    }
    for (const cle of ESPERLUETTES.values()) {
      if (cle.taille !== taille || !cle.motif.test(normalise)) continue
      for (const sousCategorie of cle.sousCategories) trouvees.add(sousCategorie)
    }
    if (trouvees.size > 0) return [...trouvees]
  }
  return []
}

// Le nom du site imprime sur la ligne (« WWW.UNIQLO.COM » : uniqlo), ou null.
export function siteDe(texte: string): string | null {
  const nom = normaliser(texte).match(SITE)?.[1]
  return nom === undefined || PLATEFORMES.has(nom) ? null : nom
}

// Le texte en mots normalises, la forme dans laquelle on le compare aux mots-cles.
function decouper(texte: string): string[] {
  return normaliser(texte)
    .replace(POSSESSIF, '$1s')
    .split(SEPARATEURS)
    .filter((mot) => mot !== '')
}

function indexer(motCle: string, sousCategorie: SousCategorie) {
  const existantes = INDEX.get(motCle)
  if (existantes === undefined) INDEX.set(motCle, [sousCategorie])
  else if (!existantes.includes(sousCategorie)) existantes.push(sousCategorie)
}

function indexerEsperluette(motCle: string, sousCategorie: SousCategorie) {
  const existante = ESPERLUETTES.get(motCle)
  if (existante !== undefined) {
    if (!existante.sousCategories.includes(sousCategorie)) {
      existante.sousCategories.push(sousCategorie)
    }
    return
  }
  const motif = motCle
    .split('&')
    .map((morceau) => morceau.trim().split(/\s+/).join('\\s+'))
    .join('\\s*&\\s*')
  ESPERLUETTES.set(motCle, {
    motif: new RegExp(`(?<![\\p{L}\\p{N}])${motif}(?![\\p{L}\\p{N}])`, 'u'),
    taille: decouper(motCle).length,
    sousCategories: [sousCategorie],
  })
}

function decoller(mots: readonly string[]): string[] {
  return mots.flatMap((mot) => {
    const formule = FORMULES_COLLEES.find(
      (candidate) =>
        mot.startsWith(candidate) &&
        mot.length - candidate.length >= RESTE_MINIMUM &&
        INDEX.has(mot.slice(candidate.length)),
    )
    return formule === undefined ? [mot] : [formule, mot.slice(formule.length)]
  })
}

function recoller(mots: readonly string[]): string[] {
  const recolles: string[] = []
  for (let rang = 0; rang < mots.length; rang++) {
    const mot = mots[rang] ?? ''
    const suivant = mots[rang + 1]
    if (suivant !== undefined && seRecollent(mot, suivant)) {
      recolles.push(mot + suivant)
      rang++
    } else {
      recolles.push(mot)
    }
  }
  return recolles
}

function seRecollent(mot: string, suivant: string): boolean {
  const ensemble = mot + suivant
  return (
    ensemble.length >= JONCTION_MINIMUM &&
    mot.length >= MORCEAU_MINIMUM &&
    suivant.length >= MORCEAU_MINIMUM &&
    INDEX.has(ensemble) &&
    !INDEX.has(mot) &&
    !INDEX.has(suivant)
  )
}
