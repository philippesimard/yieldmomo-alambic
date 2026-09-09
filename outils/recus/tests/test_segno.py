# Le code QR (segno) est disponible et deterministe.

from __future__ import annotations


def test_segno_importable() -> None:
    import segno

    assert segno.make_qr("https://mev-web.revenuquebec.ca/v?no=1").matrix


def test_matrice_qr_stable_et_carree() -> None:
    from generateur.rendu import matrice_qr

    url = "https://mev-web.revenuquebec.ca/verification?no=2024031118325512&m=85.03"
    a = matrice_qr(url)
    b = matrice_qr(url)
    assert a == b
    assert all(len(ligne) == len(a) for ligne in a)
    assert len(matrice_qr(url + "&x=" + "1" * 60)) > len(a)
