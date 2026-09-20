import { Writable } from 'node:stream'
import { connect, type TLSSocket } from 'node:tls'

// GELF n'a aucune notion d'authentification : c'est ce champ additionnel qui dit a OVH dans quel
// flux de donnees ecrire. Sans lui, le message est accepte puis jete.
const CHAMP_JETON = 'X-OVH-TOKEN'

const VERSION_GELF = '1.1'

// L'entree GELF decoupe les messages sur un octet nul, et non sur un saut de ligne : une trace
// d'exception multi-lignes traverse donc sans etre coupee en morceaux.
const DELIMITEUR = '\0'

// pino numerote ses niveaux de 10 a 60 ; GELF attend la severite syslog. L'etiquette voyage en
// plus : `niveau:error` se cherche et se lit dans Graylog, `level:3` non.
const NIVEAU_INFO = { severite: 6, etiquette: 'info' }

const NIVEAUX: Record<number, { severite: number; etiquette: string }> = {
  10: { severite: 7, etiquette: 'trace' },
  20: { severite: 7, etiquette: 'debug' },
  30: NIVEAU_INFO,
  40: { severite: 4, etiquette: 'warn' },
  50: { severite: 3, etiquette: 'error' },
  60: { severite: 2, etiquette: 'fatal' },
}

// GELF exige short_message. Une ligne pino sans msg est rare mais legale.
const SANS_MESSAGE = '(sans message)'

// level, time et msg deviennent l'enveloppe ; hostname devient _conteneur. pid vaut toujours 1
// dans le conteneur et se facturerait au Go pour ne rien dire.
const CHAMPS_DE_L_ENVELOPPE = new Set(['level', 'time', 'msg', 'hostname', 'pid'])

// Au-dela, les plus vieux messages sautent. Une file sans borne transformerait une coupure
// reseau de quelques minutes en fuite de memoire, et ce sont les lignes recentes qui disent ce
// qui se passe maintenant.
const FILE_MAX = 1000

const RECUL_INITIAL_MS = 1_000
const RECUL_MAX_MS = 30_000
const KEEPALIVE_MS = 30_000

// L'arret du service ne doit pas pendre parce qu'OVH ne repond pas.
const DELAI_VIDAGE_MS = 2_000

export type OptionsGelf = {
  hote: string
  port: number
  jeton: string
  service: string
  environnement: string
  version: string
  // Le flux ne connait pas le journal — il en est une destination. Une panne de socket
  // ressort donc par ici, vers la sortie qui, elle, fonctionne encore.
  signaler: (message: string) => void
}

export type FluxGelf = {
  flux: Writable
  vider: () => Promise<void>
}

type MessageGelf = Record<string, string | number>

export function versGelf(ligne: string, statiques: MessageGelf): MessageGelf | undefined {
  const champs = analyser(ligne)
  if (champs === undefined) return undefined

  const niveau = typeof champs.level === 'number' ? champs.level : 30
  const horodatage = typeof champs.time === 'number' ? champs.time : Date.now()
  const { severite, etiquette } = NIVEAUX[niveau] ?? NIVEAU_INFO

  const message: MessageGelf = {
    ...statiques,
    version: VERSION_GELF,
    short_message: typeof champs.msg === 'string' ? champs.msg : SANS_MESSAGE,
    // GELF compte en secondes, pino en millisecondes.
    timestamp: horodatage / 1000,
    level: severite,
    _niveau: etiquette,
  }

  // Le hostname du conteneur est un hexadecimal qui change a chaque deploiement : il ne sert
  // qu'a distinguer deux repliques, jamais a nommer la source.
  if (typeof champs.hostname === 'string') message._conteneur = champs.hostname

  for (const [cle, valeur] of Object.entries(champs)) {
    if (CHAMPS_DE_L_ENVELOPPE.has(cle)) continue
    ajouter(message, cle, valeur)
  }

  return message
}

// Logs Data Platform indexe un champ additionnel en TEXTE sauf suffixe de type. Sans _num,
// aucune moyenne ni aucun p95 sur totalMs n'est possible. _num (double) et non _int partout :
// les mesures sont arrondies au dixieme de milliseconde, un entier les tronquerait.
function ajouter(message: MessageGelf, cle: string, valeur: unknown): void {
  // OVH convertit les points en soulignes : autant le faire ici, pour que le nom du champ soit
  // celui qu'on cherchera dans Graylog.
  const nom = cle.replaceAll('.', '_')

  if (typeof valeur === 'number') {
    message[`_${nom}_num`] = valeur
    return
  }

  if (typeof valeur === 'boolean') {
    // GELF n'a pas de booleen : un champ _bool attend la chaine "true" ou "false".
    message[`_${nom}_bool`] = String(valeur)
    return
  }

  if (typeof valeur === 'string') {
    message[`_${nom}`] = valeur
    return
  }

  if (valeur !== null && typeof valeur === 'object') {
    // GELF refuse l'imbrication. Un seul niveau suffit : le seul objet que pino sort est `err`,
    // que pino-std-serializers a deja aplati en type / message / stack.
    for (const [sousCle, sousValeur] of Object.entries(valeur)) {
      if (sousValeur !== null && typeof sousValeur === 'object') continue
      ajouter(message, `${nom}_${sousCle}`, sousValeur)
    }
  }
}

// Un hote qui resout a la fois en IPv4 et en IPv6 echoue en AggregateError, dont le message est
// VIDE : sans ce depliage, l'operateur lit « Journal GELF injoignable : » et rien d'autre.
function decrire(erreur: Error): string {
  if (erreur instanceof AggregateError) {
    return erreur.errors
      .map((cause) => (cause instanceof Error ? decrire(cause) : String(cause)))
      .join(' ; ')
  }
  return erreur.message.length > 0 ? erreur.message : erreur.name
}

function analyser(ligne: string): Record<string, unknown> | undefined {
  try {
    const analyse: unknown = JSON.parse(ligne)
    if (analyse === null || typeof analyse !== 'object') return undefined
    // Sur : JSON.parse ne rend que des valeurs json, et le cas non-objet vient d'etre ecarte.
    return analyse as Record<string, unknown>
  } catch {
    // Une ligne illisible se jette plutot que de casser le flux : elle n'est de toute facon pas
    // de pino, et stdout l'a deja recue telle quelle.
    return undefined
  }
}

export function creerFluxGelf(options: OptionsGelf): FluxGelf {
  const statiques: MessageGelf = {
    // La colonne « source » de Graylog. Le nom du service s'y lit ; un identifiant de conteneur
    // non, et il changerait a chaque deploiement.
    host: options.service,
    [`_${CHAMP_JETON}`]: options.jeton,
    _service: options.service,
    _environnement: options.environnement,
    // _versionService et non _version : `version` est reserve par GELF, c'est la version du
    // format lui-meme.
    _versionService: options.version,
  }

  const file: string[] = []
  let socket: TLSSocket | undefined
  let reculMs = RECUL_INITIAL_MS
  let arretDemande = false

  function connecter(): void {
    const prise = connect({ host: options.hote, port: options.port, servername: options.hote })
    prise.setNoDelay(true)
    prise.setKeepAlive(true, KEEPALIVE_MS)

    prise.once('secureConnect', () => {
      socket = prise
      reculMs = RECUL_INITIAL_MS
      vidanger()
    })

    // Ne jamais laisser remonter : ne pas pouvoir expedier ses logs n'est pas une raison
    // d'arreter de lire des factures. 'close' suit toujours 'error', c'est lui qui reconnecte.
    prise.on('error', (erreur) => {
      options.signaler(`Journal GELF injoignable : ${decrire(erreur)}`)
    })

    prise.on('close', () => {
      if (socket === prise) socket = undefined
      if (arretDemande) return
      // unref : cette minuterie ne doit pas maintenir le process en vie.
      setTimeout(connecter, reculMs).unref()
      reculMs = Math.min(reculMs * 2, RECUL_MAX_MS)
    })
  }

  function vidanger(): void {
    if (socket === undefined) return
    for (const message of file.splice(0)) socket.write(message)
  }

  function empiler(ligne: string): void {
    const message = versGelf(ligne, statiques)
    if (message === undefined) return

    const charge = `${JSON.stringify(message)}${DELIMITEUR}`
    if (socket?.writable) {
      socket.write(charge)
      return
    }

    if (file.length >= FILE_MAX) file.shift()
    file.push(charge)
  }

  const flux = new Writable({
    // pino ecrit une ligne complete par appel, deja serialisee : rien a decoder ni a recoller.
    decodeStrings: false,
    write(ligne: string, _encodage, suite) {
      empiler(ligne)
      suite()
    },
  })

  async function vider(): Promise<void> {
    arretDemande = true
    vidanger()

    const prise = socket
    if (prise === undefined) return

    await new Promise<void>((resoudre) => {
      const echeance = setTimeout(resoudre, DELAI_VIDAGE_MS).unref()
      prise.end(() => {
        clearTimeout(echeance)
        resoudre()
      })
    })

    prise.destroy()
  }

  connecter()

  return { flux, vider }
}
