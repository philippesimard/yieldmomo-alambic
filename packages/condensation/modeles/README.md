# Modèles de l'OCR ONNX

Les poids de PaddleOCR **PP-OCRv5**, convertis en ONNX sans réentraînement : ce sont exactement
ceux que le sidecar Paddle charge. Ils sont versionnés ici parce qu'ils sont petits (13 Mo en
tout) et ne changent qu'avec une montée de version de PP-OCR.

| Fichier | Modèle d'origine | sha256 |
|---|---|---|
| `detection.onnx` | `PP-OCRv5_mobile_det` | `6bdf743af375b13fbbeeb47a91a40063af5bfb7a7f197f6df8cb990dc827e5d6` |
| `reconnaissance.onnx` | `latin_PP-OCRv5_mobile_rec` | `46449fd0606cd07d856744703211ea6826e4642d4c803d91167c53cde01d3b94` |
| `dictionnaire.txt` | `PostProcess.character_dict` du modèle latin | `ccbcc45730b3fbbd9050c5bc74db6a99067141ef1035e3d14889a84a6b9b1aff` |

Le dictionnaire compte 836 lignes, accents français compris, dont des doublons (`é` deux fois) :
le décodage lit les caractères **par indice**, jamais par recherche dans la liste. La sortie du
modèle de reconnaissance a 838 classes : le blanc du CTC, les 836 caractères, puis l'espace.

## Licence

PaddleOCR et ses modèles sont publiés par PaddlePaddle sous licence Apache 2.0
(<https://github.com/PaddlePaddle/PaddleOCR>).

## Reproduire la conversion

Depuis un venv qui contient `paddlepaddle==3.2.2`, `paddle2onnx` et `setuptools`, avec les
modèles déjà en cache dans `~/.paddlex/official_models/` (le sidecar les y télécharge) :

```bash
paddle2onnx --model_dir ~/.paddlex/official_models/PP-OCRv5_mobile_det \
  --model_filename inference.json --params_filename inference.pdiparams \
  --save_file detection.onnx --opset_version 14
paddle2onnx --model_dir ~/.paddlex/official_models/latin_PP-OCRv5_mobile_rec \
  --model_filename inference.json --params_filename inference.pdiparams \
  --save_file reconnaissance.onnx --opset_version 14
python -c "import yaml, pathlib; d = yaml.safe_load(open(pathlib.Path.home() / '.paddlex/official_models/latin_PP-OCRv5_mobile_rec/inference.yml'))['PostProcess']['character_dict']; pathlib.Path('dictionnaire.txt').write_text('\n'.join(d) + '\n')"
```
