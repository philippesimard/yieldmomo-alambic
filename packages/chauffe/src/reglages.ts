import sharp from 'sharp'

// Reglages globaux de libvips. Ils vivent dans un module a effet de bord, importe par l'etape
// elle-meme, et non dans une fonction que chaque appelant devrait penser a invoquer : ce sont des
// reglages de PROCESS, et le serveur, les trois bancs et le hublot doivent tous voir la meme
// machine. Un reglage qu'on peut oublier d'appliquer fausse silencieusement toute mesure.

// Le cache d'operations de libvips (50 Mo par defaut) parie qu'on retraitera les memes images.
// Ici chaque image est vue une fois et une seule : il ne touche jamais, et n'est donc que de la
// memoire residente, multipliee par le nombre d'ouvriers. Mesure au banc sur le corpus :
// 430 ms par image contre 441 ms sans ce reglage, soit rien a payer pour la memoire recuperee.
sharp.cache(false)

// PAS de sharp.concurrency(1), et c'est un resultat de mesure, pas un oubli. L'idee etait
// d'empecher chaque operation sharp de s'etaler sur tous les coeurs pendant que les sidecars y
// travaillent. Le banc dit l'inverse : 479 ms par image contre 387 ms sans, et sur le service
// reel 11,2 s contre 10,6 s pour deux distillations simultanees. La raison tient a la forme du
// pipeline — les deux sidecars traitent sous un verrou global, donc les ouvriers passent le plus
// clair de leur temps bloques a attendre leur tour, et la contention libvips qu'on voulait eviter
// ne se produit tout simplement pas. Le jour ou cette serialisation tombera, la question sera a
// reposer, avec le banc.
