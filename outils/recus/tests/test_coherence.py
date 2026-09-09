# Coherence de la verite terrain sur des recus generes et rendus.

from __future__ import annotations

import json
import random
from collections import Counter
from decimal import Decimal

import numpy as np
import pytest

from generateur import catalogue
from generateur.augmentation import appliquer_homographie, augmenter, calculer_homographie
from generateur.contenu import generer_recu_et_style
from generateur.fiscalite import calculer_tps, calculer_tvq
from generateur.rendu import ResultatRendu, polices_disponibles, rendre

NOMBRE_RECUS = 300
GRAINE = 20_240_101


@pytest.fixture(scope="module")
def rendus() -> list[ResultatRendu]:
    polices = polices_disponibles()
    resultats: list[ResultatRendu] = []
    for index in range(NOMBRE_RECUS):
        recu, style, rng = generer_recu_et_style(GRAINE, index, polices)
        resultats.append(rendre(recu, style, rng))
    return resultats


def _gt(rendu: ResultatRendu) -> dict:
    return rendu.recu.vers_gt_parse()["gt_parse"]


def _mots(rendu: ResultatRendu, etiquette: str, indice: int | None = None) -> list[str]:
    return [b.texte for b in rendu.boites if b.etiquette == etiquette and (indice is None or b.indice_ligne == indice)]


def _montants(rendu: ResultatRendu, etiquette: str) -> list[str]:
    return [b.texte.strip("$") for b in rendu.boites if b.etiquette == etiquette]


# ---------------------------------------------------------------------------
# Invariants comptables
# ---------------------------------------------------------------------------


def test_somme_des_prix_egale_sous_total(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        somme = sum(Decimal(article["price"]) for article in gt["menu"])
        assert somme == Decimal(gt["sub_total"]["subtotal_price"]), rendu.recu.identifiant


def test_sous_total_frais_et_taxes_egalent_total(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        st = gt["sub_total"]
        total = (
            Decimal(st["subtotal_price"])
            + Decimal(st.get("frais_service", "0"))
            + Decimal(st.get("frais_livraison", "0"))
            + Decimal(st["tps"])
            + Decimal(st["tvq"])
        )
        assert total == Decimal(gt["total"]["total_price"]), rendu.recu.identifiant


def test_taxes_recalculees_depuis_les_lignes(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        st = gt["sub_total"]
        if gt["info"].get("petit_fournisseur") == "oui":
            assert st["tps"] == "0.00" and st["tvq"] == "0.00"
            assert "tps_no" not in gt["info"] and "tvq_no" not in gt["info"]
            continue
        base = sum(Decimal(a["price"]) for a in gt["menu"] if a["tax"] == "TX")
        base += Decimal(st.get("frais_service", "0")) + Decimal(st.get("frais_livraison", "0"))
        assert Decimal(st["tps"]) == calculer_tps(base), rendu.recu.identifiant
        assert Decimal(st["tvq"]) == calculer_tvq(base), rendu.recu.identifiant


def test_total_final_et_pourboire(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        total = gt["total"]
        assert ("pourboire" in total) == ("total_final" in total)
        if "pourboire" in total:
            assert Decimal(total["total_final"]) == Decimal(total["total_price"]) + Decimal(total["pourboire"])
            assert Decimal(total["pourboire"]) > 0
        attendu = Decimal(total.get("total_final", total["total_price"]))
        if total["paiement"] == "COMPTANT":
            assert rendu.recu.paiement.montant_paye == attendu + Decimal(total.get("arrondi", "0"))
        else:
            assert rendu.recu.paiement.montant_paye == attendu
            assert "arrondi" not in total


def test_menutype_cnt_correspond_au_nombre_d_articles(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        assert int(gt["total"]["menutype_cnt"]) == len(gt["menu"])
        assert len(gt["menu"]) >= 1


# ---------------------------------------------------------------------------
# Correspondance verite terrain ↔ boites de mots
# ---------------------------------------------------------------------------


def test_chaque_nm_se_retrouve_dans_les_mots_captures(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        for indice, article in enumerate(gt["menu"]):
            assert " ".join(_mots(rendu, "nm", indice)) == article["nm"], (rendu.recu.identifiant, indice)
            assert article["nm"], "nm vide"


# Le montant imprime (hors symbole $) d'une ligne correspond au prix brut.
def test_prix_captures_correspondent(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        for indice, article in enumerate(gt["menu"]):
            mots = [b.texte.strip("$") for b in rendu.boites if b.etiquette == "price" and b.indice_ligne == indice]
            assert len(mots) == 1
            brut = Decimal(article["price"]) + Decimal(article.get("discountprice", "0"))
            assert Decimal(mots[0]) == brut
            if "discountprice" in article:
                rabais = [b.texte.strip("$-") for b in rendu.boites
                          if b.etiquette == "discountprice" and b.indice_ligne == indice]
                assert rabais == [article["discountprice"]]


def test_quantite_capturee_une_seule_fois(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        for indice, article in enumerate(gt["menu"]):
            mots = _mots(rendu, "cnt", indice)
            assert len(mots) <= 1, (rendu.recu.identifiant, indice, mots)
            if mots:
                assert mots[0] == article["cnt"]
            if article["cnt"] != "1" or "unit" in article:
                assert mots, (rendu.recu.identifiant, indice)


def test_sku_captures(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        for indice, article in enumerate(gt["menu"]):
            mots = _mots(rendu, "sku", indice)
            if "sku" in article:
                assert mots == [article["sku"]], (rendu.recu.identifiant, indice)
            else:
                assert not mots


def test_totaux_captures(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        petit = gt["info"].get("petit_fournisseur") == "oui"
        attendus = [
            ("total_price", gt["total"]["total_price"]),
            ("subtotal_price", gt["sub_total"]["subtotal_price"]),
            ("menutype_cnt", gt["total"]["menutype_cnt"]),
        ]
        for cle, etiquette in (("frais_service", "frais_service"), ("frais_livraison", "frais_livraison")):
            if cle in gt["sub_total"]:
                attendus.append((etiquette, gt["sub_total"][cle]))
        for cle in ("pourboire", "total_final"):
            if cle in gt["total"]:
                attendus.append((cle, gt["total"][cle]))
        for etiquette, attendu in attendus:
            assert _montants(rendu, etiquette) == [attendu], (rendu.recu.identifiant, etiquette)
        for etiquette in ("tps", "tvq"):
            mots = _montants(rendu, etiquette)
            if petit:
                assert mots in ([], ["0.00"]), (rendu.recu.identifiant, etiquette)
            else:
                assert mots == [gt["sub_total"][etiquette]], (rendu.recu.identifiant, etiquette)
        if "arrondi" in gt["total"]:
            mots = [b.texte.lstrip("-") for b in rendu.boites if b.etiquette == "arrondi"]
            assert mots == [gt["total"]["arrondi"].lstrip("-")]


_CLES_INFO_NON_IMPRIMEES = {"date", "heure", "type_commerce", "client", "petit_fournisseur"}


def _normaliser(texte: str) -> str:
    import unicodedata

    decompose = unicodedata.normalize("NFKD", texte)
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    return sans_accents.upper().replace(",", "")


def test_chaque_cle_info_a_sa_boite(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        info = _gt(rendu)["info"]
        for cle, valeur in info.items():
            if cle in _CLES_INFO_NON_IMPRIMEES:
                continue
            texte = " ".join(_mots(rendu, cle))
            assert texte, (rendu.recu.identifiant, cle)
            assert _normaliser(valeur) in _normaliser(texte), (rendu.recu.identifiant, cle, valeur, texte)
        if info.get("petit_fournisseur") == "oui":
            assert _mots(rendu, "petit_fournisseur")
        if "client" in info:
            client = info["client"]
            assert _normaliser(client["nom"]) == _normaliser(" ".join(_mots(rendu, "client_nom")))
            for cle, etiquette in (("adresse", "client_adresse"), ("tps_no", "client_tps_no"), ("tvq_no", "client_tvq_no")):
                if cle in client:
                    assert _normaliser(client[cle]) in _normaliser(" ".join(_mots(rendu, etiquette)))
        assert _mots(rendu, "date") and _mots(rendu, "heure")


def test_qr_present_ssi_url(rendus: list[ResultatRendu]) -> None:
    au_moins_un = False
    for rendu in rendus:
        boites = [b for b in rendu.boites if b.etiquette == "qr"]
        url = rendu.recu.sev.qr_url if rendu.recu.sev else None
        assert (len(boites) == 1) == (url is not None), rendu.recu.identifiant
        if url is not None:
            au_moins_un = True
            b = boites[0]
            assert b.texte == url
            assert abs((b.x1 - b.x0) - (b.y1 - b.y0)) < 1e-6
            assert b.x1 - b.x0 >= 40
    assert au_moins_un


def test_champs_gt_bien_formes(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        gt = _gt(rendu)
        info = gt["info"]
        assert len(info["date"]) == 10 and info["date"][4] == "-"
        assert len(info["heure"]) == 5 and info["heure"][2] == ":"
        assert info["type_commerce"] in catalogue.TYPES_COMMERCE
        assert info["numero_facture"].isdigit()
        if "type_document" in info:
            assert info["type_document"] in catalogue.TYPES_DOCUMENT
        if "couverts" in info:
            assert info["couverts"].isdigit()
        if "neq" in info:
            assert len(info["neq"]) == 10 and info["neq"][:2] in ("11", "22", "33")
        if "numero_sev" in info:
            assert len(info["numero_sev"]) == 16 and info["numero_sev"].isdigit()
        for article in gt["menu"]:
            assert article["tax"] in ("TX", "DT")
            if "unit" in article:
                assert article["unit"] in ("kg", "L")
                assert len(article["cnt"].split(".")[1]) == 3
            else:
                assert article["cnt"].isdigit()
            assert len(article["unitprice"].split(".")[1]) in (2, 3)
            Decimal(article["unitprice"])
            if "sku" in article:
                assert article["sku"].isdigit()
        assert gt["total"]["paiement"] in ("INTERAC", "VISA", "MASTERCARD", "COMPTANT", "AMEX", "DEBIT")
        # Serialisable et lisible en JSON.
        json.loads(json.dumps(rendu.recu.vers_gt_parse(), ensure_ascii=False))


def test_boites_dans_l_image(rendus: list[ResultatRendu]) -> None:
    for rendu in rendus:
        w, h = rendu.image.size
        for b in rendu.boites:
            assert 0 <= b.x0 < b.x1 <= w + 1, (rendu.recu.identifiant, b)
            assert 0 <= b.y0 < b.y1 <= h + 1, (rendu.recu.identifiant, b)


# ---------------------------------------------------------------------------
# Diversite et determinisme
# ---------------------------------------------------------------------------


def test_repartition_des_types(rendus: list[ResultatRendu]) -> None:
    types = Counter(r.recu.type_commerce for r in rendus)
    assert set(types) == set(catalogue.TYPES_COMMERCE), types
    polices = polices_disponibles()
    for index in range(10):
        recu, _, _ = generer_recu_et_style(5, index, polices, types=("bar",))
        assert recu.type_commerce == "bar"


def test_variantes_rares_presentes(rendus: list[ResultatRendu]) -> None:
    gts = [_gt(r) for r in rendus]
    assert any("pourboire" in gt["total"] for gt in gts)
    assert any("client" in gt["info"] for gt in gts)
    assert any("frais_service" in gt["sub_total"] for gt in gts)
    assert any(a.get("unit") == "L" for gt in gts for a in gt["menu"])
    assert any("table" in gt["info"] for gt in gts)
    assert any("commande" in gt["info"] for gt in gts)


def test_determinisme() -> None:
    polices = polices_disponibles()
    sorties = []
    for _ in range(2):
        recu, style, rng = generer_recu_et_style(7, 11, polices)
        rendu = rendre(recu, style, rng)
        aug = augmenter(rendu.image, rendu.boites, rng)
        sorties.append((recu.vers_gt_parse(), np.asarray(rendu.image).tobytes(),
                        np.asarray(aug.image).tobytes(), [b.quad for b in aug.boites], aug.qualite_jpeg))
    assert sorties[0] == sorties[1]


def test_graines_differentes_donnent_des_recus_differents() -> None:
    polices = polices_disponibles()
    a, _, _ = generer_recu_et_style(1, 0, polices)
    b, _, _ = generer_recu_et_style(1, 1, polices)
    c, _, _ = generer_recu_et_style(2, 0, polices)
    assert a != b
    assert a != c


# Les quadrilateres exportes sont les coins des boites propres passes par l'homographie de
# l'image, puis par l'echelle de redimensionnement.
def test_boites_transportees_par_la_meme_homographie(rendus: list[ResultatRendu]) -> None:
    rendu = rendus[0]
    rng = random.Random(3)
    largeur_cible = 900
    aug = augmenter(rendu.image, rendu.boites, rng, largeur_cible=largeur_cible)
    assert aug.image.width == largeur_cible
    assert len(aug.boites) == len(rendu.boites)
    for propre, transportee in zip(rendu.boites, aug.boites):
        coins = np.asarray(propre.quad()).reshape(4, 2)
        projetes = appliquer_homographie(aug.homographie, coins)
        quad = np.asarray(transportee.quad).reshape(4, 2)
        # Toutes les coordonnees partagent la meme echelle de redimensionnement.
        ratio = quad / projetes
        assert np.allclose(ratio, ratio[0, 0], rtol=1e-6)
        xs, ys = quad[:, 0], quad[:, 1]
        assert transportee.bbox == [xs.min(), ys.min(), xs.max(), ys.max()]
        assert 0 <= xs.min() and xs.max() <= aug.image.width
        assert 0 <= ys.min() and ys.max() <= aug.image.height


def test_homographie_identite_et_inverse() -> None:
    src = np.array([[0, 0], [10, 0], [10, 20], [0, 20]], dtype=np.float64)
    assert np.allclose(calculer_homographie(src, src), np.eye(3))
    dst = np.array([[1, 2], [12, 1], [11, 24], [-1, 21]], dtype=np.float64)
    h = calculer_homographie(src, dst)
    assert np.allclose(appliquer_homographie(h, src), dst)
